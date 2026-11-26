# Data Ownership & Access Control Matrix (`Grant Ledger`)

## Core Architectural Principle: Asymmetric Isolation

1. **Startups own their private operational data:**
   - Double-entry accounts, accounting periods, journal entries, journal lines, vendor directories, internal unsubmitted evidence files, and operational logs are strictly private to the startup tenant (`STARTUP`).
   - **Institution users never read startup private tables directly.**

2. **Institutions access explicitly submitted snapshots and shared grant contracts:**
   - Reviewers and program managers inspect frozen submission snapshots (`review_submissions`, `submission_items`, and immutable `signatures`) plus shared grant lifecycle tables (`grants`, `tranches`, `tranche_budget_lines`, `milestones`, `disbursements`).
   - Private bookkeeping modifications made before or after a submission snapshot remain invisible to the institution.

3. **Platform-level tables maintain zero tenant data:**
   - Deduplication and file fingerprint registries (`evidence_fingerprints`) store only cryptographic hashes and keyed HMACs without tenant identifiers or plain text metadata. Direct tenant queries to this table are revoked.

---

## Complete Table-by-Table Ownership & Access Matrix

### 1. Identity, Organization & System Security

| Table           | Owner Tenant           | Read Access                                                          | Write Access                                                                     | RLS Isolation Model                               |
| --------------- | ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| `organizations` | Platform / Tenant Root | Authenticated users within that organization; `ADM` across platform  | Tenant Admin (`FDR` for startup; `PM`/`APR` for institution; `ADM` for platform) | Scoped by tenant context / admin queries          |
| `users`         | Global Identity        | Authenticated self (own user profile); Tenant admins for member list | Self (name/password); System for status                                          | Global table; filtered by membership join         |
| `memberships`   | Tenant (`tenant_id`)   | Users with an active membership in that tenant                       | Tenant Admin (`FDR`, `PM`, `ADM`)                                                | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `invitations`   | Tenant (`tenant_id`)   | Tenant members with invite permissions                               | Tenant Admin (`FDR`, `PM`, `ADM`)                                                | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `audit_logs`    | Tenant (`tenant_id`)   | Tenant Admins & Auditors (`FDR`, `FIN`, `PM`, `REV`, `APR`, `ADM`)   | Append-only via trusted application writer service (`UPDATE`/`DELETE` revoked)   | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |

---

### 2. Module A: Startup Double-Entry Accounting Ledger (Private)

> **Rule:** Institution users (`PM`, `REV`, `APR`) have **zero** access to these tables.

| Table                       | Owner Tenant          | Read Access                         | Write Access                                                  | RLS Isolation Model                               |
| --------------------------- | --------------------- | ----------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `accounts`                  | Startup (`tenant_id`) | Startup roles (`FDR`, `FIN`, `OPS`) | `FIN`, `FDR` (Archive only if posted lines exist)             | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `accounting_periods`        | Startup (`tenant_id`) | Startup roles (`FDR`, `FIN`, `OPS`) | `FIN`, `FDR`                                                  | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `journal_entries`           | Startup (`tenant_id`) | Startup roles (`FDR`, `FIN`, `OPS`) | `FIN`, `FDR` (Append-only when posted; corrected by reversal) | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `journal_lines`             | Startup (`tenant_id`) | Startup roles (`FDR`, `FIN`, `OPS`) | `FIN`, `FDR` (Immutable when parent entry is posted)          | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `account_category_mappings` | Startup (`tenant_id`) | Startup roles (`FDR`, `FIN`)        | `FIN`, `FDR`                                                  | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `operational_activities`    | Startup (`tenant_id`) | Startup roles (`FDR`, `FIN`, `OPS`) | `OPS`, `FDR`, `FIN`                                           | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |

---

### 3. Module B: Grant Programs, Tranches & Milestones (Two-Party Shared)

| Table                  | Owner Tenant                                       | Read Access                                                               | Write Access                                                                        | RLS Isolation Model                                    |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `grant_programs`       | Institution (`tenant_id`)                          | Institution users (`PM`, `REV`, `APR`, `ADM`)                             | `PM`, `ADM`                                                                         | `FORCE RLS` (`tenant_id = app.current_tenant_id`)      |
| `grant_term_versions`  | Institution (`tenant_id`)                          | Institution users (`PM`, `REV`, `APR`); Awarded Startups via Grant        | `PM`, `ADM` (Immutable once created)                                                | `FORCE RLS` (`tenant_id = app.current_tenant_id`)      |
| `grants`               | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution (`PM`, `REV`, `APR`) & Startup (`FDR`, `FIN`, `OPS`) | `PM`, `APR` (Institution side); `FDR` (Sign-off)                                    | `FORCE RLS` (Current tenant is institution or startup) |
| `tranches`             | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                            | Institution (`PM`, `APR`) for terms/unlock; Startup (`FDR`) for state transitions   | `FORCE RLS` (Current tenant is institution or startup) |
| `tranche_budget_lines` | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                            | Institution (`PM`)                                                                  | `FORCE RLS` (Current tenant is institution or startup) |
| `milestones`           | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                            | Startup (`OPS`, `FIN`) for deliverables; Institution (`REV`, `PM`) for verification | `FORCE RLS` (Current tenant is institution or startup) |
| `unlock_rules`         | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                            | Institution (`PM`)                                                                  | `FORCE RLS` (Current tenant is institution or startup) |
| `grant_assignments`    | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                            | Institution (`PM`) / Startup (`FDR`)                                                | `FORCE RLS` (Current tenant is institution or startup) |

