import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditVerifierService } from '../src/audit/audit-verifier.service';
import { AuditLogService } from '../src/audit/audit.service';
import { DatabaseService } from '../src/database/database.service';
import { Database } from '../src/database/database.types';
import { TenantContextService } from '../src/database/tenant-context.service';

describe('Security Base Integration Tests (Real Postgres)', () => {
  let container: StartedPostgreSqlContainer | null = null;
  let connectionString: string;
  let ownerPool: Pool;
  let ownerDb: Kysely<Database>;
  let tenantService: TenantContextService;
  let auditLogService: AuditLogService;
  let auditVerifier: AuditVerifierService;

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

    // DatabaseService to back TenantContextService
    const mockDbService = { pool: ownerPool, db: ownerDb } as unknown as DatabaseService;
    tenantService = new TenantContextService(mockDbService);
    auditLogService = new AuditLogService();
    auditVerifier = new AuditVerifierService();
  });

  afterAll(async () => {
    if (ownerPool) {
      await ownerPool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it('fails if any table with tenant_id in public schema lacks an RLS policy or is not forced', async () => {
    const result = await sql<{
      table_name: string;
      has_rls: boolean;
      is_forced: boolean;
      policy_count: number;
    }>`
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS has_rls,
        c.relforcerowsecurity AS is_forced,
        (SELECT count(*)::int FROM pg_policy pol WHERE pol.polrelid = c.oid) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
    `.execute(ownerDb);

    expect(result.rows.length).toBeGreaterThan(0);

    for (const row of result.rows) {
      expect(row.has_rls, `Table ${row.table_name} must have RLS enabled`).toBe(true);
      expect(row.is_forced, `Table ${row.table_name} must have FORCE RLS enabled`).toBe(true);
      expect(
        row.policy_count,
        `Table ${row.table_name} must have at least one RLS policy`,
      ).toBeGreaterThan(0);
    }
  });

  it('guarantees tenant isolation: Tenant A cannot read, update, delete or link Tenant B rows', async () => {
    // 1. Setup two distinct organizations and users
    const [tenantA, tenantB] = await ownerDb
      .insertInto('organizations')
      .values([
        {
          legal_name: 'Startup Alpha',
          org_type: 'STARTUP',
          country: 'US',
          functional_currency: 'USD',
        },
        {
          legal_name: 'Startup Beta',
          org_type: 'STARTUP',
          country: 'US',
          functional_currency: 'USD',
        },
      ])
      .returning(['id', 'legal_name'])
      .execute();

    const [userA, userB] = await ownerDb
      .insertInto('users')
      .values([
        { email: 'alpha@startup.io', full_name: 'Alice Alpha' },
        { email: 'beta@startup.io', full_name: 'Bob Beta' },
      ])
      .returning(['id', 'email'])
      .execute();

    // 2. Tenant A inserts a membership
    await tenantService.withTenantContext(tenantA!.id, async (tx) => {
      await tx
        .insertInto('memberships')
        .values({
          tenant_id: tenantA!.id,
          user_id: userA!.id,
          role: 'FDR',
          scope_metadata: JSON.stringify({}),
        })
        .execute();
    });

    // 3. Tenant B queries memberships -> sees 0 rows for Tenant A
    await tenantService.withTenantContext(tenantB!.id, async (tx) => {
      const rows = await tx.selectFrom('memberships').selectAll().execute();
      expect(rows).toHaveLength(0);

      // Attempting to delete Tenant A's row affects 0 rows
      const deleteResult = await tx
        .deleteFrom('memberships')
        .where('user_id', '=', userA!.id)
        .executeTakeFirst();
      expect(Number(deleteResult.numDeletedRows ?? 0)).toBe(0);

      // Attempting to cross-insert Tenant A's tenant_id while in Tenant B context fails RLS
      await expect(
        tx
          .insertInto('memberships')
          .values({
            tenant_id: tenantA!.id,
            user_id: userB!.id,
            role: 'FIN',
            scope_metadata: JSON.stringify({}),
          })
          .execute(),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('guarantees sequential requests with different tenants on pooled connections never leak context', async () => {
    // Create a pool with max: 1 to guarantee physical connection reuse
    const singleConnPool = new Pool({ connectionString, max: 1 });
    const singleDb = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: singleConnPool }),
    });
    const scopedService = new TenantContextService({
      pool: singleConnPool,
      db: singleDb,
    } as unknown as DatabaseService);

    const [tenant1, tenant2] = await ownerDb
      .insertInto('organizations')
      .values([
        {
          legal_name: 'Tenant One',
          org_type: 'STARTUP',
          country: 'US',
          functional_currency: 'USD',
        },
        {
          legal_name: 'Tenant Two',
          org_type: 'STARTUP',
          country: 'US',
          functional_currency: 'USD',
        },
      ])
      .returning(['id'])
      .execute();

    const user = await ownerDb
      .insertInto('users')
      .values({ email: 'pooled-test@user.io', full_name: 'Pooled Test User' })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Populate 1 row in Tenant One
    await scopedService.withTenantContext(tenant1!.id, async (tx) => {
      await tx
        .insertInto('memberships')
        .values({
          tenant_id: tenant1!.id,
          user_id: user.id,
          role: 'FIN',
          scope_metadata: JSON.stringify({}),
        })
        .execute();
    });

    // Request 1: Tenant 1 context -> sees 1 row
    await scopedService.withTenantContext(tenant1!.id, async (tx) => {
      const rows = await tx.selectFrom('memberships').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(tenant1!.id);
    });

    // Request 2 on the SAME physical connection: Tenant 2 context -> sees 0 rows
    await scopedService.withTenantContext(tenant2!.id, async (tx) => {
      const rows = await tx.selectFrom('memberships').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    // Request 3: Unset tenant context on the SAME connection -> sees 0 rows
    await scopedService.withUnsetTenantContext(async (tx) => {
      const rows = await tx.selectFrom('memberships').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    await singleConnPool.end();
  });

  it('guarantees audit_logs is append-only, rejects UPDATE/DELETE, and detects row tampering', async () => {
    const tenant = await ownerDb
      .insertInto('organizations')
      .values({
        legal_name: 'Audit Security Test',
        org_type: 'STARTUP',
        country: 'US',
        functional_currency: 'USD',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // 1. Insert 3 valid audit log entries through AuditLogService inside tenant context
    await tenantService.withTenantContext(tenant.id, async (tx) => {
      await auditLogService.append(tx, {
        tenant_id: tenant.id,
        actor_type: 'SYSTEM',
        action: 'INIT',
        entity_type: 'Organization',
        entity_id: tenant.id,
      });

      await auditLogService.append(tx, {
        tenant_id: tenant.id,
        actor_type: 'USER',
        action: 'SETTING_CHANGE',
        entity_type: 'Setting',
        after_state: { mode: 'active' },
      });

      await auditLogService.append(tx, {
        tenant_id: tenant.id,
        actor_type: 'USER',
        action: 'SUBMIT_PREVIEW',
        entity_type: 'Tranche',
        after_state: { step: 1 },
      });
    });

    // 2. Verify clean chain passes
    const validResult = await auditVerifier.verifyTenantChain(ownerDb, tenant.id);
    expect(validResult.valid).toBe(true);
    expect(validResult.checkedCount).toBe(3);

    // 3. Attempt UPDATE and DELETE under application role -> must be rejected
    await tenantService.withTenantContext(tenant.id, async (tx) => {
      await expect(
        tx.updateTable('audit_logs').set({ action: 'MALICIOUS_UPDATE' }).execute(),
      ).rejects.toThrow(/permission denied|append-only/i);

      await expect(
        tx.deleteFrom('audit_logs').where('tenant_id', '=', tenant.id).execute(),
      ).rejects.toThrow(/permission denied|append-only/i);
    });

    // 4. Simulate tampering directly as database owner
    await ownerDb
      .updateTable('audit_logs')
      .set({ after_state: JSON.stringify({ mode: 'TAMPERED_STATE' }) })
      .where('tenant_id', '=', tenant.id)
      .where('seq_no', '=', 2)
      .execute();

    // 5. Chain verifier detects the tampered row at seq_no 2
    const tamperedResult = await auditVerifier.verifyTenantChain(ownerDb, tenant.id);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.brokenAtSeqNo).toBe(2);
    expect(tamperedResult.reason).toMatch(/tampered/i);
  });
});
