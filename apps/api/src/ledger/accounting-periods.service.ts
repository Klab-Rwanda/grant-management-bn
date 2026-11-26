import { AccountingPeriodDto } from '@grant-ledger/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditLogService } from '../audit/audit.service';
import { TenantContextService } from '../database/tenant-context.service';

export interface CreateAccountingPeriodInput {
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
}

@Injectable()
export class AccountingPeriodsService {
  constructor(
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  async listPeriods(tenantId: string): Promise<AccountingPeriodDto[]> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const rows = await tx
        .selectFrom('accounting_periods')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .orderBy('period_start', 'asc')
        .execute();

      return rows as AccountingPeriodDto[];
    });
  }

  async getPeriodById(tenantId: string, id: string): Promise<AccountingPeriodDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const row = await tx
        .selectFrom('accounting_periods')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!row) {
        throw new NotFoundException(`Accounting period '${id}' not found`);
      }

      return row as AccountingPeriodDto;
    });
  }

  async findOpenPeriodForDate(tenantId: string, dateStr: string) {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const period = await tx
        .selectFrom('accounting_periods')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('period_start', '<=', dateStr)
        .where('period_end', '>=', dateStr)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();

      return period ?? null;
    });
  }

  async createPeriod(
    tenantId: string,
    input: CreateAccountingPeriodInput,
    actorId?: string,
  ): Promise<AccountingPeriodDto> {
    if (input.period_start > input.period_end) {
      throw new BadRequestException('period_start must be before or equal to period_end');
    }

    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      // Check for overlapping periods
      const overlap = await tx
        .selectFrom('accounting_periods')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.and([
            eb('period_start', '<=', input.period_end),
            eb('period_end', '>=', input.period_start),
          ]),
        )
        .executeTakeFirst();

      if (overlap) {
        throw new ConflictException(
          `Accounting period overlaps with an existing period (${overlap.id})`,
        );
      }

      const inserted = await tx
        .insertInto('accounting_periods')
        .values({
          tenant_id: tenantId,
          period_start: input.period_start,
          period_end: input.period_end,
          status: 'OPEN',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.auditLogService.append(tx, {
        tenant_id: tenantId,
        actor_id: actorId ?? null,
        actor_type: actorId ? 'USER' : 'SYSTEM',
        action: 'ACCOUNTING_PERIOD_CREATED',
        entity_type: 'AccountingPeriod',
        entity_id: inserted.id,
        after_state: inserted,
      });

      return inserted as AccountingPeriodDto;
    });
  }

  async closePeriod(
    tenantId: string,
    periodId: string,
    closedByUserId: string,
  ): Promise<AccountingPeriodDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const current = await tx
        .selectFrom('accounting_periods')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', periodId)
        .executeTakeFirst();

      if (!current) {
        throw new NotFoundException(`Accounting period '${periodId}' not found`);
      }

      if (current.status === 'CLOSED') {
        throw new BadRequestException(`Accounting period '${periodId}' is already closed`);
      }

      const updated = await tx
        .updateTable('accounting_periods')
        .set({
          status: 'CLOSED',
          closed_at: sql`now()`,
          closed_by_user_id: closedByUserId,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', periodId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Update organization books_closed_through
      await tx
        .updateTable('organizations')
        .set({
          books_closed_through: current.period_end,
          updated_at: sql`now()`,
        })
        .where('id', '=', tenantId)
        .execute();

      await this.auditLogService.append(tx, {
        tenant_id: tenantId,
        actor_id: closedByUserId,
        actor_type: 'USER',
        action: 'ACCOUNTING_PERIOD_CLOSED',
        entity_type: 'AccountingPeriod',
        entity_id: periodId,
        before_state: current,
        after_state: updated,
      });

      return updated as AccountingPeriodDto;
    });
  }
}