---

### 4. Module C: Evidence Vault & Allocations

| Table                   | Owner Tenant           | Read Access                                                                              | Write Access                                                | RLS Isolation Model                               |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `vendors`               | Startup (`tenant_id`)  | Startup roles (`FDR`, `FIN`, `OPS`)                                                      | `FIN`, `FDR`                                                | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `evidence_documents`    | Startup (`tenant_id`)  | Startup roles (`FDR`, `FIN`, `OPS`) (Institution reads only via frozen submission items) | Startup (`FDR`, `FIN`, `OPS`); Worker for scan confirmation | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `evidence_fingerprints` | Platform (System Only) | Background Worker / Fraud Evaluation Service only                                        | Background Worker / Scanner service                         | Direct SELECT revoked from tenant app role        |
| `journal_line_evidence` | Startup (`tenant_id`)  | Startup roles (`FDR`, `FIN`, `OPS`)                                                      | `FIN`, `FDR`                                                | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `milestone_evidence`    | Startup (`tenant_id`)  | Startup roles (`FDR`, `FIN`, `OPS`)                                                      | `OPS`, `FIN`, `FDR`                                         | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |
| `line_item_allocations` | Startup (`tenant_id`)  | Startup roles (`FDR`, `FIN`)                                                             | `FIN`, `FDR` (Locked on submit)                             | `FORCE RLS` (`tenant_id = app.current_tenant_id`) |

---

### 5. Module D: Submissions, Snapshots, Reviews & Disbursements (Audit & Grant Boundary)

| Table                 | Owner Tenant                                       | Read Access                                                        | Write Access                                                                       | RLS Isolation Model                                    |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `review_submissions`  | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution (`PM`, `REV`, `APR`) & Startup (`FDR`, `FIN`) | Startup (`FDR` on submit); State machine on status transition                      | `FORCE RLS` (Current tenant is institution or startup) |
| `submission_items`    | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution (`PM`, `REV`, `APR`) & Startup (`FDR`, `FIN`) | Created immutably on submit                                                        | `FORCE RLS` (Current tenant is institution or startup) |
| `signatures`          | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                     | Created immutably by `FDR` upon submission                                         | `FORCE RLS` (Current tenant is institution or startup) |
| `review_decisions`    | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                     | Institution Reviewer (`REV`)                                                       | `FORCE RLS` (Current tenant is institution or startup) |
| `milestone_decisions` | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                     | Institution Reviewer (`REV`, `PM`)                                                 | `FORCE RLS` (Current tenant is institution or startup) |
| `disbursements`       | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup                                     | Institution (`APR` to authorize; `PM` to record); Startup (`FIN`/`FDR` to confirm) | `FORCE RLS` (Current tenant is institution or startup) |

---

### 6. Module E: Inline Discussion, SLA & Notifications

| Table                | Owner Tenant                                       | Read Access                            | Write Access                      | RLS Isolation Model                                    |
| -------------------- | -------------------------------------------------- | -------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| `discussion_threads` | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup members | Assigned members on linked entity | `FORCE RLS` (Current tenant is institution or startup) |
| `comments`           | Shared (`institution_tenant_id`, `startup_org_id`) | Assigned Institution & Startup members | Author of the comment             | `FORCE RLS` (Current tenant is institution or startup) |
| `sla_rules`          | Institution (`tenant_id`)                          | Institution users (`PM`, `REV`, `APR`) | `PM`, `ADM`                       | `FORCE RLS` (`tenant_id = app.current_tenant_id`)      |
| `notifications`      | Tenant (`tenant_id`)                               | Recipient user within that tenant      | System / Notification dispatcher  | `FORCE RLS` (`tenant_id = app.current_tenant_id`)      |
| `outbox_events`      | Tenant (`tenant_id`)                               | Background workers / internal queues   | System event dispatchers          | `FORCE RLS` (`tenant_id = app.current_tenant_id`)      |

---

## Segregation of Duties (SoD) Invariants

1. **Submission Authorization:**
   - Preparation of readiness packages and allocations may be done by `FIN` or `OPS`.
   - The final submission digital signature (`signatures`) and lock can **only** be executed by the `FDR` (Founder / CEO) persona with fresh re-authentication.
2. **Review vs. Committee Approval:**
   - The reviewer (`REV`) who performs line-item audits and milestone verification **cannot** be the Committee Approver (`APR`) who signs off on disbursement authorization for that same tranche submission.
3. **Disbursement Confirmation:**
   - The person who records off-platform wire payment details (`recorded_by_user_id` on the institution side) **cannot** be the person who confirms receipt (`confirmed_by_user_id` on the startup side).
