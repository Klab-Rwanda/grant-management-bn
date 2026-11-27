import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import { AuthorizationGuard } from './authorization.guard';
import { CurrentUser, Roles } from './auth.decorators';
import { AuthService } from './auth.service';
import type { InvitationInput } from './auth.service';
import type { AuthUserContext } from '@grant-ledger/shared';

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(AuthGuard, AuthorizationGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @Roles('FDR', 'PM', 'ADM')
  create(
    @CurrentUser() user: AuthUserContext,
    @Body() input: InvitationInput,
  ): Promise<{ invitation_id: string; email: string; expires_at: string; invitation_url: string }> {
    return this.authService.createInvitation(user, input);
  }
}
