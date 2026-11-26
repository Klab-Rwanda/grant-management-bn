import { isInstitutionRole, isPlatformRole, isStartupRole, Role } from '@grant-ledger/shared';
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

    // If no roles are required on the route, pass
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    // Role check
    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Role '${user.role}' is not authorized. Required: [${requiredRoles.join(', ')}]`,
      );
    }

    // Workspace type compatibility check
    if (user.org_type === 'STARTUP' && !isStartupRole(user.role)) {
      throw new ForbiddenException(`Role '${user.role}' is incompatible with STARTUP workspace`);
    }

    if (user.org_type === 'INSTITUTION' && !isInstitutionRole(user.role)) {
      throw new ForbiddenException(
        `Role '${user.role}' is incompatible with INSTITUTION workspace`,
      );
    }

    if (user.org_type === 'PLATFORM' && !isPlatformRole(user.role)) {
      throw new ForbiddenException(`Role '${user.role}' is incompatible with PLATFORM workspace`);
    }

    return true;
  }
}
