import type {
  AccountDto,
  AccountingPeriodDto,
  AccountType,
  AuthUserContext,
  BalanceSheetReportDto,
  BurnAndRunwayReportDto,
  GeneralLedgerLineDto,
  JournalEntryDto,
  ProfitAndLossReportDto,
  TrialBalanceReportDto,
} from '@grant-ledger/shared';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentTenant, CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { AccountingPeriodsService } from './accounting-periods.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { FinancialReportsService } from './financial-reports.service';
import { JournalEntriesService } from './journal-entries.service';

export class CreateAccountRequestDto {
  @ApiProperty({ type: String, example: '1010' })
  code!: string;

  @ApiProperty({ type: String, example: 'Operating bank account' })
  name!: string;

  @ApiProperty({ type: String, enum: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] })
  account_type!: AccountType;

  @ApiPropertyOptional({ type: String, example: 'CASH_AND_BANK' })
  account_subtype?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: false })
  is_contra?: boolean;

  @ApiPropertyOptional({ type: String, example: null })
  parent_id?: string | null;
}

export class UpdateAccountRequestDto {
  @ApiPropertyOptional({ type: String, example: '1010' })
  code?: string;

  @ApiPropertyOptional({ type: String, example: 'Operating bank account' })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    enum: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'],
  })
  account_type?: AccountType;

  @ApiPropertyOptional({ type: String, example: 'CASH_AND_BANK' })
  account_subtype?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: false })
  is_contra?: boolean;

  @ApiPropertyOptional({ type: String, example: null })
  parent_id?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: false })
  is_archived?: boolean;
}

export class CreateAccountingPeriodRequestDto {
  @ApiProperty({ type: String, example: '2026-01-01' })
  period_start!: string;

  @ApiProperty({ type: String, example: '2026-01-31' })
  period_end!: string;
}

export class CreateJournalLineDto {
  @ApiProperty({ type: String, example: '00000000-0000-0000-0000-000000000000' })
  account_id!: string;

  @ApiPropertyOptional({ type: String, example: '100.0000', default: '0.0000' })
  debit?: string;

  @ApiPropertyOptional({ type: String, example: '0.0000', default: '0.0000' })
  credit?: string;

  @ApiPropertyOptional({ type: String, example: 'USD', default: 'USD' })
  currency?: string;

  @ApiPropertyOptional({ type: String, example: '1.0000', default: '1.0000' })
  fx_rate?: string;
}

export class CreateJournalEntryRequestDto {
  @ApiProperty({ type: String, example: '2026-01-15' })
  entry_date!: string;

  @ApiProperty({ type: String, example: 'Purchased cloud server infrastructure' })
  memo!: string;

  @ApiProperty({ type: () => [CreateJournalLineDto] })
  lines!: CreateJournalLineDto[];
}

export class ReverseJournalEntryRequestDto {
  @ApiPropertyOptional({ type: String, example: 'Incorrect amount recorded on original invoice' })
  reason?: string;
}

export class RecordExpenseRequestDto {
  @ApiProperty({ type: String, example: '2026-01-15' })
  entry_date!: string;

  @ApiProperty({ type: String, example: 'AWS Cloud Hosting' })
  memo!: string;

  @ApiProperty({ type: String, example: '00000000-0000-0000-0000-000000000000' })
  expense_account_id!: string;

  @ApiProperty({ type: String, example: '00000000-0000-0000-0000-000000000000' })
  payment_account_id!: string;

  @ApiProperty({ type: String, example: '250.0000' })
  amount!: string;

  @ApiPropertyOptional({ type: String, example: 'USD', default: 'USD' })
  currency?: string;

  @ApiPropertyOptional({ type: String, example: '1.0000', default: '1.0000' })
  fx_rate?: string;
}

