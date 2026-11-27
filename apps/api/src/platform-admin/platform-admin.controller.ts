import type { OrgStatus } from '@grant-ledger/shared';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthUserContext } from '@grant-ledger/shared';
import { PlatformAdminService } from './platform-admin.service';
import type { CreateWorkspaceInput } from './platform-admin.service';

@ApiTags('Platform administration')
@ApiBearerAuth()
@UseGuards(AuthGuard, AuthorizationGuard)
@Roles('ADM')
@Controller('admin')
export class PlatformAdminController {
  constructor(private readonly platformAdmin: PlatformAdminService) {}

  @Get('workspaces')
  @ApiOperation({ summary: 'List startup and institution workspaces' })
  listWorkspaces(@CurrentUser() actor: AuthUserContext) {
    return this.platformAdmin.listWorkspaces(actor);
  }

  @Post('workspaces')
  @ApiOperation({ summary: 'Create a workspace and invite its initial administrator' })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'legal_name',
        'org_type',
        'country',
        'functional_currency',
        'fiscal_year_start_month',
        'initial_admin_email',
      ],
      properties: {
        legal_name: { type: 'string', minLength: 2, maxLength: 200 },
        org_type: { type: 'string', enum: ['STARTUP', 'INSTITUTION'] },
        country: { type: 'string', pattern: '^[A-Za-z]{2}$' },
        functional_currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
        fiscal_year_start_month: { type: 'integer', minimum: 1, maximum: 12 },
        initial_admin_email: { type: 'string', format: 'email' },
        tax_id: { type: 'string', maxLength: 100 },
      },
    },
  })
  createWorkspace(@CurrentUser() actor: AuthUserContext, @Body() input: CreateWorkspaceInput) {
    return this.platformAdmin.createWorkspace(actor, input);
  }

  @Patch('workspaces/:id/status')
  @ApiOperation({ summary: 'Suspend or reactivate a workspace' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
      },
    },
  })
  setWorkspaceStatus(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') workspaceId: string,
    @Body('status') status: OrgStatus,
  ) {
    return this.platformAdmin.setWorkspaceStatus(actor, workspaceId, status);
  }

  @Get('memberships')
  @ApiOperation({ summary: 'List workspace memberships and invitations' })
  @ApiQuery({ name: 'workspace_id', required: false, format: 'uuid' })
  listMemberships(
    @CurrentUser() actor: AuthUserContext,
    @Query('workspace_id') workspaceId?: string,
  ) {
    return this.platformAdmin.listMemberships(actor, workspaceId);
  }

  @Patch('memberships/:id/status')
  @ApiOperation({ summary: 'Suspend or reactivate a workspace membership' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
      },
    },
  })
  setMembershipStatus(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') membershipId: string,
    @Body('status') status: 'ACTIVE' | 'SUSPENDED',
  ) {
    return this.platformAdmin.setMembershipStatus(actor, membershipId, status);
  }

  @Get('audit-events')
  @ApiOperation({ summary: 'Search cross-workspace audit event metadata' })
  @ApiQuery({ name: 'workspace_id', required: false, format: 'uuid' })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'before', required: false, format: 'date-time' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 500 })
  listAuditEvents(
    @CurrentUser() actor: AuthUserContext,
    @Query('workspace_id') workspaceId?: string,
    @Query('action') action?: string,
    @Query('before') before?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    return this.platformAdmin.listAuditEvents(actor, { workspaceId, action, before, limit });
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get count-only portfolio analytics' })
  getAnalytics(@CurrentUser() actor: AuthUserContext) {
    return this.platformAdmin.getAnalytics(actor);
  }

  @Get('integrations/bank-statement-imports')
  @ApiOperation({ summary: 'List tenant bank statement import metadata' })
  listStatementImports(@CurrentUser() actor: AuthUserContext) {
    return this.platformAdmin.listStatementImports(actor);
  }
}
