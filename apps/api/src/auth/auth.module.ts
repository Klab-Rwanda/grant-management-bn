import { Global, Module } from '@nestjs/common';
import { AUTH_PROVIDER } from './auth.interface';
import { AuthGuard } from './auth.guard';
import { AuthorizationGuard } from './authorization.guard';
import { SegregationOfDutiesService } from './sod.service';
import { StubJwtAuthProvider } from './stub-jwt.service';

@Global()
@Module({
  providers: [
    {
      provide: AUTH_PROVIDER,
      useClass: StubJwtAuthProvider,
    },
    StubJwtAuthProvider,
    AuthGuard,
    AuthorizationGuard,
    SegregationOfDutiesService,
  ],
  exports: [
    AUTH_PROVIDER,
    StubJwtAuthProvider,
    AuthGuard,
    AuthorizationGuard,
    SegregationOfDutiesService,
  ],
})
export class AuthModule {}
