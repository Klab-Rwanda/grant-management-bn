import {
  AccountType,
  ActorType,
  JournalSource,
  JournalStatus,
  MembershipStatus,
  OrgStatus,
  OrgType,
  PeriodStatus,
  Role,
  UserStatus,
} from '@grant-ledger/shared';
import { Generated } from 'kysely';

export interface OrganizationsTable {
  id: Generated<string>;
  legal_name: string;
  tax_id: string | null;
  org_type: OrgType;
  country: string;
  functional_currency: Generated<string>;
  books_closed_through: string | null;
  fiscal_year_start_month: Generated<number>;
  status: Generated<OrgStatus>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  password_hash: string | null;
  mfa_enabled: Generated<boolean>;
  mfa_secret_ref: string | null;
  sso_provider: string | null;
  sso_subject: string | null;
  status: Generated<UserStatus>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface MembershipsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  role: Role;
  scope_metadata: Generated<unknown>;
  status: Generated<MembershipStatus>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface InvitationsTable {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  role: Role;
  token_hash: string;
  invited_by_user_id: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: Generated<string>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  tenant_id: string;
  seq_no: string | number | bigint;
  actor_id: string | null;
  actor_type: ActorType;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: unknown | null;
  after_state: unknown | null;
  ip: string | null;
  user_agent: string | null;
  prev_hash: string;
  hash: string;
  created_at: Generated<string>;
}

export interface AccountsTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_subtype: string | null;
  is_contra: Generated<boolean>;
  parent_id: string | null;
  is_archived: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AccountingPeriodsTable {
  id: Generated<string>;
  tenant_id: string;
  period_start: string;
  period_end: string;
  status: Generated<PeriodStatus>;
  closed_at: string | null;
  closed_by_user_id: string | null;
  created_at: Generated<string>;
}

export interface JournalEntriesTable {
  id: Generated<string>;
  tenant_id: string;
  entry_date: string;
  period_id: string;
  memo: string;
  status: Generated<JournalStatus>;
  source: Generated<JournalSource>;
  reverses_entry_id: string | null;
  created_by_user_id: string | null;
  posted_at: string | null;
  created_at: Generated<string>;
}

export interface JournalLinesTable {
  id: Generated<string>;
  tenant_id: string;
  journal_entry_id: string;
  line_order: number;
  account_id: string;
  debit: Generated<string>;
  credit: Generated<string>;
  currency: Generated<string>;
  fx_rate: Generated<string>;
  amount_functional: string;
  created_at: Generated<string>;
}

export interface Database {
  organizations: OrganizationsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  audit_logs: AuditLogsTable;
  accounts: AccountsTable;
  accounting_periods: AccountingPeriodsTable;
  journal_entries: JournalEntriesTable;
  journal_lines: JournalLinesTable;
}
