import { HealthCheckResponse } from '@grant-ledger/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HealthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async check(): Promise<HealthCheckResponse> {
    const postgresUp = await this.database.ping();
    return {
      status: postgresUp ? 'ok' : 'degraded',
      service: 'grant-ledger-api',
      timestamp: new Date().toISOString(),
      checks: {
        postgres: postgresUp ? 'up' : 'down',
      },
    };
  }
}
