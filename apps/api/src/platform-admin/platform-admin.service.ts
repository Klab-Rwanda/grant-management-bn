import type { AuthUserContext, OrgStatus, OrgType, Role } from '@grant-ledger/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { AuditLogService } from '../audit/audit.service';
import { EnvService } from '../config/env';
import { TenantContextService } from '../database/tenant-context.service';
import { AuthMailerService } from '../auth/auth-mailer.service';
import { StateMachineService } from '../state-machine/state-machine.service';

export interface CreateWorkspaceInput {
  legal_name: string;
  org_type: 'STARTUP' | 'INSTITUTION';
  country: string;
  functional_currency: string;
  fiscal_year_start_month: number;
  initial_admin_email: string;
  tax_id?: string;
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditLog: AuditLogService,
    private readonly mailer: AuthMailerService,
    private readonly env: EnvService,
    private readonly stateMachine: StateMachineService,
  ) {}

  async listWorkspaces(actor: AuthUserContext) {
    this.assertPlatformAdmin(actor);
    return this.tenantContext.withPlatformContext(actor, async (tx) => {
      const workspaces = await tx
        .selectFrom('organizations')
        .select([
          'id',
          'legal_name',
          'org_type',
          'country',
          'functional_currency',
          'status',
          'created_at',
        ])
        .where('org_type', '!=', 'PLATFORM')
        .orderBy('created_at', 'desc')
        .limit(200)
        .execute();
      const ids = workspaces.map((workspace) => workspace.id);
      if (ids.length === 0) return [];

      const memberships = await tx
        .selectFrom('memberships')
        .select(['tenant_id', 'status'])
        .where('tenant_id', 'in', ids)
        .execute();
      const counts = new Map<string, { active: number; invited: number; suspended: number }>();
      for (const membership of memberships) {
        const row = counts.get(membership.tenant_id) ?? { active: 0, invited: 0, suspended: 0 };
        if (membership.status === 'ACTIVE') row.active += 1;
        if (membership.status === 'INVITED') row.invited += 1;
        if (membership.status === 'SUSPENDED') row.suspended += 1;
        counts.set(membership.tenant_id, row);
      }
      return workspaces.map((workspace) => ({
        ...workspace,
        memberships: counts.get(workspace.id) ?? { active: 0, invited: 0, suspended: 0 },
      }));
    });
  }

  async createWorkspace(actor: AuthUserContext, input: CreateWorkspaceInput) {
    this.assertPlatformAdmin(actor);
    const workspace = this.validateWorkspaceInput(input);
    const email = this.normalizeEmail(input.initial_admin_email);
    const role: Role = workspace.org_type === 'STARTUP' ? 'FDR' : 'PM';
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const created = await this.tenantContext.withPlatformContext(actor, async (tx) => {
      const organization = await tx
        .insertInto('organizations')
        .values({
          legal_name: workspace.legal_name,
          org_type: workspace.org_type,
          country: workspace.country,
          functional_currency: workspace.functional_currency,
          fiscal_year_start_month: workspace.fiscal_year_start_month,
          tax_id: workspace.tax_id,
        })
        .returning(['id', 'legal_name', 'org_type', 'status'])
        .executeTakeFirstOrThrow();

      const invitation = await tx
        .insertInto('invitations')
        .values({
          tenant_id: organization.id,
          email,
          role,
          token_hash: tokenHash,
          invited_by_user_id: actor.user_id,
          expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.auditLog.appendAuditLog(tx, {
        tenant_id: organization.id,
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'PLATFORM_WORKSPACE_CREATED',
        entity_type: 'organization',
        entity_id: organization.id,
        after_state: {
          legal_name: organization.legal_name,
          org_type: organization.org_type,
          country: workspace.country,
          functional_currency: workspace.functional_currency,
          initial_admin_email: email,
          initial_admin_role: role,
        },
      });
      await this.auditLog.appendAuditLog(tx, {
        tenant_id: organization.id,
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'INVITATION_CREATED',
        entity_type: 'invitation',
        entity_id: invitation.id,
        after_state: { email, role, expires_at: expiresAt },
      });

      return { organization, invitation_id: invitation.id };
    });

    const invitationUrl = new URL('/accept-invitation', this.env.config.WEB_BASE_URL);
    invitationUrl.searchParams.set('token', token);
    try {
      await this.mailer.sendInvitation(email, invitationUrl.toString());
    } catch {
      throw new ServiceUnavailableException({
        message:
          'The workspace was created, but invitation email delivery failed. Share this URL securely with the initial administrator.',
        workspace_id: created.organization.id,
        invitation_url: invitationUrl.toString(),
      });
    }

    return {
      workspace: created.organization,
      invitation_id: created.invitation_id,
      initial_admin_email: email,
      initial_admin_role: role,
      invitation_expires_at: expiresAt,
    };
  }

  async setWorkspaceStatus(actor: AuthUserContext, workspaceId: string, status: OrgStatus) {
    this.assertPlatformAdmin(actor);
    this.assertUuid(workspaceId);
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
      throw new BadRequestException('Workspace status must be ACTIVE or SUSPENDED');
    }

    return this.tenantContext.withPlatformContext(actor, async (tx) => {
      const workspace = await tx
        .selectFrom('organizations')
        .select(['id', 'legal_name', 'org_type', 'status'])
        .where('id', '=', workspaceId)
        .where('org_type', '!=', 'PLATFORM')
        .forUpdate()
        .executeTakeFirst();
      if (!workspace) throw new NotFoundException('Workspace not found');
      if (workspace.status === status) return workspace;

      return this.stateMachine.transitionWorkspace(tx, actor, workspace, status);
    });
  }

  async listMemberships(actor: AuthUserContext, workspaceId?: string) {
    this.assertPlatformAdmin(actor);
    if (workspaceId) this.assertUuid(workspaceId);
    return this.tenantContext.withPlatformContext(actor, async (tx) => {
      let membershipsQuery = tx
        .selectFrom('memberships')
        .innerJoin('users', 'users.id', 'memberships.user_id')
        .innerJoin('organizations', 'organizations.id', 'memberships.tenant_id')
        .select([
          'memberships.id',
          'memberships.tenant_id',
          'memberships.user_id',
          'memberships.role',
          'memberships.status',
          'memberships.created_at',
          'users.email',
          'users.full_name',
          'users.status as user_status',
          'organizations.legal_name',
          'organizations.org_type',
          'organizations.status as workspace_status',
        ])
        .where('organizations.org_type', '!=', 'PLATFORM')
        .orderBy('organizations.legal_name')
        .orderBy('users.email')
        .limit(500);
      if (workspaceId)
        membershipsQuery = membershipsQuery.where('memberships.tenant_id', '=', workspaceId);

      let invitationsQuery = tx
        .selectFrom('invitations')
        .innerJoin('organizations', 'organizations.id', 'invitations.tenant_id')
        .select([
          'invitations.id',
          'invitations.tenant_id',
          'invitations.email',
          'invitations.role',
          'invitations.expires_at',
          'invitations.accepted_at',
          'invitations.created_at',
          'organizations.legal_name',
        ])
        .where('organizations.org_type', '!=', 'PLATFORM')
        .orderBy('invitations.created_at', 'desc')
        .limit(500);
      if (workspaceId)
        invitationsQuery = invitationsQuery.where('invitations.tenant_id', '=', workspaceId);

      const [memberships, invitations] = await Promise.all([
        membershipsQuery.execute(),
        invitationsQuery.execute(),
      ]);
      return { memberships, invitations };
    });
  }

  async setMembershipStatus(
    actor: AuthUserContext,
    membershipId: string,
    status: 'ACTIVE' | 'SUSPENDED',
  ) {
    this.assertPlatformAdmin(actor);
    this.assertUuid(membershipId);
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
      throw new BadRequestException('Membership status must be ACTIVE or SUSPENDED');
    }

    return this.tenantContext.withPlatformContext(actor, async (tx) => {
      const membership = await tx
        .selectFrom('memberships')
        .innerJoin('organizations', 'organizations.id', 'memberships.tenant_id')
        .innerJoin('users', 'users.id', 'memberships.user_id')
        .select([
          'memberships.id',
          'memberships.tenant_id',
          'memberships.user_id',
          'memberships.role',
          'memberships.status',
          'users.status as user_status',
          'organizations.org_type',
          'organizations.status as workspace_status',
        ])
        .where('memberships.id', '=', membershipId)
        .where('organizations.org_type', '!=', 'PLATFORM')
        .forUpdate()
        .executeTakeFirst();
      if (!membership) throw new NotFoundException('Workspace membership not found');
      if (membership.status === status) return membership;

      if (status === 'ACTIVE') {
        if (membership.user_status !== 'ACTIVE' || membership.workspace_status !== 'ACTIVE') {
          throw new ConflictException(
            'Reactivate the user account and workspace before this membership',
          );
        }
      } else {
        const administratorRole = this.administratorRole(membership.org_type);
        if (membership.role === administratorRole && membership.status === 'ACTIVE') {
          const admins = await tx
            .selectFrom('memberships')
            .select(({ fn }) => fn.countAll<number>().as('count'))
            .where('tenant_id', '=', membership.tenant_id)
            .where('role', '=', administratorRole)
            .where('status', '=', 'ACTIVE')
            .executeTakeFirstOrThrow();
          if (Number(admins.count) <= 1) {
            throw new ConflictException(
              'A workspace must retain at least one active administrator',
            );
          }
        }
      }

      return this.stateMachine.transitionMembership(tx, actor, membership, status);
    });
  }

  async listAuditEvents(
    actor: AuthUserContext,
    filters: { workspaceId?: string; action?: string; before?: string; limit?: number },
  ) {
    this.assertPlatformAdmin(actor);
    const limit = filters.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('limit must be an integer between 1 and 500');
    }
    if (filters.before && Number.isNaN(Date.parse(filters.before))) {
      throw new BadRequestException('before must be a valid timestamp');
    }
    if (filters.workspaceId) this.assertUuid(filters.workspaceId);

    return this.tenantContext.withPlatformContext(actor, async (tx) => {
      let query = tx
        .selectFrom('audit_logs')
        .innerJoin('organizations', 'organizations.id', 'audit_logs.tenant_id')
        .select([
          'audit_logs.id',
          'audit_logs.tenant_id',
          'audit_logs.seq_no',
          'audit_logs.actor_id',
          'audit_logs.actor_type',
          'audit_logs.action',
          'audit_logs.entity_type',
          'audit_logs.entity_id',
          'audit_logs.created_at',
          'organizations.legal_name',
          'organizations.org_type',
        ])
        .orderBy('audit_logs.created_at', 'desc')
        .limit(limit);
      if (filters.workspaceId)
        query = query.where('audit_logs.tenant_id', '=', filters.workspaceId);
      if (filters.action) query = query.where('audit_logs.action', '=', filters.action);
      if (filters.before) query = query.where('audit_logs.created_at', '<', filters.before);
      return query.execute();
    });
  }

  async getAnalytics(actor: AuthUserContext) {
    this.assertPlatformAdmin(actor);
    return this.tenantContext.withOwnerContext(async (tx) => {
      const organizations = await tx
        .selectFrom('organizations')
        .select(['org_type', 'status'])
        .where('org_type', '!=', 'PLATFORM')
        .execute();
      const grants = await tx.selectFrom('grants').select('status').execute();
      const workspaces: Record<string, number> = {};
      const workspaceStatuses: Record<string, number> = {};
      for (const row of organizations) {
        workspaces[row.org_type] = (workspaces[row.org_type] ?? 0) + 1;
        workspaceStatuses[row.status] = (workspaceStatuses[row.status] ?? 0) + 1;
      }
      const grantsByStatus: Record<string, number> = {};
      for (const row of grants) grantsByStatus[row.status] = (grantsByStatus[row.status] ?? 0) + 1;
      return {
        workspace_count: organizations.length,
        workspaces_by_type: workspaces,
        workspaces_by_status: workspaceStatuses,
        grant_count: grants.length,
        grants_by_status: grantsByStatus,
      };
    });
  }

  async listStatementImports(actor: AuthUserContext) {
    this.assertPlatformAdmin(actor);
    return this.tenantContext.withPlatformContext(actor, (tx) =>
      tx
        .selectFrom('bank_statement_imports')
        .innerJoin('organizations', 'organizations.id', 'bank_statement_imports.tenant_id')
        .select([
          'bank_statement_imports.id',
          'bank_statement_imports.tenant_id',
          'organizations.legal_name',
          'bank_statement_imports.statement_format',
          'bank_statement_imports.status',
          'bank_statement_imports.transaction_count',
          'bank_statement_imports.created_at',
        ])
        .orderBy('bank_statement_imports.created_at', 'desc')
        .limit(100)
        .execute(),
    );
  }

  private assertPlatformAdmin(actor: AuthUserContext): void {
    if (actor.role !== 'ADM' || actor.org_type !== 'PLATFORM') {
      throw new ForbiddenException('Platform administrator access is required');
    }
  }

  private validateWorkspaceInput(input: CreateWorkspaceInput) {
    if (!input || (input.org_type !== 'STARTUP' && input.org_type !== 'INSTITUTION')) {
      throw new BadRequestException('Workspace type must be STARTUP or INSTITUTION');
    }
    const legalName = typeof input.legal_name === 'string' ? input.legal_name.trim() : '';
    const country = typeof input.country === 'string' ? input.country.trim().toUpperCase() : '';
    const currency =
      typeof input.functional_currency === 'string'
        ? input.functional_currency.trim().toUpperCase()
        : '';
    const month = input.fiscal_year_start_month;
    if (legalName.length < 2 || legalName.length > 200) {
      throw new BadRequestException('Legal name must be between 2 and 200 characters');
    }
    if (!/^[A-Z]{2}$/.test(country))
      throw new BadRequestException('Country must be a 2-letter ISO code');
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('Functional currency must be a 3-letter ISO 4217 code');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Fiscal-year start month must be between 1 and 12');
    }
    if (input.tax_id !== undefined && typeof input.tax_id !== 'string') {
      throw new BadRequestException('Tax ID must be a string');
    }
    const taxId = input.tax_id?.trim();
    if (taxId && taxId.length > 100)
      throw new BadRequestException('Tax ID must not exceed 100 characters');
    return {
      legal_name: legalName,
      org_type: input.org_type as OrgType,
      country,
      functional_currency: currency,
      fiscal_year_start_month: month,
      tax_id: taxId || null,
    };
  }

  private normalizeEmail(value: unknown): string {
    if (typeof value !== 'string')
      throw new BadRequestException('A valid initial administrator email is required');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid initial administrator email is required');
    }
    return email;
  }

  private assertUuid(value: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException('A valid UUID is required');
    }
  }

  private administratorRole(orgType: OrgType): Role {
    if (orgType === 'STARTUP') return 'FDR';
    if (orgType === 'INSTITUTION') return 'PM';
    throw new BadRequestException('Platform workspaces cannot have tenant memberships');
  }
}
