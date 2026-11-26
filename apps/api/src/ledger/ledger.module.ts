import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AccountingPeriodsService } from './accounting-periods.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { FinancialReportsService } from './financial-reports.service';
import { JournalEntriesService } from './journal-entries.service';
import { LedgerController } from './ledger.controller';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [LedgerController],
  providers: [
    ChartOfAccountsService,
    AccountingPeriodsService,
    JournalEntriesService,
    FinancialReportsService,
  ],
  exports: [
    ChartOfAccountsService,
    AccountingPeriodsService,
    JournalEntriesService,
    FinancialReportsService,
  ],
})
export class LedgerModule {}
