import type { AuthUserContext } from '@grant-ledger/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditLogService } from '../audit/audit.service';
import { TenantContextService } from '../database/tenant-context.service';
import { parseCamt053 } from './camt053.parser';

export interface ImportBankStatementInput {
  source_filename: string;
  xml: string;
}

@Injectable()
export class BankStatementsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditLog: AuditLogService,
  ) {}

  async importStatement(actor: AuthUserContext, input: ImportBankStatementInput) {
    if (actor.org_type !== 'STARTUP' || (actor.role !== 'FIN' && actor.role !== 'FDR')) {
      throw new ForbiddenException('Only startup finance leads and founders can import statements');
    }
    if (!input || typeof input.source_filename !== 'string') {
      throw new BadRequestException('A statement file name is required');
    }
    const sourceFilename = input.source_filename.split(/[\\/]/).pop()?.trim() ?? '';
    if (
      sourceFilename.length < 1 ||
      sourceFilename.length > 255 ||
      !sourceFilename.toLowerCase().endsWith('.xml')
    ) {
      throw new BadRequestException(
        'Statement file name must end in .xml and be at most 255 characters',
      );
    }
    const transactions = parseCamt053(input.xml);
    const sha256 = createHash('sha256').update(input.xml, 'utf8').digest('hex');

    try {
      return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
        const organization = await tx
          .selectFrom('organizations')
          .select(['id', 'status', 'org_type'])
          .where('id', '=', actor.tenant_id)
          .executeTakeFirst();
        if (
          !organization ||
          organization.org_type !== 'STARTUP' ||
          organization.status !== 'ACTIVE'
        ) {
          throw new ForbiddenException('The startup workspace is not active');
        }

        const inserted = await tx
          .insertInto('bank_statement_imports')
          .values({
            tenant_id: actor.tenant_id,
            source_filename: sourceFilename,
            statement_format: 'CAMT.053',
            sha256_hash: sha256,
            imported_by_user_id: actor.user_id,
            transaction_count: transactions.length,
          })
          .returning(['id', 'status', 'created_at'])
          .executeTakeFirstOrThrow();
        await tx
          .insertInto('bank_statement_transactions')
          .values(
            transactions.map((transaction) => ({
              tenant_id: actor.tenant_id,
              import_id: inserted.id,
              booking_date: transaction.booking_date,
              amount: transaction.amount,
              currency: transaction.currency,
              direction: transaction.direction,
              bank_reference: transaction.bank_reference,
              remittance: transaction.remittance,
            })),
          )
          .execute();
        await this.auditLog.appendAuditLog(tx, {
          tenant_id: actor.tenant_id,
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'BANK_STATEMENT_IMPORTED',
          entity_type: 'bank_statement_import',
          entity_id: inserted.id,
          after_state: {
            source_filename: sourceFilename,
            statement_format: 'CAMT.053',
            transaction_count: transactions.length,
            status: inserted.status,
          },
        });
        return {
          import_id: inserted.id,
          status: inserted.status,
          transaction_count: transactions.length,
          created_at: inserted.created_at,
          journal_entries_created: 0,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This statement has already been imported into this workspace');
      }
      throw error;
    }
  }

  async listImports(actor: AuthUserContext) {
    this.assertStartupFinance(actor);
    return this.tenantContext.withTenantContext(actor.tenant_id, (tx) =>
      tx
        .selectFrom('bank_statement_imports')
        .select([
          'id',
          'source_filename',
          'statement_format',
          'status',
          'transaction_count',
          'created_at',
        ])
        .orderBy('created_at', 'desc')
        .limit(100)
        .execute(),
    );
  }

  async getImport(actor: AuthUserContext, importId: string) {
    this.assertStartupFinance(actor);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(importId)
    ) {
      throw new BadRequestException('A valid import ID is required');
    }
    return this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const statementImport = await tx
        .selectFrom('bank_statement_imports')
        .select([
          'id',
          'source_filename',
          'statement_format',
          'status',
          'transaction_count',
          'created_at',
        ])
        .where('id', '=', importId)
        .executeTakeFirst();
      if (!statementImport) throw new NotFoundException('Statement import not found');
      const transactions = await tx
        .selectFrom('bank_statement_transactions')
        .select([
          'id',
          'booking_date',
          'amount',
          'currency',
          'direction',
          'bank_reference',
          'remittance',
          'review_status',
        ])
        .where('import_id', '=', importId)
        .orderBy('booking_date')
        .orderBy('id')
        .execute();
      return { ...statementImport, transactions, journal_entries_created: 0 };
    });
  }

  private assertStartupFinance(actor: AuthUserContext): void {
    if (actor.org_type !== 'STARTUP' || (actor.role !== 'FIN' && actor.role !== 'FDR')) {
      throw new ForbiddenException('Only startup finance leads and founders can review imports');
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
