import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogService } from '../audit/audit.service';
import { TenantContextService } from '../database/tenant-context.service';
import { AccountingPeriodsService } from './accounting-periods.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { FinancialReportsService } from './financial-reports.service';
import { JournalEntriesService } from './journal-entries.service';

describe('Startup Double-Entry Ledger Unit Tests', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const actorId = '22222222-2222-2222-2222-222222222222';

  let mockTenantContext: TenantContextService;
  let mockAuditLogService: AuditLogService;
  let mockAccountingPeriodsService: AccountingPeriodsService;
  let mockChartOfAccountsService: ChartOfAccountsService;
  let journalEntriesService: JournalEntriesService;
  let financialReportsService: FinancialReportsService;

  beforeEach(() => {
    mockAuditLogService = {
      appendAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    } as unknown as AuditLogService;

    mockAccountingPeriodsService = {
      findOpenPeriodForDate: vi.fn().mockImplementation((_tId: string, dateStr: string) => {
        if (dateStr >= '2026-01-01' && dateStr <= '2026-12-31') {
          return Promise.resolve({
            id: 'period-2026-01',
            tenant_id: tenantId,
            period_start: '2026-01-01',
            period_end: '2026-01-31',
            status: 'OPEN',
          });
        }
        return Promise.resolve(null);
      }),
      listPeriods: vi.fn(),
      createPeriod: vi.fn(),
      closePeriod: vi.fn(),
    } as unknown as AccountingPeriodsService;

    mockChartOfAccountsService = {
      getAccountById: vi.fn().mockImplementation((_tId: string, accountId: string) => {
        if (accountId === 'acc-bank') {
          return Promise.resolve({
            id: 'acc-bank',
            code: '1010',
            name: 'Operating bank account',
            account_type: 'ASSET',
            account_subtype: 'CASH_AND_BANK',
            is_contra: false,
            is_archived: false,
          });
        }
        if (accountId === 'acc-expense') {
          return Promise.resolve({
            id: 'acc-expense',
            code: '5100',
            name: 'Cloud infrastructure',
            account_type: 'EXPENSE',
            is_contra: false,
            is_archived: false,
          });
        }
        if (accountId === 'acc-revenue') {
          return Promise.resolve({
            id: 'acc-revenue',
            code: '4100',
            name: 'Subscription revenue',
            account_type: 'REVENUE',
            is_contra: false,
            is_archived: false,
          });
        }
        if (accountId === 'acc-archived') {
          return Promise.resolve({
            id: 'acc-archived',
            code: '9999',
            name: 'Archived account',
            account_type: 'EXPENSE',
            is_contra: false,
            is_archived: true,
          });
        }
        throw new BadRequestException(`Account ${accountId} not found`);
      }),
    } as unknown as ChartOfAccountsService;

    // Fake query builder for withTenantContext
    mockTenantContext = {
      withTenantContext: vi
        .fn()
        .mockImplementation((_tId: string, callback: (tx: unknown) => unknown) => {
          const fakeTx = {
            insertInto: vi.fn().mockReturnValue({
              values: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue(undefined),
              }),
            }),
            updateTable: vi.fn().mockReturnValue({
              set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue(undefined),
                  }),
                }),
              }),
            }),
            selectFrom: vi.fn().mockImplementation(() => {
              let isCheckingReverses = false;
              const builder: Record<string, unknown> = {
                selectAll: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockImplementation((col: string) => {
                  if (col === 'reverses_entry_id') {
                    isCheckingReverses = true;
                  }
                  return builder;
                }),
                orderBy: vi.fn().mockReturnThis(),
                executeTakeFirst: vi.fn().mockImplementation(() => {
                  if (isCheckingReverses) {
                    return Promise.resolve(null);
                  }
                  return Promise.resolve({
                    id: 'entry-123',
                    tenant_id: tenantId,
                    entry_date: '2026-01-15',
                    period_id: 'period-2026-01',
                    memo: 'Test entry',
                    status: 'POSTED',
                    source: 'MANUAL',
                    reverses_entry_id: null,
                    created_by_user_id: actorId,
                    posted_at: '2026-01-15T10:00:00.000Z',
                    created_at: '2026-01-15T10:00:00.000Z',
                  });
                }),
                execute: vi.fn().mockResolvedValue([
                  {
                    id: 'line-1',
                    journal_entry_id: 'entry-123',
                    line_order: 1,
                    account_id: 'acc-expense',
                    account_code: '5100',
                    account_name: 'Cloud infrastructure',
                    debit: '500.0000',
                    credit: '0.0000',
                    currency: 'USD',
                    fx_rate: '1.0000',
                    amount_functional: '500.0000',
                    created_at: '2026-01-15T10:00:00.000Z',
                  },
                  {
                    id: 'line-2',
                    journal_entry_id: 'entry-123',
                    line_order: 2,
                    account_id: 'acc-bank',
                    account_code: '1010',
                    account_name: 'Operating bank account',
                    debit: '0.0000',
                    credit: '500.0000',
                    currency: 'USD',
                    fx_rate: '1.0000',
                    amount_functional: '500.0000',
                    created_at: '2026-01-15T10:00:00.000Z',
                  },
                ]),
              };
              return builder;
            }),
          };
          return callback(fakeTx);
        }),
    } as unknown as TenantContextService;

    journalEntriesService = new JournalEntriesService(
      mockTenantContext,
      mockAuditLogService,
      mockAccountingPeriodsService,
      mockChartOfAccountsService,
    );

    financialReportsService = new FinancialReportsService(mockTenantContext);
  });

  describe('Journal Entry Validation & Posting Rules', () => {
    it('rejects entries with invalid date format', async () => {
      await expect(
        journalEntriesService.postEntry(
          tenantId,
          {
            entry_date: '15-01-2026',
            memo: 'Invalid date',
            lines: [],
          },
          actorId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects entries without an open accounting period', async () => {
      await expect(
        journalEntriesService.postEntry(
          tenantId,
          {
            entry_date: '2024-01-15', // Outside mock period range
            memo: 'Closed period',
            lines: [
              { account_id: 'acc-expense', debit: '100.0000' },
              { account_id: 'acc-bank', credit: '100.0000' },
            ],
          },
          actorId,
        ),
      ).rejects.toThrow('No open accounting period covers entry_date');
    });

    it('rejects entries with fewer than 2 lines', async () => {
      await expect(
        journalEntriesService.postEntry(
          tenantId,
          {
            entry_date: '2026-01-15',
            memo: 'One line only',
            lines: [{ account_id: 'acc-expense', debit: '100.0000' }],
          },
          actorId,
        ),
      ).rejects.toThrow('must have at least 2 lines');
    });

    it('rejects lines where both debit and credit are specified', async () => {
      await expect(
        journalEntriesService.postEntry(
          tenantId,
          {
            entry_date: '2026-01-15',
            memo: 'Both debit and credit',
            lines: [
              { account_id: 'acc-expense', debit: '100.0000', credit: '100.0000' },
              { account_id: 'acc-bank', credit: '100.0000' },
            ],
          },
          actorId,
        ),
      ).rejects.toThrow('never both or neither');
    });

    it('rejects lines where neither debit nor credit is specified', async () => {
      await expect(
        journalEntriesService.postEntry(
          tenantId,
          {
            entry_date: '2026-01-15',
            memo: 'Neither debit nor credit',
            lines: [
              { account_id: 'acc-expense', debit: '0.0000', credit: '0.0000' },
              { account_id: 'acc-bank', credit: '100.0000' },
            ],
          },
          actorId,
        ),
      ).rejects.toThrow('never both or neither');
    });

    it('rejects posting to archived accounts', async () => {
      await expect(
        journalEntriesService.postEntry(
          tenantId,
          {
            entry_date: '2026-01-15',
            memo: 'Post to archived',
            lines: [
              { account_id: 'acc-archived', debit: '100.0000' },
              { account_id: 'acc-bank', credit: '100.0000' },
            ],
          },
          actorId,
        ),
      ).rejects.toThrow('archived account');
    });

    it('rejects unbalanced journal entries (functional debits != functional credits)', async () => {
      await expect(
        journalEntriesService.postEntry(
          tenantId,
          {
            entry_date: '2026-01-15',
            memo: 'Unbalanced entry',
            lines: [
              { account_id: 'acc-expense', debit: '150.0000' },
              { account_id: 'acc-bank', credit: '100.0000' },
            ],
          },
          actorId,
        ),
      ).rejects.toThrow('Journal entry is unbalanced');
    });

    it('correctly balances multi-currency entries using exact Decimal FX arithmetic', async () => {
      // 100 EUR @ 1.0800 FX = 108.0000 USD functional
      // Credit: 108.0000 USD @ 1.0000 FX = 108.0000 USD functional
      const entry = await journalEntriesService.postEntry(
        tenantId,
        {
          entry_date: '2026-01-15',
          memo: 'AWS Europe Server Bill',
          lines: [
            {
              account_id: 'acc-expense',
              debit: '100.0000',
              currency: 'EUR',
              fx_rate: '1.0800',
            },
            {
              account_id: 'acc-bank',
              credit: '108.0000',
              currency: 'USD',
              fx_rate: '1.0000',
            },
          ],
        },
        actorId,
      );

      expect(entry).toBeDefined();
      expect(entry.status).toBe('POSTED');
      expect(mockAuditLogService.appendAuditLog).toHaveBeenCalled();
    });

    it('simple expense helper generates balanced entry and records properly', async () => {
      const entry = await journalEntriesService.recordExpense(
        tenantId,
        {
          entry_date: '2026-01-15',
          memo: 'Monthly SaaS hosting',
          expense_account_id: 'acc-expense',
          payment_account_id: 'acc-bank',
          amount: '450.0000',
        },
        actorId,
      );

      expect(entry).toBeDefined();
      expect(entry.status).toBe('POSTED');
    });
  });

  describe('Journal Reversal Rules', () => {
    it('creates an inverted reversal entry, marks original as REVERSED, and logs audit', async () => {
      const reversal = await journalEntriesService.reverseEntry(
        tenantId,
        'entry-123',
        actorId,
        'Incorrect billing amount',
      );

      expect(reversal).toBeDefined();
      expect(mockAuditLogService.appendAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'JOURNAL_ENTRY_REVERSED',
          entity_type: 'JOURNAL_ENTRY',
        }),
      );
    });

    it('rejects reversing an already reversed entry', async () => {
      // Configure mock to return REVERSED status
      mockTenantContext.withTenantContext = vi
        .fn()
        .mockImplementation((_tId: string, cb: (tx: unknown) => unknown) => {
          const fakeTx = {
            selectFrom: vi.fn().mockReturnValue({
              selectAll: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              executeTakeFirst: vi.fn().mockResolvedValue({
                id: 'entry-already-reversed',
                status: 'REVERSED',
              }),
            }),
          };
          return cb(fakeTx);
        });

      await expect(
        journalEntriesService.reverseEntry(tenantId, 'entry-already-reversed', actorId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Financial Reports Exact Decimal Calculations', () => {
    it('computes Trial Balance correctly and verifies equality of debits and credits', async () => {
      mockTenantContext.withTenantContext = vi
        .fn()
        .mockImplementation((_tId: string, cb: (tx: unknown) => unknown) => {
          const fakeTx = {
            selectFrom: vi.fn().mockImplementation((table: string) => {
              if (table === 'accounts') {
                return {
                  selectAll: vi.fn().mockReturnThis(),
                  where: vi.fn().mockReturnThis(),
                  orderBy: vi.fn().mockReturnThis(),
                  execute: vi.fn().mockResolvedValue([
                    {
                      id: 'acc-bank',
                      code: '1010',
                      name: 'Bank',
                      account_type: 'ASSET',
                      is_contra: false,
                    },
                    {
                      id: 'acc-expense',
                      code: '5100',
                      name: 'Hosting',
                      account_type: 'EXPENSE',
                      is_contra: false,
                    },
                  ]),
                };
              }
              if (table === 'journal_lines') {
                return {
                  innerJoin: vi.fn().mockReturnThis(),
                  select: vi.fn().mockReturnThis(),
                  where: vi.fn().mockReturnThis(),
                  execute: vi.fn().mockResolvedValue([
                    {
                      account_id: 'acc-expense',
                      debit: '500.0000',
                      credit: '0.0000',
                      fx_rate: '1.0000',
                    },
                    {
                      account_id: 'acc-bank',
                      debit: '0.0000',
                      credit: '500.0000',
                      fx_rate: '1.0000',
                    },
                  ]),
                };
              }
              return { where: vi.fn().mockReturnThis(), execute: vi.fn().mockResolvedValue([]) };
            }),
          };
          return cb(fakeTx);
        });

      const trialBalance = await financialReportsService.getTrialBalance(tenantId, '2026-01-31');

      expect(trialBalance.is_balanced).toBe(true);
      expect(trialBalance.total_debits).toBe('500.0000');
      expect(trialBalance.total_credits).toBe('500.0000');
    });

    it('computes Profit and Loss (Net Income = Total Revenue - Total Expense)', async () => {
      mockTenantContext.withTenantContext = vi
        .fn()
        .mockImplementation((_tId: string, cb: (tx: unknown) => unknown) => {
          const fakeTx = {
            selectFrom: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              execute: vi.fn().mockResolvedValue([
                {
                  account_id: 'acc-revenue',
                  account_code: '4100',
                  account_name: 'Subscription revenue',
                  account_type: 'REVENUE',
                  is_contra: false,
                  debit: '0.0000',
                  credit: '1500.0000',
                  fx_rate: '1.0000',
                },
                {
                  account_id: 'acc-expense',
                  account_code: '5100',
                  account_name: 'Cloud infrastructure',
                  account_type: 'EXPENSE',
                  is_contra: false,
                  debit: '400.0000',
                  credit: '0.0000',
                  fx_rate: '1.0000',
                },
              ]),
            }),
          };
          return cb(fakeTx);
        });

      const pnl = await financialReportsService.getProfitAndLoss(
        tenantId,
        '2026-01-01',
        '2026-01-31',
      );

      expect(pnl.revenues.total).toBe('1500.0000');
      expect(pnl.expenses.total).toBe('400.0000');
      expect(pnl.net_income).toBe('1100.0000');
    });

    it('computes Balance Sheet with balanced equation (Assets = Liabilities + Equity + Net Income)', async () => {
      mockTenantContext.withTenantContext = vi
        .fn()
        .mockImplementation((_tId: string, cb: (tx: unknown) => unknown) => {
          const fakeTx = {
            selectFrom: vi.fn().mockImplementation((table: string) => {
              if (table === 'accounts') {
                return {
                  selectAll: vi.fn().mockReturnThis(),
                  where: vi.fn().mockReturnThis(),
                  execute: vi.fn().mockResolvedValue([
                    {
                      id: 'acc-bank',
                      code: '1010',
                      name: 'Bank',
                      account_type: 'ASSET',
                      is_contra: false,
                    },
                    {
                      id: 'acc-equity',
                      code: '3100',
                      name: 'Common stock',
                      account_type: 'EQUITY',
                      is_contra: false,
                    },
                  ]),
                };
              }
              if (table === 'journal_lines') {
                return {
                  innerJoin: vi.fn().mockReturnThis(),
                  select: vi.fn().mockReturnThis(),
                  where: vi.fn().mockReturnThis(),
                  execute: vi.fn().mockResolvedValue([
                    {
                      account_id: 'acc-bank',
                      debit: '10000.0000',
                      credit: '0.0000',
                      fx_rate: '1.0000',
                    },
                    {
                      account_id: 'acc-equity',
                      debit: '0.0000',
                      credit: '10000.0000',
                      fx_rate: '1.0000',
                    },
                  ]),
                };
              }
              return { where: vi.fn().mockReturnThis(), execute: vi.fn().mockResolvedValue([]) };
            }),
          };
          return cb(fakeTx);
        });

      const balanceSheet = await financialReportsService.getBalanceSheet(tenantId, '2026-01-31');

      expect(balanceSheet.is_balanced).toBe(true);
      expect(balanceSheet.assets.total).toBe('10000.0000');
      expect(balanceSheet.total_liabilities_and_equity).toBe('10000.0000');
    });
  });
});
