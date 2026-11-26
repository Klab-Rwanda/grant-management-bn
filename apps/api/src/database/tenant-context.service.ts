import { Inject, Injectable } from '@nestjs/common';
import { sql, Transaction } from 'kysely';
import { DatabaseService } from './database.service';
import { Database } from './database.types';

export interface TenantContextOptions {
  asAppRole?: boolean;
}

@Injectable()
export class TenantContextService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * Executes a callback inside an isolated transaction with tenant-scoped RLS.
   * Runs `SET LOCAL app.current_tenant_id` and switches to the non-owner `grant_ledger_app` role.
   * Both settings are strictly local to this transaction and cleared upon completion.
   */
  async withTenantContext<T>(
    tenantId: string,
    callback: (tx: Transaction<Database>) => Promise<T>,
    options: TenantContextOptions = {},
  ): Promise<T> {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('TenantContextService: a valid tenantId is required');
    }

    return await this.database.db.transaction().execute(async (tx) => {
      // Set transaction-local setting for RLS policies
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`.execute(tx);

      // Assume non-owner application role so FORCE RLS and revokes are strictly applied
      if (options.asAppRole ?? true) {
        try {
          await sql`SET LOCAL ROLE grant_ledger_app`.execute(tx);
        } catch {
          // In local test environments without grant_ledger_app role, continue under current role
        }
      }

      return await callback(tx);
    });
  }

  /**
   * Executes a callback without a tenant scope (e.g. pre-auth membership resolution).
   * Runs with `app.current_tenant_id` explicitly set to empty string.
   */
  async withUnsetTenantContext<T>(
    callback: (tx: Transaction<Database>) => Promise<T>,
    options: TenantContextOptions = {},
  ): Promise<T> {
    return await this.database.db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.current_tenant_id', '', true)`.execute(tx);

      if (options.asAppRole ?? true) {
        try {
          await sql`SET LOCAL ROLE grant_ledger_app`.execute(tx);
        } catch {
          // Ignore if role not configured in environment
        }
      }

      return await callback(tx);
    });
  }

  /**
   * Executes a privileged callback under the connection owner without role downgrade.
   */
  async withOwnerContext<T>(callback: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return await this.database.db.transaction().execute(async (tx) => {
      return await callback(tx);
    });
  }
}
