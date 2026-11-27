import { Global, Module } from '@nestjs/common';
import { AUTH_PROVIDER } from './auth.interface';
import { AuthGuard } from './auth.guard';
import { AuthorizationGuard } from './authorization.guard';
import { SegregationOfDutiesService } from './sod.service';
import { AuthService } from './auth.service';
import { JwtAuthProvider } from './jwt-auth.service';
import { AuthMailerService } from './auth-mailer.service';
import { AuthController } from './auth.controller';
import { InvitationsController } from './invitations.controller';
import { EnvService } from '../config/env';
import { PasswordHasherService } from './password-hasher.service';

@Global()
@Module({
  controllers: [AuthController, InvitationsController],
  providers: [
    {
      provide: AUTH_PROVIDER,
      inject: [EnvService],
      useFactory: (env: EnvService) =>
        new JwtAuthProvider(env.config.AUTH_JWT_SECRET, env.config.NODE_ENV),
    },
    AuthGuard,
    AuthorizationGuard,
    SegregationOfDutiesService,
    AuthService,
    AuthMailerService,
    PasswordHasherService,
  ],
  exports: [
    AUTH_PROVIDER,
    AuthGuard,
    AuthorizationGuard,
    SegregationOfDutiesService,
    AuthService,
    AuthMailerService,
    PasswordHasherService,
  ],
})
export class AuthModule {}
