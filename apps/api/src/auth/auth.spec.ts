import { AuthTokenPayload, Role } from '@grant-ledger/shared';
import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { GrantController } from '../grant/grant.controller';
import { LedgerController } from '../ledger/ledger.controller';
import { ROLES_KEY } from './auth.decorators';
import { AuthorizationGuard } from './authorization.guard';
import { SegregationOfDutiesService } from './sod.service';
import { JwtAuthProvider } from './jwt-auth.service';

describe('JwtAuthProvider', () => {
  const provider = new JwtAuthProvider('test-secret-key-1234567890');

  it('issues and verifies a valid dev JWT', async () => {
    const payload: AuthTokenPayload = {
      sub: 'usr-123',
      email: 'founder@startup.io',
      tenant_id: 'org-startup-1',
      role: 'FDR',
      org_type: 'STARTUP',
      mfa_verified: true,
    };

    const token = await provider.issueToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const verified = await provider.verifyToken(token);
    expect(verified).toMatchObject({
      user_id: 'usr-123',
      email: 'founder@startup.io',
      tenant_id: 'org-startup-1',
      role: 'FDR',
      org_type: 'STARTUP',
      mfa_verified: true,
    });
  });

  it('rejects tampered token', async () => {
    const token = await provider.issueToken({
      sub: 'usr-1',
      email: 'a@b.com',
      tenant_id: 't-1',
      role: 'FIN',
      org_type: 'STARTUP',
    });

    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.tampered-signature`;

    await expect(provider.verifyToken(tampered)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects expired token', async () => {
    const expiredToken = await provider.issueToken({
      sub: 'usr-1',
      email: 'a@b.com',
      tenant_id: 't-1',
      role: 'FIN',
      org_type: 'STARTUP',
      exp: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
    });

    await expect(provider.verifyToken(expiredToken)).rejects.toThrow('Token has expired');
  });

  it('rejects a role claim that does not match its workspace', async () => {
    const token = await provider.issueToken({
      sub: 'usr-1',
      email: 'reviewer@institution.io',
      tenant_id: 't-1',
      role: 'PM',
      org_type: 'STARTUP',
    });

    await expect(provider.verifyToken(token)).rejects.toThrow(
      'Token role is incompatible with its workspace type',
    );
  });

  it('requires a configured, non-example signing secret in production', () => {
    expect(() => new JwtAuthProvider('', 'production')).toThrow(
      'AUTH_JWT_SECRET must be configured with a unique secret in production',
    );
    expect(() => new JwtAuthProvider('a'.repeat(32), 'production')).not.toThrow();
  });
});

describe('SegregationOfDutiesService', () => {
  const sod = new SegregationOfDutiesService();

  it('throws when preparer equals approver', () => {
    expect(() => sod.assertPreparerNotApprover('user-1', 'user-1')).toThrow(ConflictException);
    expect(() => sod.assertPreparerNotApprover('user-1', 'user-2')).not.toThrow();
  });

  it('throws when reviewer is committee approver on the same tranche', () => {
    expect(() => sod.assertReviewerNotCommitteeApprover('user-1', 'user-1')).toThrow(
      ConflictException,
    );
    expect(() => sod.assertReviewerNotCommitteeApprover(['user-2', 'user-3'], 'user-2')).toThrow(
      ConflictException,
    );
    expect(() =>
      sod.assertReviewerNotCommitteeApprover(['user-2', 'user-3'], 'user-4'),
    ).not.toThrow();
  });

  it('throws when payment recorder equals confirmer', () => {
    expect(() => sod.assertDisbursementRecorderNotConfirmer('user-1', 'user-1')).toThrow(
      ConflictException,
    );
    expect(() => sod.assertDisbursementRecorderNotConfirmer('user-1', 'user-2')).not.toThrow();
  });
});

describe('AuthorizationGuard', () => {
  it('enforces role and workspace compatibility', () => {
    const reflector = {
      getAllAndOverride: (key: string) => {
        if (key === 'roles') return ['FDR', 'FIN'] as Role[];
        return undefined;
      },
    } as unknown as Reflector;

    const guard = new AuthorizationGuard(reflector);

    const createCtx = (role: Role, orgType: 'STARTUP' | 'INSTITUTION' | 'PLATFORM') =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            user: { role, org_type: orgType, user_id: 'u1', tenant_id: 't1', email: 'e' },
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      }) as unknown as ExecutionContext;

    expect(guard.canActivate(createCtx('FIN', 'STARTUP'))).toBe(true);
    expect(() => guard.canActivate(createCtx('PM', 'STARTUP'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(createCtx('REV', 'INSTITUTION'))).toThrow(ForbiddenException);
  });

  it('enforces workspace compatibility even when a route has no role metadata', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new AuthorizationGuard(reflector);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: 'PM', org_type: 'STARTUP', user_id: 'u1', tenant_id: 't1', email: 'e' },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

describe('Documented endpoint role boundaries', () => {
  it('keeps startup ledger writes restricted to FDR and FIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, LedgerController.prototype.recordExpense)).toEqual([
      'FDR',
      'FIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, LedgerController.prototype.getEntryById)).toEqual([
      'FDR',
      'FIN',
      'OPS',
    ]);
  });

  it('grants shared grant reads to the documented startup and institution roles', () => {
    const sharedReadRoles = ['PM', 'REV', 'APR', 'FDR', 'FIN', 'OPS'];

    expect(Reflect.getMetadata(ROLES_KEY, GrantController.prototype.getGrant)).toEqual(
      sharedReadRoles,
    );
    expect(Reflect.getMetadata(ROLES_KEY, GrantController.prototype.listMilestones)).toEqual(
      sharedReadRoles,
    );
    expect(Reflect.getMetadata(ROLES_KEY, GrantController.prototype.listBudgets)).toEqual(
      sharedReadRoles,
    );
  });

  it('keeps grant configuration writes with the institution program manager', () => {
    expect(Reflect.getMetadata(ROLES_KEY, GrantController.prototype.createGrant)).toEqual(['PM']);
    expect(Reflect.getMetadata(ROLES_KEY, GrantController.prototype.createMilestone)).toEqual([
      'PM',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, GrantController.prototype.createBudget)).toEqual(['PM']);
  });
});
