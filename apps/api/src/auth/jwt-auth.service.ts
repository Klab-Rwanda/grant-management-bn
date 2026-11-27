import {
  AuthTokenPayload,
  AuthUserContext,
  isOrgType,
  isRole,
  isRoleCompatibleWithOrg,
} from '@grant-ledger/shared';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IAuthProvider } from './auth.interface';

@Injectable()
export class JwtAuthProvider implements IAuthProvider {
  private readonly secret: string;

  constructor(secret?: string, nodeEnv = process.env.NODE_ENV) {
    const configuredSecret = secret ?? process.env.AUTH_JWT_SECRET;
    if (
      nodeEnv === 'production' &&
      (!configuredSecret ||
        configuredSecret === 'replace-with-a-random-secret-at-least-32-characters')
    ) {
      throw new Error('AUTH_JWT_SECRET must be configured with a unique secret in production');
    }

    this.secret = configuredSecret ?? randomBytes(32).toString('base64url');
  }

  async issueToken(payload: AuthTokenPayload): Promise<string> {
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
    if (typeof parsedPayload.exp !== 'number' || parsedPayload.exp <= now) {
      throw new UnauthorizedException('Token has expired');
    }

    if (!parsedPayload.sub || !parsedPayload.email || !parsedPayload.tenant_id) {
      throw new UnauthorizedException('Token payload is missing required security claims');
    }

    if (!isRole(parsedPayload.role) || !isOrgType(parsedPayload.org_type)) {
      throw new UnauthorizedException('Token contains an unsupported role or workspace type');
    }

    if (!isRoleCompatibleWithOrg(parsedPayload.role, parsedPayload.org_type)) {
      throw new UnauthorizedException('Token role is incompatible with its workspace type');
    }

    return {
      user_id: parsedPayload.sub,
      email: parsedPayload.email,
      tenant_id: parsedPayload.tenant_id,
      role: parsedPayload.role,
      org_type: parsedPayload.org_type,
      mfa_verified: parsedPayload.mfa_verified ?? false,
    };
  }
}
