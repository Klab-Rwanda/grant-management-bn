import { AccountDto, AccountType } from '@grant-ledger/shared';
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

export interface CreateAccountInput {
  code: string;
  name: string;
  account_type: AccountType;
  account_subtype?: string | null;
  is_contra?: boolean;
  parent_id?: string | null;
}

export interface UpdateAccountInput {
  name?: string;
  code?: string;
  account_type?: AccountType;
  account_subtype?: string | null;
  is_contra?: boolean;
  parent_id?: string | null;
  is_archived?: boolean;
}

interface TemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  isContra?: boolean;
  parentCode?: string;
}

const TECH_STARTUP_TEMPLATE: TemplateAccount[] = [
  // 1000 Assets
  { code: '1000', name: 'Assets', type: 'ASSET' },
  {
    code: '1010',
    name: 'Operating bank account',
    type: 'ASSET',
    subtype: 'CASH_AND_BANK',
    parentCode: '1000',
  },
  {
    code: '1020',
    name: 'Mobile money float',
    type: 'ASSET',
    subtype: 'CASH_AND_BANK',
    parentCode: '1000',
  },
  {
    code: '1030',
    name: 'Savings & deposit account',
    type: 'ASSET',
    subtype: 'CASH_AND_BANK',
    parentCode: '1000',
  },
  { code: '1040', name: 'Petty cash', type: 'ASSET', subtype: 'CASH_AND_BANK', parentCode: '1000' },
  { code: '1200', name: 'Accounts receivable', type: 'ASSET', parentCode: '1000' },
  {
    code: '1210',
    name: 'Allowance for doubtful accounts',
    type: 'ASSET',
    isContra: true,
    parentCode: '1000',
  },
  { code: '1300', name: 'Prepaid expenses', type: 'ASSET', parentCode: '1000' },
  { code: '1400', name: 'Security deposits', type: 'ASSET', parentCode: '1000' },
  { code: '1500', name: 'Equipment', type: 'ASSET', parentCode: '1000' },
  { code: '1510', name: 'Computer hardware', type: 'ASSET', parentCode: '1000' },
  {
    code: '1590',
    name: 'Accumulated depreciation',
    type: 'ASSET',
    isContra: true,
    parentCode: '1000',
  },
  { code: '1600', name: 'Intangible assets & patents', type: 'ASSET', parentCode: '1000' },

  // 2000 Liabilities
  { code: '2000', name: 'Liabilities', type: 'LIABILITY' },
  { code: '2100', name: 'Accounts payable', type: 'LIABILITY', parentCode: '2000' },
  { code: '2110', name: 'Accrued liabilities', type: 'LIABILITY', parentCode: '2000' },
  { code: '2200', name: 'Payroll taxes payable', type: 'LIABILITY', parentCode: '2000' },
  { code: '2210', name: 'Income tax payable', type: 'LIABILITY', parentCode: '2000' },
  { code: '2300', name: 'Credit card payable', type: 'LIABILITY', parentCode: '2000' },
  {
    code: '2400',
    name: 'Deferred grant income',
    type: 'LIABILITY',
    subtype: 'DEFERRED_GRANT_INCOME',
    parentCode: '2000',
  },
  { code: '2410', name: 'Deferred customer revenue', type: 'LIABILITY', parentCode: '2000' },
  { code: '2500', name: 'Convertible notes', type: 'LIABILITY', parentCode: '2000' },
  { code: '2600', name: 'Venture debt & bank loans', type: 'LIABILITY', parentCode: '2000' },

  // 3000 Equity
  { code: '3000', name: 'Equity', type: 'EQUITY' },
  { code: '3100', name: 'Common stock', type: 'EQUITY', parentCode: '3000' },
  { code: '3200', name: 'Additional paid-in capital', type: 'EQUITY', parentCode: '3000' },
  { code: '3300', name: 'Retained earnings', type: 'EQUITY', parentCode: '3000' },
  { code: '3400', name: 'SAFE notes', type: 'EQUITY', parentCode: '3000' },

  // 4000 Revenue
  { code: '4000', name: 'Revenue', type: 'REVENUE' },
  { code: '4100', name: 'Subscription revenue', type: 'REVENUE', parentCode: '4000' },
  { code: '4200', name: 'Services revenue', type: 'REVENUE', parentCode: '4000' },
  { code: '4900', name: 'Grant revenue', type: 'REVENUE', parentCode: '4000' },
  { code: '4950', name: 'Interest income', type: 'REVENUE', parentCode: '4000' },

  // 6000 Expenses
  { code: '6000', name: 'Expenses', type: 'EXPENSE' },
  { code: '6010', name: 'R&D Personnel', type: 'EXPENSE', parentCode: '6000' },
  { code: '6020', name: 'Employee benefits & taxes', type: 'EXPENSE', parentCode: '6000' },
  { code: '6100', name: 'Cloud Infrastructure', type: 'EXPENSE', parentCode: '6000' },
  { code: '6200', name: 'Contractors', type: 'EXPENSE', parentCode: '6000' },
  { code: '6300', name: 'Marketing & Sales', type: 'EXPENSE', parentCode: '6000' },
  { code: '6400', name: 'General & Administrative', type: 'EXPENSE', parentCode: '6000' },
  { code: '6500', name: 'Travel & Entertainment', type: 'EXPENSE', parentCode: '6000' },
  { code: '6600', name: 'Legal & Professional Fees', type: 'EXPENSE', parentCode: '6000' },
  { code: '6700', name: 'Rent & Utilities', type: 'EXPENSE', parentCode: '6000' },
  { code: '6800', name: 'Depreciation Expense', type: 'EXPENSE', parentCode: '6000' },
  { code: '6900', name: 'Bank & Wire Fees', type: 'EXPENSE', parentCode: '6000' },
];

