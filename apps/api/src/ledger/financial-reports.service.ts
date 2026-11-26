import {
  BalanceSheetReportDto,
  BurnAndRunwayReportDto,
  Decimal,
  GeneralLedgerLineDto,
  ProfitAndLossReportDto,
  TrialBalanceAccountDto,
  TrialBalanceReportDto,
} from '@grant-ledger/shared';
import { Inject, Injectable } from '@nestjs/common';
import { TenantContextService } from '../database/tenant-context.service';

@Injectable()
export class FinancialReportsService {
  constructor(@Inject(TenantContextService) private readonly tenantContext: TenantContextService) {}

  async getGeneralLedger(
    tenantId: string,
    query?: { account_id?: string; start_date?: string; end_date?: string },
  ): Promise<GeneralLedgerLineDto[]> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      let qb = tx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select([
          'journal_lines.id as line_id',
          'journal_entries.id as entry_id',
          'journal_entries.entry_date',
          'journal_entries.memo',
          'accounts.id as account_id',
          'accounts.code as account_code',
          'accounts.name as account_name',
          'accounts.account_type',
          'accounts.is_contra',
          'journal_lines.debit',
          'journal_lines.credit',
          'journal_lines.amount_functional',
          'journal_lines.line_order',
          'journal_entries.created_at',
        ])
        .where('journal_lines.tenant_id', '=', tenantId)
        .where('journal_entries.status', '=', 'POSTED');

      if (query?.account_id) {
        qb = qb.where('journal_lines.account_id', '=', query.account_id);
      }
      if (query?.start_date) {
        qb = qb.where('journal_entries.entry_date', '>=', query.start_date);
      }
      if (query?.end_date) {
        qb = qb.where('journal_entries.entry_date', '<=', query.end_date);
      }

      const rows = await qb
        .orderBy('accounts.code', 'asc')
        .orderBy('journal_entries.entry_date', 'asc')
        .orderBy('journal_entries.created_at', 'asc')
        .orderBy('journal_lines.line_order', 'asc')
        .execute();

      // Compute running balance per account
      const results: GeneralLedgerLineDto[] = [];
      let currentAccountId: string | null = null;
      let runningBalance = Decimal.ZERO;

      for (const row of rows) {
        if (row.account_id !== currentAccountId) {
          currentAccountId = row.account_id;
          runningBalance = Decimal.ZERO;
        }

        const debit = Decimal.from(row.debit);
        const credit = Decimal.from(row.credit);
        const isContra = Boolean(row.is_contra);

        if (row.account_type === 'ASSET' || row.account_type === 'EXPENSE') {
          // Normal debit balance
          const delta = isContra
            ? Decimal.subtract(credit, debit)
            : Decimal.subtract(debit, credit);
          runningBalance = Decimal.add(runningBalance, delta);
        } else {
          // Normal credit balance (LIABILITY, EQUITY, REVENUE)
          const delta = isContra
            ? Decimal.subtract(debit, credit)
            : Decimal.subtract(credit, debit);
          runningBalance = Decimal.add(runningBalance, delta);
        }

        results.push({
          line_id: row.line_id,
          entry_id: row.entry_id,
          entry_date: row.entry_date,
          memo: row.memo,
          account_id: row.account_id,
          account_code: row.account_code,
          account_name: row.account_name,
          debit: row.debit,
          credit: row.credit,
          amount_functional: row.amount_functional,
          running_balance: runningBalance.toString(),
        });
      }

