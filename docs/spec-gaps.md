# Specification Gap & Pre-Code Audit (`Grant Ledger`)

> **Scope & Sources Audited:** At audit time, the workspace contained no `docs/` directory (`docs/architecture.md`, `docs/decisions.md`, or `docs/screens/`). This audit is grounded strictly in the provided Product Architecture specification, the 3 schema/RBAC reference images, and the 3 Figma handoff screenshots (Canvas Overview, Startup Dashboard, and Chart of Accounts `A-01`).

---

## Known Concerns Verification Summary

| #   | Concern                                                                      | Verdict                   | Evidence & Impact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The ledger table has a single debit/credit pair instead of journal lines** | **REAL**                  | `LedgerTransactions` defines single-row columns `(id, startup_org_id, transaction_date, amount, debit_account, credit_account)`. It cannot represent compound/split journal entries (e.g., payroll with gross wage, tax withholding, and net bank cash; split vendor bills; or VAT/sales tax). `ChartOfAccounts` is also absent from the 12-table Core Data Model.                                                                                                                                                                                                                                                          |
| 2   | **There is no `Disbursements` table**                                        | **REAL**                  | The 12-table Core Data Model ends at `AuditLogs` with no table for Stage 6/7 off-platform payouts (`payment_reference_number`, `transfer_execution_date`, `disbursed_amount`, `fx_rate`, bank confirmation attachment FK, or Committee Approver sign-off).                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | **A user can have only one org and one role**                                | **REAL**                  | `Users & Memberships` puts `org_id (FK)` and `role (RBAC Enum)` directly on the user record, contradicting its own note (_"Many-to-Many via workspace scopes"_) and blocking fractional CFOs/advisors, multi-program institutional users, and program-scoped `PM` assignments (_"Review access to assigned startups"_).                                                                                                                                                                                                                                                                                                     |
| 4   | **Institution reviewers cannot read startup rows under tenant-scoped RLS**   | **REAL**                  | The architecture specifies strict PostgreSQL RLS using `app.current_tenant_id`. Because `Grants`, `Tranches`, `Milestones`, `LineItemAllocations`, and linked `EvidenceDocuments` belong to or cross-reference `startup_org_id`, single-tenant RLS blocks `PM`, `REV`, and `APR` users—and also blocks cross-tenant `sha256_hash` duplicate detection.                                                                                                                                                                                                                                                                      |
| 5   | **No accounting periods**                                                    | **REAL**                  | Neither the text nor the schema models fiscal/accounting periods or closing dates. However, the Figma Startup Dashboard explicitly displays `"Books closed through 31 Oct 2026 · Functional currency USD"`, and Module A (`P&L`, `Balance Sheet`, `Trial Balance`) requires period-close immutability.                                                                                                                                                                                                                                                                                                                      |
| 6   | **Grant categories are mapped per account instead of per program**           | **REAL (with UI nuance)** | The Core Data Model has **no** `GrantCategories` or `TrancheBudgetLines` table (`LineItemAllocations` only stores `tranche_id` and `allocated_amount`). Meanwhile, Figma `A-01` (Chart of Accounts) adds a `Default grant category` dropdown on each CoA account (_"Suggested when tagging entries from this account"_). Storing categories on a startup's CoA breaks when a startup has multiple grants with different donor category taxonomies and cannot enforce per-tranche % or monetary caps. CoA mapping can only be a UI default hint; canonical categories must belong to `GrantPrograms` / `TrancheBudgetLines`. |
| 7   | **Milestone verification has no decision record**                            | **REAL**                  | `Milestones` only tracks `(id, tranche_id, title, due_date, completion_status)`, and `ReviewDecisions` links strictly to `LineItemAllocations` via `line_item_id (FK)`. There is no `MilestoneDecisions` table or `milestone_id` FK to record who verified/rejected a milestone, when, on which submission, or with what reason code.                                                                                                                                                                                                                                                                                       |
| 8   | **The `APR` committee gate was missing from the original lifecycle**         | **RESOLVED**              | The confirmed flow inserts `APR` authorization after `REV` verification and before off-platform payment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## a. Contradictions Between Sections

### 1. Conflicting Status Names & Undefined Enums Across Spec & UI

