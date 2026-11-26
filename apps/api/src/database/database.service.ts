import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { EnvService } from '../config/env';
import { Database } from './database.types';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  public readonly pool: Pool;
  public readonly db: Kysely<Database>;

  constructor(@Inject(EnvService) envService: EnvService) {
    this.pool = new Pool({
      connectionString: envService.config.DATABASE_URL,
      max: 10,
    });

    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: this.pool,
      }),
    });
  }

  async ping(): Promise<boolean> {
    try {
      await sql`SELECT 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