@Injectable()
export class ChartOfAccountsService {
  constructor(
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  async seedTechStartupTemplate(
    tenantId: string,
    actorId?: string,
  ): Promise<{ seeded_count: number; message: string }> {
    const res = await this.seedTemplate(tenantId, actorId);
    return {
      seeded_count: res.count,
      message:
        res.count > 0
          ? 'Tech startup chart of accounts seeded successfully'
          : 'Chart of accounts already initialized',
    };
  }

  async seedTemplate(tenantId: string, actorId?: string): Promise<{ count: number }> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const existing = await tx
        .selectFrom('accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .limit(1)
        .executeTakeFirst();

      if (existing) {
        return { count: 0 };
      }

      const codeToId = new Map<string, string>();

      // 1. Insert header/root accounts first
      for (const item of TECH_STARTUP_TEMPLATE.filter((t) => !t.parentCode)) {
        const inserted = await tx
          .insertInto('accounts')
          .values({
            tenant_id: tenantId,
            code: item.code,
            name: item.name,
            account_type: item.type,
            account_subtype: item.subtype ?? null,
            is_contra: item.isContra ?? false,
          })
          .returning(['id', 'code'])
          .executeTakeFirstOrThrow();
        codeToId.set(inserted.code, inserted.id);
      }

      // 2. Insert child accounts with resolved parent_id
      for (const item of TECH_STARTUP_TEMPLATE.filter((t) => t.parentCode)) {
        const parentId = item.parentCode ? (codeToId.get(item.parentCode) ?? null) : null;
        const inserted = await tx
          .insertInto('accounts')
          .values({
            tenant_id: tenantId,
            code: item.code,
            name: item.name,
            account_type: item.type,
            account_subtype: item.subtype ?? null,
            is_contra: item.isContra ?? false,
            parent_id: parentId,
          })
          .returning(['id', 'code'])
          .executeTakeFirstOrThrow();
        codeToId.set(inserted.code, inserted.id);
      }

      await this.auditLogService.append(tx, {
        tenant_id: tenantId,
        actor_id: actorId ?? null,
        actor_type: actorId ? 'USER' : 'SYSTEM',
        action: 'CHART_OF_ACCOUNTS_SEEDED',
        entity_type: 'ChartOfAccounts',
        after_state: { template: 'Technology & growth startup', accounts_created: codeToId.size },
      });

      return { count: codeToId.size };
    });
  }

  async listAccounts(tenantId: string, includeArchived = false): Promise<AccountDto[]> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      let query = tx.selectFrom('accounts').selectAll().where('tenant_id', '=', tenantId);

      if (!includeArchived) {
        query = query.where('is_archived', '=', false);
      }

      const rows = await query.orderBy('code', 'asc').execute();
      return rows as AccountDto[];
    });
  }

  async getAccountById(tenantId: string, id: string): Promise<AccountDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const row = await tx
        .selectFrom('accounts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!row) {
        throw new NotFoundException(`Account with ID '${id}' not found`);
      }

      return row as AccountDto;
    });
  }

  async createAccount(
    tenantId: string,
    input: CreateAccountInput,
    actorId?: string,
  ): Promise<AccountDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const existing = await tx
        .selectFrom('accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('code', '=', input.code.trim())
        .executeTakeFirst();

      if (existing) {
        throw new ConflictException(`Account code '${input.code}' already exists`);
      }

      if (input.parent_id) {
        const parent = await tx
          .selectFrom('accounts')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', input.parent_id)
          .executeTakeFirst();
        if (!parent) {
          throw new BadRequestException(`Parent account '${input.parent_id}' does not exist`);
        }
      }

      const inserted = await tx
        .insertInto('accounts')
        .values({
          tenant_id: tenantId,
          code: input.code.trim(),
          name: input.name.trim(),
          account_type: input.account_type,
          account_subtype: input.account_subtype ?? null,
          is_contra: input.is_contra ?? false,
          parent_id: input.parent_id ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.auditLogService.append(tx, {
        tenant_id: tenantId,
        actor_id: actorId ?? null,
        actor_type: actorId ? 'USER' : 'SYSTEM',
        action: 'ACCOUNT_CREATED',
        entity_type: 'Account',
        entity_id: inserted.id,
        after_state: inserted,
      });

      return inserted as AccountDto;
    });
  }

  async updateAccount(
    tenantId: string,
    accountId: string,
    input: UpdateAccountInput,
    actorId?: string,
  ): Promise<AccountDto> {
    return await this.tenantContext.withTenantContext(tenantId, async (tx) => {
      const current = await tx
        .selectFrom('accounts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', accountId)
        .executeTakeFirst();

      if (!current) {
        throw new NotFoundException(`Account with ID '${accountId}' not found`);
      }

      // Check if posted journal lines exist for this account
      const hasPostedLines = await tx
        .selectFrom('journal_lines as jl')
        .innerJoin('journal_entries as je', 'je.id', 'jl.journal_entry_id')
        .select(['jl.id'])
        .where('jl.tenant_id', '=', tenantId)
        .where('jl.account_id', '=', accountId)
        .where('je.status', 'in', ['POSTED', 'REVERSED'])
        .limit(1)
        .executeTakeFirst();

      if (hasPostedLines) {
        if (
          (input.code && input.code !== current.code) ||
          (input.account_type && input.account_type !== current.account_type) ||
          (input.is_contra !== undefined && input.is_contra !== current.is_contra)
        ) {
          throw new ConflictException(
            'Code and type are locked. This account has posted entries. You can archive it, but you cannot delete it or change its type.',
          );
        }
      }

      const updated = await tx
        .updateTable('accounts')
        .set({
          name: input.name?.trim() ?? current.name,
          code: input.code?.trim() ?? current.code,
          account_type: input.account_type ?? current.account_type,
          account_subtype:
            input.account_subtype !== undefined ? input.account_subtype : current.account_subtype,
          is_contra: input.is_contra !== undefined ? input.is_contra : current.is_contra,
          parent_id: input.parent_id !== undefined ? input.parent_id : current.parent_id,
          is_archived: input.is_archived !== undefined ? input.is_archived : current.is_archived,
          updated_at: sql`now()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', accountId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.auditLogService.append(tx, {
        tenant_id: tenantId,
        actor_id: actorId ?? null,
        actor_type: actorId ? 'USER' : 'SYSTEM',
        action: 'ACCOUNT_UPDATED',
        entity_type: 'Account',
        entity_id: accountId,
        before_state: current,
        after_state: updated,
      });

      return updated as AccountDto;
    });
  }

  async archiveAccount(tenantId: string, accountId: string, actorId?: string): Promise<AccountDto> {
    return await this.updateAccount(tenantId, accountId, { is_archived: true }, actorId);
  }
}