- **Tranche / Submission Status Drift:**
  - **Stage 4–8 Lifecycle:** Uses `DRAFT`, `SUBMITTED_PENDING_REVIEW`, `CHANGES_REQUESTED`, `APPROVED_FOR_DISBURSEMENT`, `DISBURSED_AND_RECONCILED`, `ACTIVE`, and `TRANCHE_N+1`.
  - **Phase 1 Roadmap:** Uses `DRAFT -> SUBMITTED -> APPROVED / REJECTED -> DISBURSED`.
  - **Figma Dashboard:** Uses `Disbursed & reconciled`, `Active · Draft`, and `Locked` (flagged on the Overview canvas as an **"Assumption"** because `LOCKED` is implied by Stage 8 unlocking `TRANCHE_N+1` but never defined as an explicit initial state).
- **Line Item / Review Decision Status Drift:**
  - `AuditLogs` JSON example uses `PENDING` and `REJECTED` (with `reason_code: "INVALID_RECEIPT"`), while Stage 5 refers to `Line Item Approved` / `Line Item Rejected`.
- **Undefined Enums in Schema:**
  - `Grants.status`, `Tranches.status`, `Milestones.completion_status`, `LineItemAllocations.status`, `ReviewSubmissions.status`, and `ReviewDecisions.decision` have no canonical enum lists in the schema.
- **Merged Availability vs. Review State:**
  - `Tranches.status` is forced to represent both tranche availability (`LOCKED`, `ACTIVE`) and review progress (`DRAFT`, `SUBMITTED_PENDING_REVIEW`, `APPROVED_FOR_DISBURSEMENT`, `DISBURSED_AND_RECONCILED`), making multi-round resubmissions (`ReviewSubmissions` v1, v2) ambiguous.

### 2. Personas Present in One Section but Missing or Contradictory in Another

- **`Committee Approver (APR)`:** Resolved in the confirmed lifecycle: `APR` authorizes disbursement after `REV` verification and before payment.
- **`Finance Officer` (Institution):** The Finance Officer from the original Stage 7 text is mapped to `PM` for payout recording; startup `FIN` or `FDR` separately confirms receipt. No eighth persona is added.
- **`Operations Lead (OPS)`:** Stage 2 now covers startup execution; `OPS` responsibilities remain the documented activity logging and milestone-deliverable uploads, with read-only ledger access.
- **`Ecosystem Admin (ADM)`:** Defined in the RBAC table and Figma (`X-01`–`X-05`), but absent from `Users & Memberships` org types (`Organizations.org_type` only lists `STARTUP, INSTITUTION`) and the Lifecycle.
- **`Founder / CEO (FDR)` vs. `Finance Lead (FIN)` Submission Authority:** Resolved for this lifecycle: `FIN` prepares submissions and runs readiness checks; `FDR` provides final attestation and submits.
- **Grant application permissions:** The RBAC matrix does not identify who submits or reviews grant applications. The current API assigns application creation to `PM` and `ADM`, so applicant and review permissions need an explicit decision before this endpoint can be aligned.

### 3. Structural Contradictions in Data, Security & Rules

- **1:1 User vs. Many-to-Many Workspace Scope:** `Users & Memberships` puts `org_id` and `role` on the `Users` entity despite describing it as _"Many-to-Many via workspace scopes"_.
- **`AuditLogs` Schema vs. JSON Payload:** The schema table lists `(id, tenant_id, actor_id, action, entity_type, before_state, after_state)` without `timestamp`, `entity_id`, `ip_address`, or `user_agent`, whereas the JSON example includes `audit_id`, `timestamp`, `entity_id`, `ip_address`, `user_agent`, and wraps state under `changes: { before, after }`.
- **Strict Single-Tenant RLS vs. Cross-Tenant Sharing & Duplicate Checks:** `app.current_tenant_id` isolation contradicts shared institutional review access and global cross-tenant SHA-256 duplicate detection.
- **Shared grant API scope:** Grant records are documented as shared between an institution and a startup, but the current grant tables and service filter on one `tenant_id`. Endpoint role checks alone do not provide safe cross-tenant access; dual-party ownership and RLS are needed before either tenant can read the other's grant rows.
- **Program creation by `ADM`:** The persona matrix allows `ADM` to write grant program configuration, but the current grant-creation endpoint assigns rows to the caller's tenant and has no institution-tenant target. It is restricted to `PM` until platform-to-institution scoping is modeled.
- **Budget Caps vs. Variance Tolerance:** Stage 1 states tranches have _"maximum budget variance tolerances"_, while Module B states _"Tranche 1 allows up to 60% for R&D Personnel..."_ and the Figma Dashboard **blocks** submission (`Blocked` / `3 readiness issues`) when `Equipment` is `$13,880 / $12,500` over cap. It is unclear whether variance tolerances are supported or hard caps always apply.
- **Advance vs. Reimbursement Flow:** Resolved for this lifecycle as reimbursement-only. The accounting treatment for `2400 Deferred grant income` and grant revenue recognition remains open under Decision 2.
- **Expense-Only Tagging vs. CapEx Asset Tagging:** Text refers to _"grant-tagged expenses"_, whereas the Figma Dashboard tags `1500 Equipment` (an **Asset** account) to `T2 · Equipment` alongside `6010 R&D Personnel` (an **Expense** account).

