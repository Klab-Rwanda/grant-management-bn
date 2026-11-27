import type { AuthUserContext } from '@grant-ledger/shared';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { runWithRequestContext } from '../logging/request-context';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { AUTH_PROVIDER } from './auth.interface';
import type { IAuthProvider } from './auth.interface';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest extends Request {
  user: AuthUserContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization header with Bearer token is required');
    }

    const token = authHeader.substring(7).trim();
    const userContext = await this.authProvider.verifyToken(token);
    await this.authService.validateSession(userContext);

    request.user = userContext;

    // Enhance async local storage so downstream structured logs capture the tenant_id
    const requestId = (request.headers['x-request-id'] as string) || 'system';
    runWithRequestContext({ request_id: requestId, tenant_id: userContext.tenant_id }, () => {});

    return true;
  }
}
