/**
 * Monetary values must always be represented as decimal strings in TypeScript/JSON
 * and NUMERIC in PostgreSQL — never IEEE-754 floating-point numbers.
 */
export type DecimalString = string;

export * from './decimal';
export * from './grant-status.enum';
export * from './grant-milestone-status.enum';
export * from './grant-budget-status.enum';
export * from './grant-application-status.enum';

export interface StructuredLogContext {
  request_id: string;
  tenant_id: string | null;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  checks: {
    postgres: 'up' | 'down';
  };
}

const DECIMAL_STRING_REGEX = /^-?\d+(?:\.\d+)?$/;

export function isValidDecimalString(value: string): boolean {
  return DECIMAL_STRING_REGEX.test(value);
}

// ============================================================================
// SECURITY & RBAC DOMAIN TYPES
// ============================================================================

export type OrgType = 'STARTUP' | 'INSTITUTION' | 'PLATFORM';
export type OrgStatus = 'ACTIVE' | 'SUSPENDED';

export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

/**
 * Seven canonical roles from the persona key and RBAC specification
 */
export const ROLES = ['FDR', 'FIN', 'OPS', 'PM', 'REV', 'APR', 'ADM'] as const;
export type Role = (typeof ROLES)[number];

export const STARTUP_ROLES: ReadonlySet<Role> = new Set(['FDR', 'FIN', 'OPS']);
export const INSTITUTION_ROLES: ReadonlySet<Role> = new Set(['PM', 'REV', 'APR']);
export const PLATFORM_ROLES: ReadonlySet<Role> = new Set(['ADM']);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isOrgType(value: unknown): value is OrgType {
  return value === 'STARTUP' || value === 'INSTITUTION' || value === 'PLATFORM';
}

export function isStartupRole(role: Role): boolean {
  return STARTUP_ROLES.has(role);
}

export function isInstitutionRole(role: Role): boolean {
  return INSTITUTION_ROLES.has(role);
}

export function isPlatformRole(role: Role): boolean {
  return PLATFORM_ROLES.has(role);
}

export function isRoleCompatibleWithOrg(role: Role, orgType: OrgType): boolean {
  return (
    (orgType === 'STARTUP' && isStartupRole(role)) ||
    (orgType === 'INSTITUTION' && isInstitutionRole(role)) ||
    (orgType === 'PLATFORM' && isPlatformRole(role))
  );
}

export type ActorType = 'USER' | 'SYSTEM' | 'API_KEY';

export interface AuthUserContext {
  user_id: string;
  email: string;
  tenant_id: string;
  role: Role;
  org_type: OrgType;
  mfa_verified?: boolean;
}

export interface AuthTokenPayload {
  sub: string; // user_id
  email: string;
  tenant_id: string;
  role: Role;
  org_type: OrgType;
  mfa_verified?: boolean;
  iat?: number;
  exp?: number;
}

export interface AuditLogInput {
  tenant_id: string;
  actor_id?: string | null;
  actor_type: ActorType;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  ip?: string | null;
  user_agent?: string | null;
}

export interface AuditChainVerificationResult {
  valid: boolean;
  checkedCount: number;
  brokenAtSeqNo?: number;
  reason?: string;
}

// ============================================================================
// MODULE A: STARTUP DOUBLE-ENTRY LEDGER TYPES & CONTRACTS
// ============================================================================

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type PeriodStatus = 'OPEN' | 'CLOSED';
export type JournalStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type JournalSource =
  'MANUAL' | 'SIMPLE_EXPENSE' | 'REVERSAL' | 'DISBURSEMENT' | 'BANK_IMPORT';

export interface AccountDto {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_subtype: string | null;
  is_contra: boolean;
  parent_id: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountingPeriodDto {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  status: PeriodStatus;
  closed_at: string | null;
  closed_by_user_id: string | null;
  created_at: string;
}

export interface JournalLineDto {
  id: string;
  journal_entry_id: string;
  line_order: number;
  account_id: string;
  account_code?: string;
  account_name?: string;
  debit: DecimalString;
  credit: DecimalString;
  currency: string;
  fx_rate: DecimalString;
  amount_functional: DecimalString;
  created_at: string;
}

export interface JournalEntryDto {
  id: string;
  tenant_id: string;
  entry_date: string;
  period_id: string;
  memo: string;
  status: JournalStatus;
  source: JournalSource;
  reverses_entry_id: string | null;
  created_by_user_id: string | null;
  posted_at: string | null;
  created_at: string;
  lines: JournalLineDto[];
}

export interface CreateJournalLineInput {
  account_id: string;
  debit?: DecimalString;
  credit?: DecimalString;
  currency?: string;
  fx_rate?: DecimalString;
}

export interface CreateJournalEntryInput {
  entry_date: string;
  memo: string;
  lines: CreateJournalLineInput[];
}

export interface RecordExpenseInput {
  entry_date: string;
  memo: string;
  expense_account_id: string;
  payment_account_id: string;
  amount: DecimalString;
  currency?: string;
  fx_rate?: DecimalString;
}

export interface GeneralLedgerLineDto {
  line_id: string;
  entry_id: string;
  entry_date: string;
  memo: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: DecimalString;
  credit: DecimalString;
  amount_functional: DecimalString;
  running_balance: DecimalString;
}

export interface TrialBalanceAccountDto {
  account_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  is_contra: boolean;
  total_debit: DecimalString;
  total_credit: DecimalString;
  net_balance: DecimalString; // positive = normal debit balance for assets/expenses
}

export interface TrialBalanceReportDto {
  as_of_date: string;
  accounts: TrialBalanceAccountDto[];
  total_debits: DecimalString;
  total_credits: DecimalString;
  is_balanced: boolean;
}

export interface ProfitAndLossReportDto {
  period_start: string;
  period_end: string;
  revenues: {
    accounts: Array<{ id: string; code: string; name: string; amount: DecimalString }>;
    total: DecimalString;
  };
  expenses: {
    accounts: Array<{ id: string; code: string; name: string; amount: DecimalString }>;
    total: DecimalString;
  };
  net_income: DecimalString;
}

export interface BalanceSheetReportDto {
  as_of_date: string;
  assets: {
    accounts: Array<{
      id: string;
      code: string;
      name: string;
      amount: DecimalString;
      is_contra: boolean;
    }>;
    total: DecimalString;
  };
  liabilities: {
    accounts: Array<{ id: string; code: string; name: string; amount: DecimalString }>;
    total: DecimalString;
  };
  equity: {
    accounts: Array<{ id: string; code: string; name: string; amount: DecimalString }>;
    net_income_current_period: DecimalString;
    total: DecimalString;
  };
  total_liabilities_and_equity: DecimalString;
  is_balanced: boolean;
}

export interface BurnAndRunwayReportDto {
  as_of_date: string;
  cash_on_hand: DecimalString;
  average_monthly_net_burn: DecimalString; // 3-month average
  runway_months: DecimalString; // "Infinity" if burn <= 0
  months_analyzed: number;
}
