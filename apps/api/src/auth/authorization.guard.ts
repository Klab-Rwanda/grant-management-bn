import { isRoleCompatibleWithOrg, Role } from '@grant-ledger/shared';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './auth.guard';
import { ROLES_KEY } from './auth.decorators';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    if (!isRoleCompatibleWithOrg(user.role, user.org_type)) {
      throw new ForbiddenException(`Role '${user.role}' is incompatible with ${user.org_type} workspace`);
    }

    // If no roles are required on the route, workspace compatibility is still enforced.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Role check
    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Role '${user.role}' is not authorized. Required: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