---

## b. Missing Tables or Columns Needed for Every Screen & Lifecycle Step

### Missing Columns on Existing Tables

1. **`Organizations`:** `functional_currency` (ISO 4217), `books_closed_through` (date), `fiscal_year_start_month`, `status` (active/suspended), `platform_org` or allow `PLATFORM` in `org_type`.
2. **`Grants`:** `grant_name` / `reference_code`, `funding_model` (if configurable per grant), `currency`, `agreement_document_id` (FK), `signed_at`, `start_date`, `end_date`.
3. **`GrantPrograms`:** `description`, `status`, `funding_model`, `default_sla_hours` (review & remediation SLAs).
4. **`Tranches`:** `availability_status` (`LOCKED`, `ACTIVE`, `COMPLETED`, `CANCELLED`), `review_status` (separate from availability), `currency`, `variance_tolerance_pct` (if allowed), `unlocked_at`.
5. **`Milestones`:** `description`, `owner_user_id` (FK — needed for `"owner: Joel K."`), `sequence_order`, `is_required_for_unlock`, `deliverable_required`.
6. **`LineItemAllocations`:** `tranche_budget_line_id` (FK to category cap), `currency`, `fx_rate_to_tranche`, `converted_amount`, `locked_by_submission_id` (FK), `notes`.
7. **`EvidenceDocuments`:** `original_filename`, `mime_type`, `byte_size`, `uploaded_by_user_id` (FK), `uploaded_at`, `ocr_status` (`PENDING`, `PARSED_NEEDS_CONFIRMATION`, `CONFIRMED`, `FAILED`), `ocr_confirmed_by_user_id`, `ocr_confirmed_at`, `extracted_vendor`, `extracted_date`, `extracted_currency`, `extracted_total_amount`, `duplicate_flag_status`.
8. **`ReviewSubmissions`:** `submission_version` (integer), `attested_by_user_id` (FK), `attestation_statement`, `attested_at`, `attestation_ip`, `total_claimed_amount`, `total_approved_amount`, `sla_due_at`.
9. **`ReviewDecisions`:** `submission_item_id` (FK to frozen snapshot), `decided_by_user_id` (FK), `decided_at`, `comment`.
10. **`AuditLogs`:** `created_at` (`timestamp`), `entity_id` (UUID), `ip_address`, `user_agent`, `request_id`, `prev_entry_hash` / `entry_hash` (if cryptographic chaining is desired).

### Missing Tables Required by Architecture & Figma Screens

