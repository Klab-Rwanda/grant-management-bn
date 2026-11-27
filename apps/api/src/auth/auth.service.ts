import { isRole, isRoleCompatibleWithOrg } from '@grant-ledger/shared';
import type { AuthTokenPayload, AuthUserContext, OrgType, Role } from '@grant-ledger/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';
import { AuditLogService } from '../audit/audit.service';
import { EnvService } from '../config/env';
import { TenantContextService } from '../database/tenant-context.service';
import { AUTH_PROVIDER } from './auth.interface';
import type { IAuthProvider } from './auth.interface';
import { AuthMailerService } from './auth-mailer.service';
import { PasswordHasherService } from './password-hasher.service';

export interface LoginInput {
  email: string;
  password: string;
  tenant_id?: string;
}

export interface InvitationInput {
  email: string;
  role: Role;
}

export interface AcceptInvitationInput {
  token: string;
  full_name: string;
  password: string;
}

interface WorkspaceChoice {
  tenant_id: string;
  legal_name: string;
  org_type: OrgType;
  role: Role;
}

type LoginResult =
  { workspaces: WorkspaceChoice[] } | { access_token: string; user: AuthUserContext };

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly auditLog: AuditLogService,
    private readonly mailer: AuthMailerService,
    private readonly env: EnvService,
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const email = this.normalizeEmail(input?.email);
    if (
      typeof input?.password !== 'string' ||
      input.password.length === 0 ||
      input.password.length > 128
    ) {
      throw new BadRequestException('A valid password is required');
    }

    const user = await this.tenantContext.withOwnerContext((tx) =>
      tx
        .selectFrom('users')
        .select(['id', 'email', 'password_hash', 'status', 'mfa_enabled'])
        .where(sql<string>`lower(email)`, '=', email)
        .executeTakeFirst(),
    );
    const validPassword = await this.passwordHasher.verify(
      input.password,
      user?.password_hash ?? null,
    );
    if (!user || !validPassword || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Email, password, or workspace is invalid');
    }
    if (user.mfa_enabled) {
      throw new UnauthorizedException('Multi-factor authentication is required but not configured');
    }

    const workspaces = await this.getActiveWorkspaces(user.id);
    if (workspaces.length === 0) {
      throw new UnauthorizedException('Email, password, or workspace is invalid');
    }

    if (!input.tenant_id && workspaces.length > 1) {
      return { workspaces };
    }

    const workspace = input.tenant_id
      ? workspaces.find((candidate) => candidate.tenant_id === input.tenant_id)
      : workspaces[0];
    if (!workspace) {
      throw new UnauthorizedException('Email, password, or workspace is invalid');
    }

    const userContext: AuthUserContext = {
      user_id: user.id,
      email: user.email,
      tenant_id: workspace.tenant_id,
      role: workspace.role,
      org_type: workspace.org_type,
      mfa_verified: false,
    };
    return {
      access_token: await this.authProvider.issueToken(this.toTokenPayload(userContext)),
      user: userContext,
    };
  }

  async createInvitation(
    actor: AuthUserContext,
    input: InvitationInput,
  ): Promise<{ invitation_id: string; email: string; expires_at: string; invitation_url: string }> {
    const email = this.normalizeEmail(input?.email);
    if (!isRole(input?.role)) {
      throw new BadRequestException('A valid workspace role is required');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const invitation = await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const organization = await tx
        .selectFrom('organizations')
        .select(['org_type', 'status'])
        .where('id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!organization || organization.status !== 'ACTIVE') {
        throw new ForbiddenException('The workspace is not active');
      }
      if (!isRoleCompatibleWithOrg(input.role, organization.org_type)) {
        throw new BadRequestException('The invited role is not valid for this workspace');
      }

      const existingMembership = await tx
        .selectFrom('memberships')
        .innerJoin('users', 'users.id', 'memberships.user_id')
        .select('memberships.id')
        .where('memberships.tenant_id', '=', actor.tenant_id)
        .where(sql<string>`lower(users.email)`, '=', email)
        .executeTakeFirst();
      if (existingMembership) {
        throw new ConflictException('This email already has a workspace membership');
      }

      const existingInvitation = await tx
        .selectFrom('invitations')
        .select('id')
        .where('tenant_id', '=', actor.tenant_id)
        .where(sql<string>`lower(email)`, '=', email)
        .where('accepted_at', 'is', null)
        .where('expires_at', '>', new Date().toISOString())
        .executeTakeFirst();
      if (existingInvitation) {
        throw new ConflictException('An active invitation already exists for this email');
      }

      const inserted = await tx
        .insertInto('invitations')
        .values({
          tenant_id: actor.tenant_id,
          email,
          role: input.role,
          token_hash: tokenHash,
          invited_by_user_id: actor.user_id,
          expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.auditLog.appendAuditLog(tx, {
        tenant_id: actor.tenant_id,
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'INVITATION_CREATED',
        entity_type: 'invitation',
        entity_id: inserted.id,
        after_state: { email, role: input.role, expires_at: expiresAt },
      });
      return inserted;
    });

    const invitationUrl = new URL('/accept-invitation', this.env.config.WEB_BASE_URL);
    invitationUrl.searchParams.set('token', token);
    try {
      await this.mailer.sendInvitation(email, invitationUrl.toString());
    } catch {
      throw new ServiceUnavailableException({
        message:
          'The invitation was created, but email delivery failed. Share this URL securely with the invitee.',
        invitation_id: invitation.id,
        invitation_url: invitationUrl.toString(),
      });
    }

    return {
      invitation_id: invitation.id,
      email,
      expires_at: expiresAt,
      invitation_url: invitationUrl.toString(),
    };
  }

  async acceptInvitation(
    input: AcceptInvitationInput,
  ): Promise<{ access_token: string; user: AuthUserContext }> {
    if (typeof input?.token !== 'string' || input.token.length < 32 || input.token.length > 256) {
      throw new BadRequestException('A valid invitation token is required');
    }
    if (
      typeof input?.full_name !== 'string' ||
      input.full_name.trim().length < 1 ||
      input.full_name.trim().length > 120
    ) {
      throw new BadRequestException('Full name must be between 1 and 120 characters');
    }
    this.validateNewPassword(input.password);

    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    const accepted = await this.tenantContext.withOwnerContext(async (tx) => {
      const invitation = await tx
        .selectFrom('invitations')
        .innerJoin('organizations', 'organizations.id', 'invitations.tenant_id')
        .select([
          'invitations.id',
          'invitations.tenant_id',
          'invitations.email',
          'invitations.role',
          'invitations.expires_at',
          'invitations.accepted_at',
          'organizations.org_type',
          'organizations.status as organization_status',
        ])
        .where('invitations.token_hash', '=', tokenHash)
        .forUpdate()
        .executeTakeFirst();

      if (
        !invitation ||
        invitation.accepted_at ||
        new Date(invitation.expires_at).getTime() <= Date.now() ||
        invitation.organization_status !== 'ACTIVE' ||
        !isRoleCompatibleWithOrg(invitation.role, invitation.org_type)
      ) {
        throw new BadRequestException('This invitation is invalid or has expired');
      }

      const email = this.normalizeEmail(invitation.email);
      const existingUser = await tx
        .selectFrom('users')
        .select(['id', 'email', 'full_name', 'password_hash', 'status', 'mfa_enabled'])
        .where(sql<string>`lower(email)`, '=', email)
        .forUpdate()
        .executeTakeFirst();

      let userId: string;
      if (existingUser?.status === 'SUSPENDED') {
        throw new ForbiddenException('This account is suspended');
      }
      if (existingUser?.mfa_enabled) {
        throw new ForbiddenException('This account requires multi-factor authentication');
      }

      if (existingUser) {
        userId = existingUser.id;
        if (existingUser.password_hash) {
          if (!(await this.passwordHasher.verify(input.password, existingUser.password_hash))) {
            throw new UnauthorizedException(
              'Use the password for your existing Grant Ledger account',
            );
          }
          if (existingUser.status !== 'ACTIVE') {
            await tx
              .updateTable('users')
              .set({ status: 'ACTIVE' })
              .where('id', '=', existingUser.id)
              .execute();
          }
        } else {
          const passwordHash = await this.passwordHasher.hash(input.password);
          await tx
            .updateTable('users')
            .set({
              full_name: input.full_name.trim(),
              password_hash: passwordHash,
              status: 'ACTIVE',
            })
            .where('id', '=', existingUser.id)
            .execute();
        }
      } else {
        const passwordHash = await this.passwordHasher.hash(input.password);
        const insertedUser = await tx
          .insertInto('users')
          .values({
            email,
            full_name: input.full_name.trim(),
            password_hash: passwordHash,
            status: 'ACTIVE',
          })
          .returning(['id', 'email'])
          .executeTakeFirstOrThrow();
        userId = insertedUser.id;
      }

      const existingMembership = await tx
        .selectFrom('memberships')
        .select('id')
        .where('tenant_id', '=', invitation.tenant_id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (existingMembership) {
        throw new ConflictException(
          'This account already has a membership in the invited workspace',
        );
      }

      const membership = await tx
        .insertInto('memberships')
        .values({
          tenant_id: invitation.tenant_id,
          user_id: userId,
          role: invitation.role,
          status: 'ACTIVE',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await tx
        .updateTable('invitations')
        .set({ accepted_at: new Date().toISOString() })
        .where('id', '=', invitation.id)
        .execute();

      await this.auditLog.appendAuditLog(tx, {
        tenant_id: invitation.tenant_id,
        actor_id: userId,
        actor_type: 'USER',
        action: 'INVITATION_ACCEPTED',
        entity_type: 'membership',
        entity_id: membership.id,
        after_state: { email, role: invitation.role },
      });

      return {
        user: {
          user_id: userId,
          email,
          tenant_id: invitation.tenant_id,
          role: invitation.role,
          org_type: invitation.org_type,
        },
      };
    });

    const user: AuthUserContext = { ...accepted.user, mfa_verified: false };
    return {
      access_token: await this.authProvider.issueToken(this.toTokenPayload(user)),
      user,
    };
  }

  async validateSession(user: AuthUserContext): Promise<void> {
    const membership = await this.tenantContext.withTenantContext(user.tenant_id, (tx) =>
      tx
        .selectFrom('memberships')
        .innerJoin('users', 'users.id', 'memberships.user_id')
        .innerJoin('organizations', 'organizations.id', 'memberships.tenant_id')
        .select([
          'memberships.role',
          'memberships.status as membership_status',
          'users.status as user_status',
          'users.email',
          'organizations.org_type',
          'organizations.status as organization_status',
        ])
        .where('memberships.tenant_id', '=', user.tenant_id)
        .where('memberships.user_id', '=', user.user_id)
        .executeTakeFirst(),
    );

    if (
      !membership ||
      membership.membership_status !== 'ACTIVE' ||
      membership.user_status !== 'ACTIVE' ||
      membership.organization_status !== 'ACTIVE' ||
      membership.role !== user.role ||
      membership.org_type !== user.org_type ||
      membership.email.toLowerCase() !== user.email.toLowerCase() ||
      !isRoleCompatibleWithOrg(membership.role, membership.org_type)
    ) {
      throw new UnauthorizedException(
        'The user account or workspace membership is no longer active',
      );
    }
  }

  private async getActiveWorkspaces(userId: string): Promise<WorkspaceChoice[]> {
    const rows = await this.tenantContext.withOwnerContext((tx) =>
      tx
        .selectFrom('memberships')
        .innerJoin('organizations', 'organizations.id', 'memberships.tenant_id')
        .select([
          'memberships.tenant_id',
          'memberships.role',
          'organizations.legal_name',
          'organizations.org_type',
        ])
        .where('memberships.user_id', '=', userId)
        .where('memberships.status', '=', 'ACTIVE')
        .where('organizations.status', '=', 'ACTIVE')
        .orderBy('organizations.legal_name')
        .execute(),
    );
    return rows.filter((row) => isRoleCompatibleWithOrg(row.role, row.org_type));
  }

  private toTokenPayload(user: AuthUserContext): AuthTokenPayload {
    return {
      sub: user.user_id,
      email: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
      org_type: user.org_type,
      mfa_verified: user.mfa_verified,
    };
  }

  private normalizeEmail(email: unknown): string {
    if (typeof email !== 'string') {
      throw new BadRequestException('A valid email address is required');
    }
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('A valid email address is required');
    }
    return normalized;
  }

  private validateNewPassword(password: unknown): asserts password is string {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new BadRequestException('Password must be between 12 and 128 characters');
    }
  }
}
