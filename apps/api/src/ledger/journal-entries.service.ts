import {
  CreateJournalEntryInput,
  Decimal,
  isValidDecimalString,
  JournalEntryDto,
  JournalLineDto,
  JournalSource,
  RecordExpenseInput,
} from '@grant-ledger/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Transaction } from 'kysely';
import { AuditLogService } from '../audit/audit.service';
import { Database } from '../database/database.types';
import { TenantContextService } from '../database/tenant-context.service';
import { AccountingPeriodsService } from './accounting-periods.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class JournalEntriesService {
  constructor(
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
    @Inject(AccountingPeriodsService)
    private readonly accountingPeriodsService: AccountingPeriodsService,
    @Inject(ChartOfAccountsService)
    private readonly chartOfAccountsService: ChartOfAccountsService,
  ) {}

  async getEntryById(
    tenantId: string,
    entryId: string,
    existingTx?: Transaction<Database>,
  ): Promise<JournalEntryDto> {
    const fetchFn = async (tx: Transaction<Database>) => {
      const entry = await tx
        .selectFrom('journal_entries')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', entryId)
        .executeTakeFirst();

      if (!entry) {
        throw new NotFoundException(`Journal entry '${entryId}' not found`);
      }

      const lines = await tx
        .selectFrom('journal_lines')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select([
          'journal_lines.id',
          'journal_lines.journal_entry_id',
          'journal_lines.line_order',
          'journal_lines.account_id',
          'accounts.code as account_code',
          'accounts.name as account_name',
          'journal_lines.debit',
          'journal_lines.credit',
          'journal_lines.currency',
          'journal_lines.fx_rate',
          'journal_lines.amount_functional',
          'journal_lines.created_at',
        ])
        .where('journal_lines.tenant_id', '=', tenantId)
        .where('journal_lines.journal_entry_id', '=', entryId)
        .orderBy('journal_lines.line_order', 'asc')
        .execute();

      return {
        id: entry.id,
        tenant_id: entry.tenant_id,
        entry_date: entry.entry_date,
        period_id: entry.period_id,
        memo: entry.memo,
        status: entry.status,
        source: entry.source,
        reverses_entry_id: entry.reverses_entry_id,
        created_by_user_id: entry.created_by_user_id,
        posted_at: entry.posted_at,
        created_at: entry.created_at,
        lines: lines as JournalLineDto[],
      };
    };

    if (existingTx) {
      return await fetchFn(existingTx);
    }
    return await this.tenantContext.withTenantContext(tenantId, fetchFn);
  }

  async postEntry(
    tenantId: string,
    input: CreateJournalEntryInput,
    actorId?: string,
    source: JournalSource = 'MANUAL',
  ): Promise<JournalEntryDto> {
    // 1. Basic validation
    if (!ISO_DATE_REGEX.test(input.entry_date)) {
      throw new BadRequestException('entry_date must be in YYYY-MM-DD format');
    }

    if (!input.memo || input.memo.trim().length === 0) {
      throw new BadRequestException('memo is required');
    }

    if (!input.lines || input.lines.length < 2) {
      throw new BadRequestException('A journal entry must have at least 2 lines');
    }

    // 2. Validate open accounting period
    const openPeriod = await this.accountingPeriodsService.findOpenPeriodForDate(
      tenantId,
      input.entry_date,
    );

    if (!openPeriod) {
      throw new BadRequestException(
        `Cannot post journal entry: No open accounting period covers entry_date '${input.entry_date}'`,
      );
    }

    // 3. Validate accounts and calculate functional lines
    const processedLines: Array<{
      id: string;
      line_order: number;
      account_id: string;
      debit: Decimal;
      credit: Decimal;
      currency: string;
      fx_rate: Decimal;
      amount_functional: Decimal;
    }> = [];

    let totalFunctionalDebit = Decimal.ZERO;
    let totalFunctionalCredit = Decimal.ZERO;

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i]!;

      // Verify account exists and is active
      const account = await this.chartOfAccountsService.getAccountById(tenantId, line.account_id);
      if (account.is_archived) {
        throw new BadRequestException(
          `Cannot post to archived account '${account.code} - ${account.name}'`,
        );
      }

      const debitStr = line.debit ?? '0';
      const creditStr = line.credit ?? '0';

      if (!isValidDecimalString(debitStr) || !isValidDecimalString(creditStr)) {
        throw new BadRequestException(
          `Invalid decimal string for debit (${debitStr}) or credit (${creditStr}) on line ${i + 1}`,
        );
      }

      const debit = Decimal.from(debitStr);
      const credit = Decimal.from(creditStr);

      if (debit.isNegative() || credit.isNegative()) {
        throw new BadRequestException(`Debit and credit cannot be negative on line ${i + 1}`);
      }

      const hasDebit = debit.isPositive();
      const hasCredit = credit.isPositive();

      if ((hasDebit && hasCredit) || (!hasDebit && !hasCredit)) {
        throw new BadRequestException(
          `Line ${i + 1} must specify either a positive debit or a positive credit, never both or neither`,
        );
      }

      const fxRateStr = line.fx_rate ?? '1.0000';
      if (!isValidDecimalString(fxRateStr)) {
        throw new BadRequestException(`Invalid FX rate '${fxRateStr}' on line ${i + 1}`);
      }

      const fxRate = Decimal.from(fxRateStr);
      if (fxRate.isNegative() || fxRate.isZero()) {
        throw new BadRequestException(`FX rate must be positive on line ${i + 1}`);
      }

      const lineAmount = hasDebit ? debit : credit;
      const amountFunctional = Decimal.multiply(lineAmount, fxRate);

      if (hasDebit) {
        totalFunctionalDebit = Decimal.add(totalFunctionalDebit, amountFunctional);
      } else {
        totalFunctionalCredit = Decimal.add(totalFunctionalCredit, amountFunctional);
      }

      processedLines.push({
        id: randomUUID(),
        line_order: i + 1,
        account_id: line.account_id,
        debit,
        credit,
        currency: line.currency ?? 'USD',
        fx_rate: fxRate,
        amount_functional: amountFunctional,
      });
    }

    // 4. Assert debits equal credits in functional currency
    if (!Decimal.subtract(totalFunctionalDebit, totalFunctionalCredit).isZero()) {
      throw new BadRequestException(
        `Journal entry is unbalanced: total functional debits (${totalFunctionalDebit.toString()}) must equal total functional credits (${totalFunctionalCredit.toString()})`,
      );
    }

    // 5. Atomic persist in transaction
    const entryId = randomUUID();
    const now = new Date().toISOString();

    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      await tx
        .insertInto('journal_entries')
        .values({
          id: entryId,
          tenant_id: tenantId,
          entry_date: input.entry_date,
          period_id: openPeriod.id,
          memo: input.memo.trim(),
          status: 'POSTED',
          source: source,
          reverses_entry_id: null,
          created_by_user_id: actorId ?? null,
          posted_at: now,
        })
        .execute();

      for (const line of processedLines) {
        await tx
          .insertInto('journal_lines')
          .values({
            id: line.id,
            tenant_id: tenantId,
            journal_entry_id: entryId,
            line_order: line.line_order,
            account_id: line.account_id,
            debit: line.debit.toString(),
            credit: line.credit.toString(),
            currency: line.currency,
            fx_rate: line.fx_rate.toString(),
            amount_functional: line.amount_functional.toString(),
          })
          .execute();
      }

      // Mandatory audit entry inside same transaction
      await this.auditLogService.appendAuditLog(tx, {
        tenant_id: tenantId,
        actor_id: actorId ?? null,
        actor_type: actorId ? 'USER' : 'SYSTEM',
        action: 'JOURNAL_ENTRY_POSTED',
        entity_type: 'JOURNAL_ENTRY',
        entity_id: entryId,
        after_state: {
          id: entryId,
          entry_date: input.entry_date,
          period_id: openPeriod.id,
          memo: input.memo.trim(),
          source,
          total_functional: totalFunctionalDebit.toString(),
          line_count: processedLines.length,
        },
      });

      return await this.getEntryById(tenantId, entryId, tx);
    });
  }

  async reverseEntry(
    tenantId: string,
    entryId: string,
    actorId?: string,
    reason?: string,
  ): Promise<JournalEntryDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      // 1. Fetch original entry
      const originalEntry = await tx
        .selectFrom('journal_entries')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', entryId)
        .executeTakeFirst();

      if (!originalEntry) {
        throw new NotFoundException(`Journal entry '${entryId}' not found`);
      }

      if (originalEntry.status === 'REVERSED') {
        throw new ConflictException(`Journal entry '${entryId}' has already been reversed`);
      }

      // Check if any existing reversal references this entry
      const existingReversal = await tx
        .selectFrom('journal_entries')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('reverses_entry_id', '=', entryId)
        .executeTakeFirst();

      if (existingReversal) {
        throw new ConflictException(
          `Journal entry '${entryId}' was already reversed by '${existingReversal.id}'`,
        );
      }

      // 2. Fetch original lines
      const originalLines = await tx
        .selectFrom('journal_lines')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('journal_entry_id', '=', entryId)
        .orderBy('line_order', 'asc')
        .execute();

      if (originalLines.length === 0) {
        throw new BadRequestException(`Original journal entry '${entryId}' has no lines`);
      }

      // 3. Reversal date: use today or original date if still open
      const today = new Date().toISOString().slice(0, 10);
      let reversalPeriod = await this.accountingPeriodsService.findOpenPeriodForDate(
        tenantId,
        today,
      );
      let reversalDate = today;

      if (!reversalPeriod) {
        // Fallback to original entry date's period
        reversalPeriod = await this.accountingPeriodsService.findOpenPeriodForDate(
          tenantId,
          originalEntry.entry_date,
        );
        reversalDate = originalEntry.entry_date;
      }

      if (!reversalPeriod) {
        throw new BadRequestException(
          'Cannot reverse journal entry: No open accounting period exists for reversal',
        );
      }

      // 4. Create reversal entry
      const reversalId = randomUUID();
      const now = new Date().toISOString();
      const reversalMemo = `Reversal of entry ${entryId}: ${reason || 'Correction'}`;

      await tx
        .insertInto('journal_entries')
        .values({
          id: reversalId,
          tenant_id: tenantId,
          entry_date: reversalDate,
          period_id: reversalPeriod.id,
          memo: reversalMemo,
          status: 'POSTED',
          source: 'REVERSAL',
          reverses_entry_id: entryId,
          created_by_user_id: actorId ?? null,
          posted_at: now,
        })
        .execute();

      // 5. Invert lines (debit becomes credit, credit becomes debit)
      for (let i = 0; i < originalLines.length; i++) {
        const line = originalLines[i]!;
        await tx
          .insertInto('journal_lines')
          .values({
            id: randomUUID(),
            tenant_id: tenantId,
            journal_entry_id: reversalId,
            line_order: i + 1,
            account_id: line.account_id,
            debit: line.credit, // Invert
            credit: line.debit, // Invert
            currency: line.currency,
            fx_rate: line.fx_rate,
            amount_functional: line.amount_functional,
          })
          .execute();
      }

      // 6. Update original entry status to REVERSED
      await tx
        .updateTable('journal_entries')
        .set({ status: 'REVERSED' })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', entryId)
        .execute();

      // 7. Write audit log
      await this.auditLogService.appendAuditLog(tx, {
        tenant_id: tenantId,
        actor_id: actorId ?? null,
        actor_type: actorId ? 'USER' : 'SYSTEM',
        action: 'JOURNAL_ENTRY_REVERSED',
        entity_type: 'JOURNAL_ENTRY',
        entity_id: reversalId,
        before_state: {
          original_entry_id: entryId,
          original_status: originalEntry.status,
        },
        after_state: {
          reversal_entry_id: reversalId,
          original_entry_id: entryId,
          reversal_date: reversalDate,
          reason: reason || 'Correction',
        },
      });

      return await this.getEntryById(tenantId, reversalId, tx);
    });
  }

  async recordExpense(
    tenantId: string,
    input: RecordExpenseInput,
    actorId?: string,
  ): Promise<JournalEntryDto> {
    if (!isValidDecimalString(input.amount)) {
      throw new BadRequestException(`Invalid expense amount '${input.amount}'`);
    }

    const amount = Decimal.from(input.amount);
    if (amount.isNegative() || amount.isZero()) {
      throw new BadRequestException('Expense amount must be positive');
    }

    // Verify expense account is EXPENSE (or ASSET for hardware/equipment)
    const expenseAcc = await this.chartOfAccountsService.getAccountById(
      tenantId,
      input.expense_account_id,
    );
    if (expenseAcc.account_type !== 'EXPENSE' && expenseAcc.account_type !== 'ASSET') {
      throw new BadRequestException(
        `Account '${expenseAcc.code} - ${expenseAcc.name}' is of type ${expenseAcc.account_type}; expected EXPENSE or ASSET`,
      );
    }

    // Verify payment account is ASSET (cash/bank) or LIABILITY (credit card/payable)
    const paymentAcc = await this.chartOfAccountsService.getAccountById(
      tenantId,
      input.payment_account_id,
    );
    if (paymentAcc.account_type !== 'ASSET' && paymentAcc.account_type !== 'LIABILITY') {
      throw new BadRequestException(
        `Account '${paymentAcc.code} - ${paymentAcc.name}' is of type ${paymentAcc.account_type}; expected ASSET (cash/bank) or LIABILITY (payable/card)`,
      );
    }

    const entryInput: CreateJournalEntryInput = {
      entry_date: input.entry_date,
      memo: input.memo,
      lines: [
        {
          account_id: input.expense_account_id,
          debit: amount.toString(),
          currency: input.currency ?? 'USD',
          fx_rate: input.fx_rate ?? '1.0000',
        },
        {
          account_id: input.payment_account_id,
          credit: amount.toString(),
          currency: input.currency ?? 'USD',
          fx_rate: input.fx_rate ?? '1.0000',
        },
      ],
    };

    return await this.postEntry(tenantId, entryInput, actorId, 'SIMPLE_EXPENSE');
  }
}
