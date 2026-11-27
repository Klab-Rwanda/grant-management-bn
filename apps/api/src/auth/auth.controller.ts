import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import { CurrentUser, Public } from './auth.decorators';
import { AuthService } from './auth.service';
import type { AcceptInvitationInput, LoginInput } from './auth.service';
import type { AuthUserContext } from '@grant-ledger/shared';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() input: LoginInput) {
    return this.authService.login(input);
  }

  @Public()
  @Post('accept-invitation')
  @HttpCode(200)
  acceptInvitation(@Body() input: AcceptInvitationInput) {
    return this.authService.acceptInvitation(input);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  getCurrentUser(@CurrentUser() user: AuthUserContext): AuthUserContext {
    return user;
  }
}