1. **`Users` & `OrganizationMemberships` (split):** Separate global identity (`Users`) from tenant membership (`OrganizationMemberships`: `user_id`, `org_id`, `role`, `status`, `invited_by`, `joined_at`) plus **`ProgramAssignments`** (scoping `PM`/`REV`/`APR` to assigned programs/grants) and **`Invitations`** (`G-03` invite token, expiry, role).
2. **`ChartOfAccounts`:** `id`, `startup_org_id`, `code`, `name`, `account_type` (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`), `account_subtype` (e.g., `CASH_AND_BANK`, `DEFERRED_GRANT_INCOME`), `is_contra`, `parent_account_id`, `default_grant_category_name` (optional UI hint), `is_archived`, `template_source`.
3. **`JournalEntries` & `JournalLines` (replacing single-row `LedgerTransactions`):** Supports multi-leg double-entry, `entry_number`, `entry_date`, `memo`, `status` (`DRAFT`, `POSTED`, `VOIDED` / reversing link), `currency`, `source_type` (`MANUAL`, `DISBURSEMENT_AUTO`, `BANK_IMPORT`), `created_by_user_id`, and line-level `account_id`, `debit_minor_units`, `credit_minor_units`, `is_grant_taggable`.
4. **`AccountingPeriods`:** `id`, `startup_org_id`, `period_start`, `period_end`, `status` (`OPEN`, `CLOSED`), `closed_by_user_id`, `closed_at`.
5. **`GrantCategories` & `TrancheBudgetLines`:** Program-scoped eligible categories (`R&D Personnel`, `Equipment`, `Contractors`, etc.) and per-tranche allocation caps (`max_amount` or `max_percentage`, `variance_tolerance`).
6. **`TrancheUnlockConditions`:** Declarative prerequisite rules (`prerequisite_tranche_id`, `requires_disbursed_reconciled`, `prerequisite_milestone_id`, `requires_milestone_verified`).
7. **`OperationalActivities`:** Supports Module A operational logging, `Operations Lead (OPS)` persona, and Figma `Activity log` (`id`, `startup_org_id`, `title`, `description`, `activity_date`, `actor_user_id`, `linked_journal_entry_id`, `linked_milestone_id`).
8. **`AllocationEvidence` & `MilestoneEvidence`:** Explicit join tables implementing the Many-to-Many links between `EvidenceDocuments` and `LineItemAllocations` / `Milestones`.
9. **`ReviewSubmissionItems`:** Immutable snapshot rows created at submission time (`submission_id`, `line_item_allocation_id`, `frozen_amount`, `frozen_category_id`, `frozen_journal_snapshot` JSONB, `frozen_evidence_hashes` JSONB, `carried_forward_from_decision_id`).
10. **`MilestoneDecisions`:** Verification outcomes per milestone (`submission_id`, `milestone_id`, `decision`, `reason_code`, `decided_by_user_id`, `decided_at`, `notes`).
11. **`Disbursements`:** Stage 6 Committee Approver sign-off + Stage 7 off-platform reconciliation (`tranche_id`, `submission_id`, `committee_approved_by_user_id`, `committee_approved_at`, `gross_authorized_amount`, `net_disbursed_amount`, `bank_fee_amount`, `currency`, `fx_rate`, `payment_reference_number`, `disbursed_at`, `bank_confirmation_doc_id`, `reconciled_by_user_id`, `reconciled_at`, `linked_journal_entry_id`, `status`).
12. **`DiscussionThreads` & `Comments`:** Contextual inline threads anchored to `LineItemAllocation`, `Milestone`, or `EvidenceDocument` (Module E).
13. **`SlaRules`, `SlaEvents` & `Notifications`:** Configurable SLA timers, escalation tracking, in-app notification badge state, and Twilio/SendGrid delivery logs (Module E).
14. **`DocumentFingerprints`:** Isolated global SHA-256 hash registry (`sha256_hash`, `first_seen_org_id`, `first_seen_document_id`, `created_at`) for privacy-safe cross-tenant duplicate detection.
15. **Phase 3 Tables (not needed for P1 MVP, needed for `X-03`–`X-05`):** `BankConnections` / `BankStatementImports` / `BankStatementLines` (CSV, CAMT.053, MT940) and `AccountingSyncConfigs` (QuickBooks/Xero).

---

## c. Undefined States, Transitions, and Error Cases

1. **Missing Lifecycle States:**
   - Initial `LOCKED` tranche state and transition to `ACTIVE` (for Tranche 1 on grant activation; for Tranche $N+1$ on conditional unlock).
   - Intermediate `VERIFIED_PENDING_APPROVAL` (between `REV` line-item/milestone verification and `APR` executive sign-off).
   - `Grants`-level lifecycle states (`DRAFT`, `ACTIVE`, `PAUSED`/`SUSPENDED`, `COMPLETED`, `TERMINATED`/`CLAWED_BACK`) and what happens to in-flight tranches if a grant is suspended or terminated.
2. **Partial Approval & Multi-Round Resubmission Mechanics:**
   - If 9 of 10 items are `APPROVED` and 1 is `REJECTED` (`CHANGES_REQUESTED`), can the startup edit/delete the 9 approved items? (Should be locked.) Can the startup swap in a replacement expense to reach the tranche cap?
   - What happens if a startup drops the rejected item and resubmits for _less_ than the tranche amount?
3. **Milestone Verification Failure vs. Expense Approval:**
   - If all financial line items are `APPROVED` by `REV`, but Milestone `M-3` is rejected (or overdue), does the entire submission move to `CHANGES_REQUESTED`? Who verifies milestones (`PM` vs. `REV`)?
4. **Off-Platform Payment & Reconciliation Error Cases:**
   - **Amount / Fee Variance:** Authorized `$50,000.00`, wire arrives as `$49,965.00` due to `$35` intermediary bank fee, or differs due to FX conversion slippage. Is there an auto-tolerance or a `RECONCILIATION_MISMATCH` review state?
   - **Disputed / Unconfirmed Payment:** What if the startup inputs a bank reference ID the institution disputes, or the institution's treasury fails to pay within SLA after `APPROVED_FOR_DISBURSEMENT`?
   - **Duplicate Bank Reference:** Preventing two tranches from claiming the same `payment_reference_number`.
5. **Accounting & Vault Edge Cases:**
   - **Period Close Conflict:** Attempting to post, edit, or reverse a `JournalEntry` dated on or before `books_closed_through`, or tagging a closed-period entry to a new tranche.
   - **CoA Lock Enforcement:** Attempting to change `code` or `account_type` or delete an account with `posted_entry_count > 0` (must return `409 Conflict` and allow archive only).
   - **Pre-Signed Upload Failures:** Orphaned S3 objects if upload finishes but metadata commit fails, or mismatch between client-supplied SHA-256 and actual uploaded S3 object bytes.
   - **OCR Failures & Mismatches:** Document AI failure/unreadable scan, or user-edited receipt amount differing from OCR-extracted total.
   - **Concurrent Submission / Edit Race Condition:** `FIN` editing a tagged journal line or unlinking a receipt while `FDR` submits the tranche.

---

## d. Features on Screens With No Backing Entity or Endpoint

| Screen / Element                            | UI Behavior Observed                                                                                                      | Missing Backing Entity / Endpoint                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview (`DS-3`, `D-*`)**                | `LOCKED` display state, `committee sub-step`, `in-app attestation`                                                        | Missing `availability_status` field, `APR` approval transition/endpoint, and `ReviewSubmissions` attestation fields (`attested_by`, timestamp, statement).                                                                                                                                                                |
| **Overview (`G-01`–`G-08`)**                | Sign-in, invite, onboarding, role assignment                                                                              | Missing `Invitations` table and `/invites` endpoints; `Users & Memberships` cannot store multi-org roles.                                                                                                                                                                                                                 |
| **Dashboard (`FIN`)**                       | `"Books closed through 31 Oct 2026 · Functional currency USD"`                                                            | Missing `AccountingPeriods` / org accounting settings and `POST /accounting/periods/close` endpoint.                                                                                                                                                                                                                      |
| **Dashboard (`FIN`)**                       | Readiness banner (`"3 readiness issues... Fix issues"`)                                                                   | Missing readiness validation service/endpoint (`GET /tranches/:id/readiness`) returning structured blockers (cap overage, missing receipts, missing deliverables).                                                                                                                                                        |
| **Dashboard (`FIN`)**                       | KPI cards: `Cash on hand` (`Bank + mobile money`), `Net burn (3-mo avg)`, `Runway`, `Grant funds to claim`                | Missing CoA `account_subtype` (`CASH_AND_BANK`) to isolate cash accounts, plus `GET /dashboard/summary` KPI aggregation endpoint.                                                                                                                                                                                         |
| **Dashboard (`FIN`)**                       | `Your tasks` (`Blocked`, `Missing receipt`, `M-3 deliverable (owner: Joel K.)`, `6 OCR results waiting for confirmation`) | Missing `Milestones.owner_user_id`, `EvidenceDocuments.ocr_status`, OCR confirmation endpoint (`POST /vault/documents/:id/confirm-ocr`), and unified `/tasks` aggregator.                                                                                                                                                 |
| **Dashboard (`FIN`)**                       | `Tranche 2 budget use` category bars (`R&D Personnel`, `Equipment Over cap`, `Contractors`)                               | Missing `TrancheBudgetLines` table and category utilization endpoint.                                                                                                                                                                                                                                                     |
| **Dashboard (`FIN`)**                       | `Recent transactions` grant tags (`T2 · R&D Personnel`, `Not tagged`, `—`)                                                | Missing account-level taggability flag (Asset/Expense taggable; Revenue/Liability non-taggable `—`) and journal-line allocation endpoint.                                                                                                                                                                                 |
| **Dashboard Sidebar**                       | `Activity log`, `Notifications (4)`, `Audit log`, `Team & roles`, `Tranche workspace (3)`                                 | Missing `OperationalActivities`, `Notifications` (with read/unread counts), `AuditLogs` query endpoint, and badge count endpoints.                                                                                                                                                                                        |
| **Chart of Accounts (`A-01`)**              | Hierarchical tree, `Asset (contra)`, `2400 Deferred grant income`, live balances, `Default grant category`                | Missing `ChartOfAccounts` table, balance-rollup query, `GET/POST/PATCH /accounts`, `POST /accounts/:id/archive`, and `GET /accounts/export` (CSV).                                                                                                                                                                        |
| **Chart of Accounts (`A-01`)**              | `"Code and type are locked. This account has 31 posted entries."`                                                         | Missing `posted_entry_count` aggregation and backend immutability guard.                                                                                                                                                                                                                                                  |
| **Module A (`A-04`–`A-06`, `A-09`–`A-10`)** | Trial Balance, P&L, Balance Sheet, Burn & Runway, BvA                                                                     | Missing reporting query endpoints derived from `JournalLines` + `AccountingPeriods`.                                                                                                                                                                                                                                      |
| **Module C (`M-01`–`M-05`)**                | Mobile Capture PWA offline receipt queue                                                                                  | Missing idempotency keys / offline sync queue contract for mobile uploads.                                                                                                                                                                                                                                                |
| **Platform & P3 (`X-01`–`X-05`)**           | Tenant provisioning, system health, CAMT.053/MT940 statement sync, cross-portfolio analytics                              | Admin APIs now provision/suspend workspaces, manage membership status, review audit metadata, and report status counts. CAMT.053 is staged tenant-side for review only. Initial platform-admin bootstrap, provider connectivity, MT940, statement matching/reconciliation, and financial portfolio analytics remain open. |

---

## e. Open Questions and Confirmed Decisions

1. **Funding Model — RESOLVED: Reimbursement only.** Startups incur costs, submit proofs, and pass institutional review and committee authorization before payment is executed. Advance-release and advance-reconciliation flows are out of scope; see [decisions.md](decisions.md).

2. **How Grant Money Is Booked in the Startup Ledger — RESOLVED:**
   - _Option A — Automatic reimbursement posting:_ On confirmed reimbursement, create balanced journal entries for the cash receipt and recognized grant revenue; record applicable bank fees separately.
   - _Option B — Manual reimbursement posting:_ The startup accountant manually records cash receipt and applicable bank fees after confirmation.
   - _Option C — Memo / Off-Ledger Grant Tracking Only:_ Disbursements update `Tranches` only; startup books cash inflows manually.
   - **Decision:** Option C. Payout confirmation stays off-ledger; the startup accountant manually posts the receipt and applicable bank fees.

3. **What a Rejected Line Item Does to the Payout — RESOLVED:**
   - _Option A — All-or-Nothing Package Hold (`CHANGES_REQUESTED`):_ Any rejected item holds the entire tranche until fixed or removed by the startup.
   - _Option B — Partial / Net Disbursement:_ Approved items proceed to payout immediately (short-paying the rejected amount), while rejected items move to a remediation/next submission.
   - _Option C — Partial Removal Allowed on Resubmission:_ `CHANGES_REQUESTED` holds the submission, and the startup may either fix/re-tag the item or drop it (if a lower payout or replacement expense is permitted).
   - **Decision:** Option C. Rejection holds the tranche for remediation; the startup can repair, replace, or drop a rejected item, while approved items remain unchanged in later submission snapshots.

4. **Accounting Periods and Closing Mechanics:**
   - _Option A — Rolling `books_closed_through` Date:_ Simple single date per startup (`31 Oct 2026` as shown in Figma Dashboard); entries on/before this date are locked, requiring reversing/adjusting entries in open dates.
   - _Option B — Explicit Monthly `AccountingPeriods` Table:_ Discrete `OPEN` / `SOFT_CLOSED` / `LOCKED` monthly/quarterly periods with formal close checklists.
   - **Recommendation:** **Option B** backed by a `books_closed_through` summary pointer—discrete period rows prevent gaps/overlaps and cleanly support `P&L` / `Balance Sheet` snapshots while matching the Figma header copy.

5. **How Cross-Tenant Duplicate Detection (`DUPLICATE_FILE_DETECTED`) May Be Exposed:**
   - _Option A — Asymmetric Disclosure (Privacy-Preserving):_ Startup receives a neutral warning (_"This document cannot be used / flagged for verification"_ without naming any other tenant); Institution Reviewers and Ecosystem Admins see that a cross-tenant hash match occurred (and whether it's within the same program or external).
   - _Option B — Silent Flag to Institution Only:_ Startup upload succeeds normally; fraud flag appears only on the Institution Review queue.
   - _Option C — Hard Block at Upload:_ Prevent upload completely for Startup B, revealing that the file exists elsewhere.
   - **Recommendation:** **Option A** (or **Option B** for high-stealth fraud workflows), never revealing another startup's identity to the uploader while giving reviewers clear duplicate evidence.

6. **Role and payout mapping — RESOLVED:** Keep the seven documented roles. `FIN` prepares and runs readiness checks; `FDR` attests and submits; `REV` verifies; `APR` authorizes; `PM` records the executed payout; startup `FIN` or `FDR` separately confirms receipt. Recorder and confirmer must differ. No Finance Officer role is added; see [decisions.md](decisions.md).

7. **Budget Variance Tolerances vs. Hard Category Caps — RESOLVED:**
   - _Option A — Hard Cap (0% variance):_ Any category overage blocks submission (matches Figma Dashboard `Equipment Over cap` block).
   - _Option B — Configurable Percentage Tolerance per Tranche:_ E.g., up to 10% flex across categories as long as total tranche cap isn't exceeded.
   - **Decision:** Configured percentage tolerance may be applied to category caps. The total claim remains bounded by the tranche amount.

8. **Multi-Currency & FX Source of Truth — RESOLVED:**
   - _Option A — Manual FX Rate at Entry/Reconciliation:_ Startup/Institution enters actual bank FX rate used at transaction or payout time.
   - _Option B — Automated Daily FX Feed + Manual Override:_ System fetches reference spot rates for BvA previews, overridden by actual bank rate on settlement.
   - **Decision:** Option A. Startup users enter the actual FX rate when allocating functional-currency expenses to a grant-currency tranche; the rate and converted amount are frozen in the signed submission snapshot. Institution users enter the applied payout FX rate.

9. **Authentication Operations and Account Recovery:**
   - **Direction confirmed:** Email/password, tenant-admin invitations, and authentication required for dashboard access; no public registration.
   - **Implementation defaults pending confirmation:** passwords are currently 12–128 characters; invitations and sessions currently expire after 24 hours.
   - **Resolved for tenant workspaces:** A platform `ADM` can create a workspace and invite its initial `FDR` (startup) or `PM` (institution) administrator.
   - **Open:** Define password reset/recovery, login rate limiting, and the controlled bootstrap process for the first platform `ADM`.

10. **Platform Settings Screen:**

- The reference dashboard includes a `Platform settings` navigation item, but no configurable settings or authorized actions are specified. It remains unimplemented rather than exposing environment secrets or inventing global controls.

11. **Migration/deployment verification:** The local grant schema was initialized manually and has no recorded migration history. Checked-in grant migration `0004` references a legacy `tenants` table, while the initialized schema uses `organizations`; `0006` and later migrations depend on those grant tables. Do not run the full migration chain against that database until the applied schema and migration baseline are reconciled.
