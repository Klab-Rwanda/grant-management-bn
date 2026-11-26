import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditVerifierService } from '../src/audit/audit-verifier.service';
import { AuditLogService } from '../src/audit/audit.service';
import { DatabaseService } from '../src/database/database.service';
import { Database } from '../src/database/database.types';
import { TenantContextService } from '../src/database/tenant-context.service';
import { AccountingPeriodsService } from '../src/ledger/accounting-periods.service';
import { ChartOfAccountsService } from '../src/ledger/chart-of-accounts.service';
import { FinancialReportsService } from '../src/ledger/financial-reports.service';
import { JournalEntriesService } from '../src/ledger/journal-entries.service';

describe('Ledger Module Integration Tests (Real Postgres & Triggers)', () => {
  let container: StartedPostgreSqlContainer | null = null;
  let connectionString: string;
  let ownerPool: Pool;
  let ownerDb: Kysely<Database>;
  let tenantService: TenantContextService;
  let auditLogService: AuditLogService;
  let auditVerifier: AuditVerifierService;
  let chartOfAccountsService: ChartOfAccountsService;
  let accountingPeriodsService: AccountingPeriodsService;
  let journalEntriesService: JournalEntriesService;
  let financialReportsService: FinancialReportsService;

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const actorId = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    // Start real PostgreSQL container
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('grant_ledger_test')
      .withUsername('grant_ledger')
      .withPassword('grant_ledger_test')
      .start();

    connectionString = container.getConnectionUri();

    // Run SQL migrations up
    await runner({
      databaseUrl: connectionString,
      dir: resolve(__dirname, '../migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      checkOrder: true,
      log: () => undefined,
    });

    ownerPool = new Pool({ connectionString });
    ownerDb = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: ownerPool }),
    });

    const mockDbService = { pool: ownerPool, db: ownerDb } as unknown as DatabaseService;
    tenantService = new TenantContextService(mockDbService);
    auditLogService = new AuditLogService();
    auditVerifier = new AuditVerifierService();

    chartOfAccountsService = new ChartOfAccountsService(tenantService, auditLogService);
    accountingPeriodsService = new AccountingPeriodsService(tenantService, auditLogService);
    journalEntriesService = new JournalEntriesService(
      tenantService,
      auditLogService,
      accountingPeriodsService,
      chartOfAccountsService,
    );
    financialReportsService = new FinancialReportsService(tenantService);

    // Seed test tenant organization
    await ownerDb
      .insertInto('organizations')
      .values({
        id: tenantId,
        legal_name: 'Ledger Test Startup Inc',
        org_type: 'STARTUP',
        status: 'ACTIVE',
        country: 'US',
        functional_currency: 'USD',
        fiscal_year_start_month: 1,
      })
      .execute();

    // Seed user
    await ownerDb
      .insertInto('users')
      .values({
        id: actorId,
        email: 'founder@ledgertest.com',
        full_name: 'Test Founder',
        status: 'ACTIVE',
      })
      .execute();
  });

  afterAll(async () => {
    if (ownerPool) {
      await ownerPool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it('seeds standard 42-account Chart of Accounts and verifies account structure', async () => {
    const result = await chartOfAccountsService.seedTechStartupTemplate(tenantId, actorId);
    expect(result.seeded_count).toBe(42);

    const accounts = await chartOfAccountsService.listAccounts(tenantId);
    expect(accounts.length).toBe(42);

    const bankAcc = accounts.find((a) => a.code === '1010');
    expect(bankAcc).toBeDefined();
    expect(bankAcc?.account_type).toBe('ASSET');
    expect(bankAcc?.account_subtype).toBe('CASH_AND_BANK');

    const deferredGrantAcc = accounts.find((a) => a.code === '2400');
    expect(deferredGrantAcc).toBeDefined();
    expect(deferredGrantAcc?.account_type).toBe('LIABILITY');
    expect(deferredGrantAcc?.account_subtype).toBe('DEFERRED_GRANT_INCOME');
  });

  it('creates and manages accounting periods, rejecting overlaps', async () => {
    const period1 = await accountingPeriodsService.createPeriod(
      tenantId,
      { period_start: '2026-01-01', period_end: '2026-01-31' },
      actorId,
    );
    expect(period1.id).toBeDefined();
    expect(period1.status).toBe('OPEN');

    // Attempt overlapping period
    await expect(
      accountingPeriodsService.createPeriod(
        tenantId,
        { period_start: '2026-01-15', period_end: '2026-02-15' },
        actorId,
      ),
    ).rejects.toThrow('overlaps with existing accounting period');
  });

  it('posts a balanced journal entry and writes an append-only audit log', async () => {
    const accounts = await chartOfAccountsService.listAccounts(tenantId);
    const bankAcc = accounts.find((a) => a.code === '1010')!;
    const expenseAcc = accounts.find((a) => a.code === '5100')!;

    const entry = await journalEntriesService.postEntry(
      tenantId,
      {
        entry_date: '2026-01-10',
        memo: 'Purchased cloud server infrastructure',
        lines: [
          { account_id: expenseAcc.id, debit: '1500.0000', currency: 'USD' },
          { account_id: bankAcc.id, credit: '1500.0000', currency: 'USD' },
        ],
      },
      actorId,
    );

    expect(entry).toBeDefined();
    expect(entry.status).toBe('POSTED');
    expect(entry.lines.length).toBe(2);

    // Verify trial balance is balanced
    const tb = await financialReportsService.getTrialBalance(tenantId, '2026-01-31');
    expect(tb.is_balanced).toBe(true);
    expect(tb.total_debits).toBe('1500.0000');
    expect(tb.total_credits).toBe('1500.0000');
  });

  it('rejects an unbalanced journal entry at the service and DB trigger level', async () => {
    const accounts = await chartOfAccountsService.listAccounts(tenantId);
    const bankAcc = accounts.find((a) => a.code === '1010')!;
    const expenseAcc = accounts.find((a) => a.code === '5100')!;

    await expect(
      journalEntriesService.postEntry(
        tenantId,
        {
          entry_date: '2026-01-12',
          memo: 'Unbalanced payment',
          lines: [
            { account_id: expenseAcc.id, debit: '2000.0000' },
            { account_id: bankAcc.id, credit: '1800.0000' },
          ],
        },
        actorId,
      ),
    ).rejects.toThrow('Journal entry is unbalanced');
  });

  it('reverses a posted journal entry, leaving Trial Balance perfectly net balanced', async () => {
    const accounts = await chartOfAccountsService.listAccounts(tenantId);
    const bankAcc = accounts.find((a) => a.code === '1010')!;
    const expenseAcc = accounts.find((a) => a.code === '5200')!; // Software subscriptions

    // 1. Post original entry
    const original = await journalEntriesService.postEntry(
      tenantId,
      {
        entry_date: '2026-01-15',
        memo: 'Wrong SaaS billing',
        lines: [
          { account_id: expenseAcc.id, debit: '800.0000' },
          { account_id: bankAcc.id, credit: '800.0000' },
        ],
      },
      actorId,
    );

    expect(original.status).toBe('POSTED');

    // 2. Reverse entry
    const reversal = await journalEntriesService.reverseEntry(
      tenantId,
      original.id,
      actorId,
      'Double billed by vendor',
    );

    expect(reversal.status).toBe('POSTED');
    expect(reversal.source).toBe('REVERSAL');
    expect(reversal.reverses_entry_id).toBe(original.id);

    // Verify original entry is now marked REVERSED
    const updatedOriginal = await journalEntriesService.getEntryById(tenantId, original.id);
    expect(updatedOriginal.status).toBe('REVERSED');

    // Verify trial balance: expense account 5200 has 800 debit + 800 credit => net balance = 0
    const tb = await financialReportsService.getTrialBalance(tenantId, '2026-01-31');
    expect(tb.is_balanced).toBe(true);
    const softwareAcc = tb.accounts.find((a) => a.code === '5200');
    expect(softwareAcc?.net_balance).toBe('0.0000');
  });

  it('closes an accounting period and rejects posting into closed periods', async () => {
    const periods = await accountingPeriodsService.listPeriods(tenantId);
    const janPeriod = periods.find((p) => p.period_start === '2026-01-01')!;

    await accountingPeriodsService.closePeriod(tenantId, janPeriod.id, actorId);

    const closedJan = await accountingPeriodsService.getPeriodById(tenantId, janPeriod.id);
    expect(closedJan.status).toBe('CLOSED');

    const accounts = await chartOfAccountsService.listAccounts(tenantId);
    const bankAcc = accounts.find((a) => a.code === '1010')!;
    const expenseAcc = accounts.find((a) => a.code === '5100')!;

    // Posting into closed period is rejected
    await expect(
      journalEntriesService.postEntry(
        tenantId,
        {
          entry_date: '2026-01-20',
          memo: 'Post into closed period',
          lines: [
            { account_id: expenseAcc.id, debit: '100.0000' },
            { account_id: bankAcc.id, credit: '100.0000' },
          ],
        },
        actorId,
      ),
    ).rejects.toThrow('No open accounting period covers entry_date');
  });

  it('verifies cryptographic hash chain of audit logs across all ledger actions', async () => {
    const chainResult = await auditVerifier.verifyTenantChain(ownerDb, tenantId);
    expect(chainResult.valid).toBe(true);
    expect(chainResult.checkedCount).toBeGreaterThan(0);
  });
});
