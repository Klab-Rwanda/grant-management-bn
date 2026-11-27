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
  grant_budget_id: string | null;
  debit: Generated<string>;
  credit: Generated<string>;
  currency: Generated<string>;
  fx_rate: Generated<string>;
  amount_functional: string;
  created_at: Generated<string>;
}

export interface GrantProgramsTable {
  id: Generated<string>;
  tenant_id: string;
  title: string;
  description: string | null;
  total_pool_amount: string;
  currency: Generated<string>;
  funding_model: Generated<'ADVANCE' | 'REIMBURSEMENT'>;
  status: Generated<'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface GrantTermVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  grant_program_id: string;
  version_number: number;
  eligible_categories: unknown;
  caps_per_tranche: unknown;
  variance_tolerance_pct: string;
  effective_date: string;
  created_by_user_id: string | null;
  created_at: Generated<string>;
}

export interface GrantsTable {
  id: Generated<string>;
  institution_tenant_id: string;
  startup_org_id: string;
  grant_program_id: string;
  term_version_id: string;
  title: string;
  awarded_amount: string;
  currency: Generated<string>;
  status: Generated<'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'CANCELLED'>;
  signed_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type TrancheReviewStatus =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'SUBMITTED_PENDING_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'VERIFIED_PENDING_APPROVAL'
  | 'APPROVED_FOR_DISBURSEMENT'
  | 'DISBURSED_AWAITING_EXPENSES'
  | 'DISBURSED_AND_RECONCILED'
  | 'CANCELLED';

export interface GrantAssignmentsTable {
  id: Generated<string>;
  grant_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  assignee_tenant_id: string;
  membership_id: string;
  assignment_role: Role;
  created_at: Generated<string>;
}

export interface TranchesTable {
  id: Generated<string>;
  grant_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  sequence_order: number;
  amount: string;
  currency: Generated<string>;
  availability_status: Generated<'LOCKED' | 'ACTIVE' | 'CLOSED'>;
  review_status: Generated<TrancheReviewStatus>;
  version: Generated<number>;
  unlocked_at: string | null;
  closed_at: string | null;
  created_at: Generated<string>;
}

export interface TrancheBudgetLinesTable {
  id: Generated<string>;
  tranche_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  category_code: string;
  category_name: string;
  cap_amount: string;
  cap_percentage: string | null;
  variance_tolerance_pct: string;
  created_at: Generated<string>;
}

export interface MilestonesTable {
  id: Generated<string>;
  tranche_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  code: string;
  title: string;
  due_date: string;
  completion_status: Generated<'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED'>;
  owner_user_id: string | null;
  deliverable_required: Generated<boolean>;
  created_at: Generated<string>;
}

export interface VendorsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  normalized_name: string;
  tax_id: string | null;
  country: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface EvidenceDocumentsTable {
  id: Generated<string>;
  tenant_id: string;
  storage_key: string;
  sha256: string | null;
  mime_type: string | null;
  declared_mime_type: string;
  size_bytes: string | number | bigint;
  uploader_user_id: string;
  doc_type: 'INVOICE' | 'RECEIPT' | 'BANK_WIRE_SLIP' | 'TAX_FILING' | 'DELIVERABLE' | 'OTHER';
  source_channel: 'WEB_UPLOAD' | 'MOBILE_PWA' | 'API';
  scan_status:
    | 'PENDING_UPLOAD'
    | 'PENDING_SCAN'
    | 'CLEAN'
    | 'INFECTED'
    | 'REJECTED_INVALID_FILE'
    | 'SCAN_FAILED';
  vendor_id: string | null;
  invoice_number: string | null;
  document_date: string | null;
  document_amount: string | null;
  document_currency: string | null;
  raw_ocr_payload: unknown | null;
  human_corrections_payload: unknown | null;
  duplicate_flag: Generated<'CLEAR' | 'POSSIBLE_DUPLICATE'>;
  created_at: Generated<string>;
  confirmed_at: string | null;
}

export interface JournalLineEvidenceTable {
  id: Generated<string>;
  tenant_id: string;
  journal_line_id: string;
  evidence_document_id: string;
  linked_by_user_id: string;
  created_at: Generated<string>;
}

export interface MilestoneEvidenceTable {
  id: Generated<string>;
  tenant_id: string;
  milestone_id: string;
  evidence_document_id: string;
  linked_by_user_id: string;
  created_at: Generated<string>;
}

export interface LineItemAllocationsTable {
  id: Generated<string>;
  tenant_id: string;
  journal_line_id: string;
  tranche_budget_line_id: string;
  allocated_amount: string;
  fx_rate_to_grant: string | null;
  converted_amount: string | null;
  status: Generated<'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DROPPED'>;
  locked_by_submission_id: string | null;
  created_by_user_id: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ReviewSubmissionsTable {
  id: Generated<string>;
  grant_id: string;
  tranche_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  version_number: number;
  idempotency_key: string;
  status: TrancheReviewStatus;
  total_allocated_amount: string;
  total_claimable_amount: string;
  milestone_snapshot: unknown;
  snapshot_hash: string;
  submitted_by_user_id: string;
  submitted_at: Generated<string>;
}

export interface SubmissionItemsTable {
  id: Generated<string>;
  submission_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  line_item_allocation_id: string;
  tranche_budget_line_id: string;
  category_code: string;
  category_name: string;
  allocated_amount: string;
  functional_amount: string | null;
  functional_currency: string | null;
  fx_rate_to_grant: string | null;
  transaction_date: string;
  vendor_name: string | null;
  vendor_tax_id: string | null;
  line_memo: string;
  evidence_snapshot: unknown;
  carried_forward_approval: Generated<boolean>;
  created_at: Generated<string>;
}

export interface SignaturesTable {
  id: Generated<string>;
  submission_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  signer_user_id: string;
  signer_role: Role;
  snapshot_hash: string;
  attestation_text_version: string;
  attestation_text_hash: string;
  ip: string | null;
  user_agent: string | null;
  reauth_verified_at: string;
  signed_at: Generated<string>;
}

export interface ReviewDecisionsTable {
  id: Generated<string>;
  submission_id: string;
  submission_item_id: string;
  line_item_allocation_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  decision: 'APPROVED' | 'REJECTED';
  reason_code: string | null;
  comment: string | null;
  decided_by_user_id: string;
  decided_at: Generated<string>;
}

export interface MilestoneDecisionsTable {
  id: Generated<string>;
  submission_id: string;
  milestone_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  decision: 'APPROVED' | 'REJECTED';
  reason_code: string | null;
  notes: string | null;
  decided_by_user_id: string;
  decided_at: Generated<string>;
}

export interface DisbursementsTable {
  id: Generated<string>;
  tranche_id: string;
  submission_id: string | null;
  institution_tenant_id: string;
  startup_org_id: string;
  authorized_amount: string;
  status: Generated<
    | 'AUTHORIZED'
    | 'RECORDED_BY_INSTITUTION'
    | 'CONFIRMED_BY_STARTUP'
    | 'PARTIAL'
    | 'PAYMENT_DISPUTED'
    | 'REVERSED'
    | 'RECONCILED'
  >;
  bank_reference: string | null;
  paid_date: string | null;
  amount_paid: string | null;
  net_received_amount: string | null;
  currency: Generated<string>;
  fx_rate: Generated<string>;
  fx_rate_source: string | null;
  fees: Generated<string>;
  confirmation_evidence_doc_id: string | null;
  recorded_by_user_id: string | null;
  confirmed_by_user_id: string | null;
  statement_line_id: string | null;
  linked_journal_entry_id: string | null;
  dispute_reason: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface UnlockRulesTable {
  id: Generated<string>;
  tranche_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  prerequisite_tranche_id: string | null;
  require_prev_disbursed_reconciled: boolean;
  prerequisite_milestone_id: string | null;
  require_milestone_verified: boolean;
  created_at: Generated<string>;
}

export interface Database {
  // Core tables
  organizations: OrganizationsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  audit_logs: AuditLogsTable;
  accounts: AccountsTable;
  accounting_periods: AccountingPeriodsTable;
  journal_entries: JournalEntriesTable;
  journal_lines: JournalLinesTable;

