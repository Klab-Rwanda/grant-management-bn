import { AuthTokenPayload, AuthUserContext, Role } from '@grant-ledger/shared';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { IAuthProvider } from './auth.interface';

@Injectable()
export class StubJwtAuthProvider implements IAuthProvider {
  private readonly secret: string;

  constructor() {
    this.secret = process.env.AUTH_JWT_SECRET ?? 'dev-insecure-jwt-secret-do-not-use-in-prod';
  }

  async issueDevToken(payload: AuthTokenPayload): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp ?? now + 24 * 60 * 60; // 24 hours

    const fullPayload: AuthTokenPayload = {
      ...payload,
      iat: payload.iat ?? now,
      exp,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

    const signature = createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  async verifyToken(token: string): Promise<AuthUserContext> {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Token is missing');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid JWT format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    if (!encodedHeader || !encodedPayload || !signature) {
      throw new UnauthorizedException('Malformed token parts');
    }

    const expectedSignature = createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Invalid token signature');
    }

    let parsedPayload: AuthTokenPayload;
    try {
      parsedPayload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as AuthTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid token payload JSON');
    }

    const now = Math.floor(Date.now() / 1000);
    if (parsedPayload.exp && parsedPayload.exp < now) {
      throw new UnauthorizedException('Token has expired');
    }

    if (
      !parsedPayload.sub ||
      !parsedPayload.tenant_id ||
      !parsedPayload.role ||
      !parsedPayload.org_type
    ) {
      throw new UnauthorizedException('Token payload is missing required security claims');
    }

    return {
      user_id: parsedPayload.sub,
      email: parsedPayload.email,
      tenant_id: parsedPayload.tenant_id,
      role: parsedPayload.role as Role,
      org_type: parsedPayload.org_type,
      mfa_verified: parsedPayload.mfa_verified ?? false,
    };
  }

  // Hook point implementations for future MFA
  async initiateMfaChallenge(userId: string): Promise<{ challengeId: string }> {
    return { challengeId: `mfa-stub-${userId}-${Date.now()}` };
  }

  async verifyMfa(_challengeId: string, code: string): Promise<boolean> {
    return code === '123456';
  }

  // Hook point implementation for future SSO
  async handleSsoCallback(provider: string, _code: string): Promise<AuthUserContext> {
    return {
      user_id: 'sso-user-stub',
      email: `sso-user@${provider}.local`,
      tenant_id: 'sso-tenant-stub',
      role: 'FIN',
      org_type: 'STARTUP',
      mfa_verified: true,
    };
  }
}
