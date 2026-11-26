import { AuthTokenPayload, Role } from '@grant-ledger/shared';
import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthorizationGuard } from './authorization.guard';
import { SegregationOfDutiesService } from './sod.service';
import { StubJwtAuthProvider } from './stub-jwt.service';

describe('StubJwtAuthProvider', () => {
  const provider = new StubJwtAuthProvider('test-secret-key-1234567890');

  it('issues and verifies a valid dev JWT', async () => {
    const payload: AuthTokenPayload = {
      sub: 'usr-123',
      email: 'founder@startup.io',
      tenant_id: 'org-startup-1',
      role: 'FDR',
      org_type: 'STARTUP',
      mfa_verified: true,
    };

    const token = await provider.issueDevToken(payload);
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
    const token = await provider.issueDevToken({
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
    const expiredToken = await provider.issueDevToken({
      sub: 'usr-1',
      email: 'a@b.com',
      tenant_id: 't-1',
      role: 'FIN',
      org_type: 'STARTUP',
      exp: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
    });

    await expect(provider.verifyToken(expiredToken)).rejects.toThrow('Token has expired');
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
});