  grant_programs: GrantProgramsTable;
  grant_term_versions: GrantTermVersionsTable;
  grants: GrantsTable;
  grant_assignments: GrantAssignmentsTable;
  tranches: TranchesTable;
  tranche_budget_lines: TrancheBudgetLinesTable;
  milestones: MilestonesTable;
  vendors: VendorsTable;
  evidence_documents: EvidenceDocumentsTable;
  journal_line_evidence: JournalLineEvidenceTable;
  milestone_evidence: MilestoneEvidenceTable;
  line_item_allocations: LineItemAllocationsTable;
  review_submissions: ReviewSubmissionsTable;
  submission_items: SubmissionItemsTable;
  signatures: SignaturesTable;
  review_decisions: ReviewDecisionsTable;
  milestone_decisions: MilestoneDecisionsTable;
  disbursements: DisbursementsTable;
  unlock_rules: UnlockRulesTable;

  bank_statement_imports: {
    id: Generated<string>;
    tenant_id: string;
    source_filename: string;
    statement_format: 'CAMT.053';
    sha256_hash: string;
    status: Generated<'REVIEW_REQUIRED'>;
    imported_by_user_id: string;
    transaction_count: number;
    created_at: Generated<string>;
  };
  bank_statement_transactions: {
    id: Generated<string>;
    tenant_id: string;
    import_id: string;
    booking_date: string;
    amount: string;
    currency: string;
    direction: 'CREDIT' | 'DEBIT';
    bank_reference: string | null;
    remittance: string | null;
    review_status: Generated<'PENDING'>;
    created_at: Generated<string>;
  };
}