      return results;
    });
  }

  async getTrialBalance(tenantId: string, asOfDate: string): Promise<TrialBalanceReportDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      // 1. Fetch all accounts
      const accounts = await tx
        .selectFrom('accounts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('is_archived', '=', false)
        .orderBy('code', 'asc')
        .execute();

      // 2. Fetch posted lines up to asOfDate
      const lines = await tx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
        .select([
          'journal_lines.account_id',
          'journal_lines.debit',
          'journal_lines.credit',
          'journal_lines.amount_functional',
          'journal_lines.fx_rate',
        ])
        .where('journal_lines.tenant_id', '=', tenantId)
        .where('journal_entries.status', '=', 'POSTED')
        .where('journal_entries.entry_date', '<=', asOfDate)
        .execute();

      // Group totals by account
      const debitTotals = new Map<string, Decimal>();
      const creditTotals = new Map<string, Decimal>();

      for (const line of lines) {
        const debit = Decimal.from(line.debit);
        const credit = Decimal.from(line.credit);
        const fxRate = Decimal.from(line.fx_rate);

        const functionalDebit = debit.isPositive() ? Decimal.multiply(debit, fxRate) : Decimal.ZERO;
        const functionalCredit = credit.isPositive()
          ? Decimal.multiply(credit, fxRate)
          : Decimal.ZERO;

        const currentDebit = debitTotals.get(line.account_id) ?? Decimal.ZERO;
        const currentCredit = creditTotals.get(line.account_id) ?? Decimal.ZERO;

        debitTotals.set(line.account_id, Decimal.add(currentDebit, functionalDebit));
        creditTotals.set(line.account_id, Decimal.add(currentCredit, functionalCredit));
      }

      let grandTotalDebits = Decimal.ZERO;
      let grandTotalCredits = Decimal.ZERO;

      const accountDtos: TrialBalanceAccountDto[] = [];

      for (const acc of accounts) {
        const totalDebit = debitTotals.get(acc.id) ?? Decimal.ZERO;
        const totalCredit = creditTotals.get(acc.id) ?? Decimal.ZERO;

        grandTotalDebits = Decimal.add(grandTotalDebits, totalDebit);
        grandTotalCredits = Decimal.add(grandTotalCredits, totalCredit);

        let netBalance: Decimal;
        if (acc.account_type === 'ASSET' || acc.account_type === 'EXPENSE') {
          netBalance = acc.is_contra
            ? Decimal.subtract(totalCredit, totalDebit)
            : Decimal.subtract(totalDebit, totalCredit);
        } else {
          netBalance = acc.is_contra
            ? Decimal.subtract(totalDebit, totalCredit)
            : Decimal.subtract(totalCredit, totalDebit);
        }

        accountDtos.push({
          account_id: acc.id,
          code: acc.code,
          name: acc.name,
          account_type: acc.account_type,
          is_contra: acc.is_contra,
          total_debit: totalDebit.toString(),
          total_credit: totalCredit.toString(),
          net_balance: netBalance.toString(),
        });
      }

      const isBalanced = Decimal.subtract(grandTotalDebits, grandTotalCredits).isZero();

      return {
        as_of_date: asOfDate,
        accounts: accountDtos,
        total_debits: grandTotalDebits.toString(),
        total_credits: grandTotalCredits.toString(),
        is_balanced: isBalanced,
      };
    });
  }

  async getProfitAndLoss(
    tenantId: string,
    startDate: string,
    endDate: string,
  ): Promise<ProfitAndLossReportDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const rows = await tx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select([
          'accounts.id as account_id',
          'accounts.code as account_code',
          'accounts.name as account_name',
          'accounts.account_type',
          'accounts.is_contra',
          'journal_lines.debit',
          'journal_lines.credit',
          'journal_lines.fx_rate',
        ])
        .where('journal_lines.tenant_id', '=', tenantId)
        .where('journal_entries.status', '=', 'POSTED')
        .where('journal_entries.entry_date', '>=', startDate)
        .where('journal_entries.entry_date', '<=', endDate)
        .where('accounts.account_type', 'in', ['REVENUE', 'EXPENSE'])
        .execute();

      const revenueMap = new Map<string, { code: string; name: string; amount: Decimal }>();
      const expenseMap = new Map<string, { code: string; name: string; amount: Decimal }>();

      for (const row of rows) {
        const debit = Decimal.from(row.debit);
        const credit = Decimal.from(row.credit);
        const fxRate = Decimal.from(row.fx_rate);

        const funcDebit = debit.isPositive() ? Decimal.multiply(debit, fxRate) : Decimal.ZERO;
        const funcCredit = credit.isPositive() ? Decimal.multiply(credit, fxRate) : Decimal.ZERO;

        if (row.account_type === 'REVENUE') {
          // Normal credit balance for revenue
          const net = row.is_contra
            ? Decimal.subtract(funcDebit, funcCredit)
            : Decimal.subtract(funcCredit, funcDebit);

          const existing = revenueMap.get(row.account_id) ?? {
            code: row.account_code,
            name: row.account_name,
            amount: Decimal.ZERO,
          };
          existing.amount = Decimal.add(existing.amount, net);
          revenueMap.set(row.account_id, existing);
        } else {
          // Normal debit balance for expense
          const net = row.is_contra
            ? Decimal.subtract(funcCredit, funcDebit)
            : Decimal.subtract(funcDebit, funcCredit);

          const existing = expenseMap.get(row.account_id) ?? {
            code: row.account_code,
            name: row.account_name,
            amount: Decimal.ZERO,
          };
          existing.amount = Decimal.add(existing.amount, net);
          expenseMap.set(row.account_id, existing);
        }
      }

      let totalRevenue = Decimal.ZERO;
      const revenueAccounts: Array<{ id: string; code: string; name: string; amount: string }> = [];
      for (const [id, item] of revenueMap.entries()) {
        totalRevenue = Decimal.add(totalRevenue, item.amount);
        revenueAccounts.push({
          id,
          code: item.code,
          name: item.name,
          amount: item.amount.toString(),
        });
      }
      revenueAccounts.sort((a, b) => a.code.localeCompare(b.code));

      let totalExpense = Decimal.ZERO;
      const expenseAccounts: Array<{ id: string; code: string; name: string; amount: string }> = [];
      for (const [id, item] of expenseMap.entries()) {
        totalExpense = Decimal.add(totalExpense, item.amount);
        expenseAccounts.push({
          id,
          code: item.code,
          name: item.name,
          amount: item.amount.toString(),
        });
      }
      expenseAccounts.sort((a, b) => a.code.localeCompare(b.code));

      const netIncome = Decimal.subtract(totalRevenue, totalExpense);

      return {
        period_start: startDate,
        period_end: endDate,
        revenues: {
          accounts: revenueAccounts,
          total: totalRevenue.toString(),
        },
        expenses: {
          accounts: expenseAccounts,
          total: totalExpense.toString(),
        },
        net_income: netIncome.toString(),
      };
    });
  }

  async getBalanceSheet(tenantId: string, asOfDate: string): Promise<BalanceSheetReportDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      // 1. Fetch all accounts
      const accounts = await tx
        .selectFrom('accounts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('is_archived', '=', false)
        .execute();

      // 2. Fetch all posted lines up to asOfDate
      const lines = await tx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
        .select([
          'journal_lines.account_id',
          'journal_lines.debit',
          'journal_lines.credit',
          'journal_lines.fx_rate',
        ])
        .where('journal_lines.tenant_id', '=', tenantId)
        .where('journal_entries.status', '=', 'POSTED')
        .where('journal_entries.entry_date', '<=', asOfDate)
        .execute();

      // Aggregate net balance per account
      const debitTotals = new Map<string, Decimal>();
      const creditTotals = new Map<string, Decimal>();

      for (const line of lines) {
        const debit = Decimal.from(line.debit);
        const credit = Decimal.from(line.credit);
        const fxRate = Decimal.from(line.fx_rate);

        const funcDebit = debit.isPositive() ? Decimal.multiply(debit, fxRate) : Decimal.ZERO;
        const funcCredit = credit.isPositive() ? Decimal.multiply(credit, fxRate) : Decimal.ZERO;

        const curD = debitTotals.get(line.account_id) ?? Decimal.ZERO;
        const curC = creditTotals.get(line.account_id) ?? Decimal.ZERO;

        debitTotals.set(line.account_id, Decimal.add(curD, funcDebit));
        creditTotals.set(line.account_id, Decimal.add(curC, funcCredit));
      }

      let totalAssets = Decimal.ZERO;
      let totalLiabilities = Decimal.ZERO;
      let totalEquity = Decimal.ZERO;
      let cumulativeNetIncome = Decimal.ZERO;

      const assetAccounts: Array<{
        id: string;
        code: string;
        name: string;
        amount: string;
        is_contra: boolean;
      }> = [];
      const liabilityAccounts: Array<{ id: string; code: string; name: string; amount: string }> =
        [];
      const equityAccounts: Array<{ id: string; code: string; name: string; amount: string }> = [];

      for (const acc of accounts) {
        const totalDebit = debitTotals.get(acc.id) ?? Decimal.ZERO;
        const totalCredit = creditTotals.get(acc.id) ?? Decimal.ZERO;

        if (acc.account_type === 'ASSET') {
          if (acc.is_contra) {
            // Contra asset (e.g. accumulated depreciation): net credit balance reduces assets
            const net = Decimal.subtract(totalCredit, totalDebit);
            totalAssets = Decimal.subtract(totalAssets, net);
            assetAccounts.push({
              id: acc.id,
              code: acc.code,
              name: acc.name,
              amount: net.toString(),
              is_contra: true,
            });
          } else {
            // Normal asset: debit - credit
            const net = Decimal.subtract(totalDebit, totalCredit);
            totalAssets = Decimal.add(totalAssets, net);
            assetAccounts.push({
              id: acc.id,
              code: acc.code,
              name: acc.name,
              amount: net.toString(),
              is_contra: false,
            });
          }
        } else if (acc.account_type === 'LIABILITY') {
          const net = acc.is_contra
            ? Decimal.subtract(totalDebit, totalCredit)
            : Decimal.subtract(totalCredit, totalDebit);
          totalLiabilities = Decimal.add(totalLiabilities, net);
          liabilityAccounts.push({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            amount: net.toString(),
          });
        } else if (acc.account_type === 'EQUITY') {
          const net = acc.is_contra
            ? Decimal.subtract(totalDebit, totalCredit)
            : Decimal.subtract(totalCredit, totalDebit);
          totalEquity = Decimal.add(totalEquity, net);
          equityAccounts.push({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            amount: net.toString(),
          });
        } else if (acc.account_type === 'REVENUE') {
          const net = acc.is_contra
            ? Decimal.subtract(totalDebit, totalCredit)
            : Decimal.subtract(totalCredit, totalDebit);
          cumulativeNetIncome = Decimal.add(cumulativeNetIncome, net);
        } else if (acc.account_type === 'EXPENSE') {
          const net = acc.is_contra
            ? Decimal.subtract(totalCredit, totalDebit)
            : Decimal.subtract(totalDebit, totalCredit);
          cumulativeNetIncome = Decimal.subtract(cumulativeNetIncome, net);
        }
      }

      assetAccounts.sort((a, b) => a.code.localeCompare(b.code));
      liabilityAccounts.sort((a, b) => a.code.localeCompare(b.code));
      equityAccounts.sort((a, b) => a.code.localeCompare(b.code));

      // Total equity includes current period / cumulative retained net income
      const grandTotalEquity = Decimal.add(totalEquity, cumulativeNetIncome);
      const totalLiabilitiesAndEquity = Decimal.add(totalLiabilities, grandTotalEquity);
      const isBalanced = Decimal.subtract(totalAssets, totalLiabilitiesAndEquity).isZero();

      return {
        as_of_date: asOfDate,
        assets: {
          accounts: assetAccounts,
          total: totalAssets.toString(),
        },
        liabilities: {
          accounts: liabilityAccounts,
          total: totalLiabilities.toString(),
        },
        equity: {
          accounts: equityAccounts,
          net_income_current_period: cumulativeNetIncome.toString(),
          total: grandTotalEquity.toString(),
        },
        total_liabilities_and_equity: totalLiabilitiesAndEquity.toString(),
        is_balanced: isBalanced,
      };
    });
  }

  async getBurnAndRunway(tenantId: string, asOfDate: string): Promise<BurnAndRunwayReportDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      // 1. Cash on hand: accounts with subtype 'CASH_AND_BANK'
      const cashAccounts = await tx
        .selectFrom('accounts')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('account_subtype', '=', 'CASH_AND_BANK')
        .where('is_archived', '=', false)
        .execute();

      const cashAccountIds = cashAccounts.map((a) => a.id);

      let cashOnHand = Decimal.ZERO;

      if (cashAccountIds.length > 0) {
        const cashLines = await tx
          .selectFrom('journal_lines')
          .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
          .select(['journal_lines.debit', 'journal_lines.credit', 'journal_lines.fx_rate'])
          .where('journal_lines.tenant_id', '=', tenantId)
          .where('journal_lines.account_id', 'in', cashAccountIds)
          .where('journal_entries.status', '=', 'POSTED')
          .where('journal_entries.entry_date', '<=', asOfDate)
          .execute();

        for (const line of cashLines) {
          const debit = Decimal.from(line.debit);
          const credit = Decimal.from(line.credit);
          const fxRate = Decimal.from(line.fx_rate);

          const funcDebit = debit.isPositive() ? Decimal.multiply(debit, fxRate) : Decimal.ZERO;
          const funcCredit = credit.isPositive() ? Decimal.multiply(credit, fxRate) : Decimal.ZERO;

          cashOnHand = Decimal.add(cashOnHand, Decimal.subtract(funcDebit, funcCredit));
        }
      }

      // 2. 3-Month Trailing Burn (90 days prior to asOfDate)
      const dateObj = new Date(asOfDate);
      dateObj.setDate(dateObj.getDate() - 90);
      const ninetyDaysAgo = dateObj.toISOString().slice(0, 10);

      const pnlRows = await tx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select([
          'accounts.account_type',
          'accounts.is_contra',
          'journal_lines.debit',
          'journal_lines.credit',
          'journal_lines.fx_rate',
        ])
        .where('journal_lines.tenant_id', '=', tenantId)
        .where('journal_entries.status', '=', 'POSTED')
        .where('journal_entries.entry_date', '>=', ninetyDaysAgo)
        .where('journal_entries.entry_date', '<=', asOfDate)
        .where('accounts.account_type', 'in', ['REVENUE', 'EXPENSE'])
        .execute();

      let expensesPast90 = Decimal.ZERO;
      let revenuePast90 = Decimal.ZERO;

      for (const row of pnlRows) {
        const debit = Decimal.from(row.debit);
        const credit = Decimal.from(row.credit);
        const fxRate = Decimal.from(row.fx_rate);

        const funcDebit = debit.isPositive() ? Decimal.multiply(debit, fxRate) : Decimal.ZERO;
        const funcCredit = credit.isPositive() ? Decimal.multiply(credit, fxRate) : Decimal.ZERO;

        if (row.account_type === 'EXPENSE') {
          const net = row.is_contra
            ? Decimal.subtract(funcCredit, funcDebit)
            : Decimal.subtract(funcDebit, funcCredit);
          expensesPast90 = Decimal.add(expensesPast90, net);
        } else {
          const net = row.is_contra
            ? Decimal.subtract(funcDebit, funcCredit)
            : Decimal.subtract(funcCredit, funcDebit);
          revenuePast90 = Decimal.add(revenuePast90, net);
        }
      }

      // Net burn = Expenses - Operating Revenue
      const netBurn90Days = Decimal.subtract(expensesPast90, revenuePast90);
      let avgMonthlyBurn = Decimal.ZERO;

      if (netBurn90Days.isPositive()) {
        avgMonthlyBurn = Decimal.divide(netBurn90Days, '3', 4);
      }

      let runwayMonths = 'Infinity';
      if (avgMonthlyBurn.isPositive()) {
        if (cashOnHand.isPositive()) {
          runwayMonths = Decimal.divide(cashOnHand, avgMonthlyBurn, 2).toString();
        } else {
          runwayMonths = '0.00';
        }
      }

      return {
        as_of_date: asOfDate,
        cash_on_hand: cashOnHand.toString(),
        average_monthly_net_burn: avgMonthlyBurn.toString(),
        runway_months: runwayMonths,
        months_analyzed: 3,
      };
    });
  }
}
