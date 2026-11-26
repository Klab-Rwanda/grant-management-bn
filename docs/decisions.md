# Architecture & Product Decisions (`Grant Ledger`)

> **Instructions:** Each blocking question below requires an explicit human decision before finalizing the database DDL, RLS policies, and API state machine. Fill in each empty **`Decision:`** field.

---

## 1. Funding Model (Advance vs. Reimbursement)

**Context:** The 8-stage Lifecycle describes startups spending first, auditing, and then receiving disbursement (reimbursement). However, the Figma CoA includes `2400 Deferred grant income` (Liability) and Module B describes milestone-gated tranche unlocks (typical of advance disbursements).

**Options:**

- **Option A:** Reimbursement only (spend $\rightarrow$ audit $\rightarrow$ disburse).
- **Option B:** Advance / milestone-based only (disburse upfront/on milestone $\rightarrow$ spend $\rightarrow$ reconcile $\rightarrow$ unlock next tranche).
- **Option C (Recommended):** Configurable `funding_model` (`ADVANCE` | `REIMBURSEMENT`) per Grant Program / Tranche.

**Decision:**

---

## 2. How Grant Money Is Booked in the Startup Ledger

**Context:** Stage 7 reconciles off-platform payouts (`net_disbursed_amount`, `bank_fee`, `fx_rate`), and Figma `A-01` includes `2400 Deferred grant income` alongside `4100 Subscription revenue`. Reconciled grant payouts must either post to the startup's double-entry ledger automatically or be recorded manually.

**Options:**

- **Option A (Recommended):** Auto-generate balanced `JournalEntries` upon Stage 7 reconciliation—crediting `2400 Deferred grant income` for advances (recognized to Grant Revenue as expenses clear) and crediting `Grant Revenue` directly for reimbursements, with any intermediary wire fees booked separately.
- **Option B:** Credit `Grant Revenue` immediately upon cash receipt for all grants (cash-basis simplicity; distorts monthly P&L/burn).
- **Option C:** Keep Stage 7 off-ledger; startup accountants manually create cash-receipt journal entries.

**Decision:**

---

## 3. What a Rejected Line Item Does to the Payout

**Context:** Stage 5 lets Institutional Reviewers reject individual `LineItemAllocations` with structured reason codes (`CHANGES_REQUESTED`), while Stage 6 authorizes tranche disbursement.

**Options:**

- **Option A:** Full tranche hold (`CHANGES_REQUESTED`)—no disbursement occurs until every rejected line item is remediated or replaced.
- **Option B:** Partial / net payout—approved items are disbursed immediately while rejected items split off into a remediation cycle.
- **Option C (Recommended):** Tranche holds in `CHANGES_REQUESTED`, and the startup may either remediate the item, swap in another eligible expense, or drop the item and accept a reduced tranche payout (preserving `APPROVED` items untouched across resubmissions).

**Decision:**

---

## 4. Accounting Periods and Closing

**Context:** The Figma Dashboard displays `"Books closed through 31 Oct 2026 · Functional currency USD"`, and Module A includes Trial Balance, P&L, and Balance Sheet reports, but the Core Data Model has no period entities or lock flags.

**Options:**

- **Option A:** Single `books_closed_through` date on the startup organization; entries on or before that date are immutable.
- **Option B (Recommended):** Explicit `AccountingPeriods` table (`OPEN` | `SOFT_CLOSED` | `LOCKED`) per startup org, driving the `books_closed_through` summary date and blocking mutations/re-tagging in closed periods (requiring reversing entries in open periods).

**Decision:**

---

## 5. How Cross-Tenant Duplicate Detection May Be Exposed

**Context:** Module C checks incoming `sha256_hash` values globally across startups (`DUPLICATE_FILE_DETECTED`). Under strict multi-tenant privacy, Startup B must not learn anything confidential about Startup A.

**Options:**

- **Option A (Recommended):** Asymmetric disclosure—Startup B sees a neutral warning that the file could not be cleared automatically (without revealing any other tenant's identity), while Institution Reviewers (`REV`/`PM`) and Ecosystem Admins (`ADM`) see the cross-tenant duplicate flag and match context.
- **Option B:** Silent flag—Startup upload completes normally; duplicate alert surfaces only in the Institution Review queue.
- **Option C:** Hard upload block—reject duplicate file upload immediately with a duplicate error.

**Decision:**

---

## 6. Which Roles Exist (and Permission Boundaries)

**Context:** Seven personas exist in the RBAC table & Figma (`FDR`, `FIN`, `OPS`, `PM`, `REV`, `APR`, `ADM`), while Stage 7 mentions an undefined `Finance Officer` on the institution side, and `FIN` vs. `FDR` submission sign-off overlap in the RBAC table vs. Stage 4.

**Options:**

- **Option A (Recommended):** Keep strictly the 7 documented roles (`FDR`, `FIN`, `OPS`, `PM`, `REV`, `APR`, `ADM`); allow `FIN` to prepare/run readiness checks while requiring `FDR` for Stage 4 submission attestation, and assign Stage 7 off-platform disbursement entry to `PM` (or `APR`) on the institution side (with optional startup proof submission reviewed by `PM`).
- **Option B:** Add an 8th role (`Institution Finance / Treasury Officer`) dedicated exclusively to Stage 7 off-platform payout recording and bank confirmation upload.
- **Option C:** Merge `Committee Approver (APR)` into `Grant Program Manager (PM)` for Phase 1 and re-introduce `APR` later (note: Figma already draws the committee sub-step).

**Decision:**