@ApiTags('ledger')
@ApiBearerAuth()
@UseGuards(AuthGuard, AuthorizationGuard)
@Controller()
export class LedgerController {
  constructor(
    @Inject(ChartOfAccountsService)
    private readonly chartOfAccountsService: ChartOfAccountsService,
    @Inject(AccountingPeriodsService)
    private readonly accountingPeriodsService: AccountingPeriodsService,
    @Inject(JournalEntriesService)
    private readonly journalEntriesService: JournalEntriesService,
    @Inject(FinancialReportsService)
    private readonly financialReportsService: FinancialReportsService,
  ) {}

  // ============================================================================
  // CHART OF ACCOUNTS
  // ============================================================================

  @Post('accounts/seed-template')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Seed standard 42-account tech startup Chart of Accounts' })
  @ApiResponse({ status: 201, description: 'Template seeded successfully' })
  async seedTemplate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
  ): Promise<{ seeded_count: number; message: string }> {
    return await this.chartOfAccountsService.seedTechStartupTemplate(tenantId, user.user_id);
  }

  @Get('accounts')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'List all accounts in the Chart of Accounts' })
  async listAccounts(@CurrentTenant() tenantId: string): Promise<AccountDto[]> {
    return await this.chartOfAccountsService.listAccounts(tenantId);
  }

  @Post('accounts')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Create a custom account in the Chart of Accounts' })
  @ApiBody({ type: CreateAccountRequestDto })
  async createAccount(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateAccountRequestDto,
  ): Promise<AccountDto> {
    return await this.chartOfAccountsService.createAccount(tenantId, body, user.user_id);
  }

  @Patch('accounts/:id')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Update an existing account' })
  @ApiParam({ name: 'id', description: 'Account UUID' })
  @ApiBody({ type: UpdateAccountRequestDto })
  async updateAccount(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateAccountRequestDto,
  ): Promise<AccountDto> {
    return await this.chartOfAccountsService.updateAccount(tenantId, id, body, user.user_id);
  }

  @Post('accounts/:id/archive')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Archive an account (safe alternative to deletion)' })
  @ApiParam({ name: 'id', description: 'Account UUID' })
  async archiveAccount(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<AccountDto> {
    return await this.chartOfAccountsService.archiveAccount(tenantId, id, user.user_id);
  }

  // ============================================================================
  // ACCOUNTING PERIODS
  // ============================================================================

  @Get('accounting-periods')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'List all accounting periods' })
  async listPeriods(@CurrentTenant() tenantId: string): Promise<AccountingPeriodDto[]> {
    return await this.accountingPeriodsService.listPeriods(tenantId);
  }

  @Post('accounting-periods')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Create a new accounting period' })
  @ApiBody({ type: CreateAccountingPeriodRequestDto })
  async createPeriod(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateAccountingPeriodRequestDto,
  ): Promise<AccountingPeriodDto> {
    return await this.accountingPeriodsService.createPeriod(tenantId, body, user.user_id);
  }

  @Post('accounting-periods/:id/close')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Close an accounting period (locks postings before or on this period)' })
  @ApiParam({ name: 'id', description: 'Accounting period UUID' })
  async closePeriod(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<AccountingPeriodDto> {
    return await this.accountingPeriodsService.closePeriod(tenantId, id, user.user_id);
  }

  // ============================================================================
  // JOURNAL ENTRIES & EXPENSES
  // ============================================================================

  @Post('journal-entries')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Post a balanced double-entry journal entry' })
  @ApiBody({ type: CreateJournalEntryRequestDto })
  async postEntry(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateJournalEntryRequestDto,
  ): Promise<JournalEntryDto> {
    return await this.journalEntriesService.postEntry(tenantId, body, user.user_id, 'MANUAL');
  }

  @Get('journal-entries/:id')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'Get a journal entry with all line items' })
  @ApiParam({ name: 'id', description: 'Journal entry UUID' })
  async getEntryById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ): Promise<JournalEntryDto> {
    return await this.journalEntriesService.getEntryById(tenantId, id);
  }

  @Post('journal-entries/:id/reverse')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Reverse a posted journal entry with balanced compensating lines' })
  @ApiParam({ name: 'id', description: 'Journal entry UUID to reverse' })
  @ApiBody({ type: ReverseJournalEntryRequestDto })
  async reverseEntry(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: ReverseJournalEntryRequestDto,
  ): Promise<JournalEntryDto> {
    return await this.journalEntriesService.reverseEntry(tenantId, id, user.user_id, body?.reason);
  }

  @Post('ledger/expenses')
  @Roles('FDR', 'FIN')
  @ApiOperation({ summary: 'Simple expense recording for non-accountants' })
  @ApiBody({ type: RecordExpenseRequestDto })
  async recordExpense(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUserContext,
    @Body() body: RecordExpenseRequestDto,
  ): Promise<JournalEntryDto> {
    return await this.journalEntriesService.recordExpense(tenantId, body, user.user_id);
  }

  // ============================================================================
  // FINANCIAL REPORTS
  // ============================================================================

  @Get('ledger/general-ledger')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'General Ledger with running functional balances' })
  @ApiQuery({ name: 'account_id', required: false })
  @ApiQuery({ name: 'start_date', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'end_date', required: false, example: '2026-12-31' })
  async getGeneralLedger(
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ): Promise<GeneralLedgerLineDto[]> {
    return await this.financialReportsService.getGeneralLedger(tenantId, {
      account_id: accountId,
      start_date: startDate,
      end_date: endDate,
    });
  }

  @Get('ledger/trial-balance')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'Trial Balance verifying total functional debits equal credits' })
  @ApiQuery({ name: 'as_of_date', required: false, example: '2026-12-31' })
  async getTrialBalance(
    @CurrentTenant() tenantId: string,
    @Query('as_of_date') asOfDate?: string,
  ): Promise<TrialBalanceReportDto> {
    const targetDate = asOfDate || new Date().toISOString().slice(0, 10);
    return await this.financialReportsService.getTrialBalance(tenantId, targetDate);
  }

  @Get('ledger/reports/pnl')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'Profit & Loss Statement (Revenues, Expenses, Net Income)' })
  @ApiQuery({ name: 'start_date', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'end_date', required: true, example: '2026-12-31' })
  async getProfitAndLoss(
    @CurrentTenant() tenantId: string,
    @Query('start_date') startDate: string,
    @Query('end_date') endDate: string,
  ): Promise<ProfitAndLossReportDto> {
    const today = new Date().toISOString().slice(0, 10);
    const start = startDate || today.slice(0, 4) + '-01-01';
    const end = endDate || today;
    return await this.financialReportsService.getProfitAndLoss(tenantId, start, end);
  }

  @Get('ledger/reports/balance-sheet')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'Balance Sheet (Assets = Liabilities + Equity)' })
  @ApiQuery({ name: 'as_of_date', required: false, example: '2026-12-31' })
  async getBalanceSheet(
    @CurrentTenant() tenantId: string,
    @Query('as_of_date') asOfDate?: string,
  ): Promise<BalanceSheetReportDto> {
    const targetDate = asOfDate || new Date().toISOString().slice(0, 10);
    return await this.financialReportsService.getBalanceSheet(tenantId, targetDate);
  }

  @Get('ledger/burn-and-runway')
  @Roles('FDR', 'FIN', 'OPS')
  @ApiOperation({ summary: 'Cash balance, 3-month trailing net burn, and runway months' })
  @ApiQuery({ name: 'as_of_date', required: false, example: '2026-12-31' })
  async getBurnAndRunway(
    @CurrentTenant() tenantId: string,
    @Query('as_of_date') asOfDate?: string,
  ): Promise<BurnAndRunwayReportDto> {
    const targetDate = asOfDate || new Date().toISOString().slice(0, 10);
    return await this.financialReportsService.getBurnAndRunway(tenantId, targetDate);
  }
}
