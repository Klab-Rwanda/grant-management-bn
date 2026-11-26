import { Global, Module } from '@nestjs/common';
import { AuditVerifierService } from './audit-verifier.service';
import { AuditLogService } from './audit.service';

@Global()
@Module({
  providers: [AuditLogService, AuditVerifierService],
  exports: [AuditLogService, AuditVerifierService],
})
export class AuditModule {}
