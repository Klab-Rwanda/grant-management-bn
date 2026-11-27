import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AppEnv, ENV_CONFIG, EnvService, loadAppEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { GrantModule } from './grant/grant.module';
import { LedgerModule } from './ledger/ledger.module';
import { JsonLoggerService } from './logging/logger.service';
import { RequestContextMiddleware } from './logging/request-context.middleware';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { BankStatementsModule } from './bank-statements/bank-statements.module';

@Global()
@Module({
  providers: [
    {
      provide: ENV_CONFIG,
      useFactory: (): AppEnv => loadAppEnv(),
    },
    EnvService,
    {
      provide: JsonLoggerService,
      inject: [EnvService],
      useFactory: (envService: EnvService) => new JsonLoggerService(envService.config.LOG_LEVEL),
    },
  ],
  exports: [ENV_CONFIG, EnvService, JsonLoggerService],
})
class CoreModule {}

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    AuthModule,
    AuditModule,
    LedgerModule,
    GrantModule,
    PlatformAdminModule,
    BankStatementsModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
