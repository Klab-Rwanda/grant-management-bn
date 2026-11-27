# Implementation Progress (`Grant Ledger`)

## Completed

- **Pre-Code Specification Audit:**
  - Audited architecture spec and uploaded reference/Figma screens in [spec-gaps.md](spec-gaps.md).
  - Recorded the confirmed reimbursement-only lifecycle and seven-role payout mapping in [decisions.md](decisions.md); accounting-period and duplicate-disclosure decisions remain open.
  - Formalized the dual-field tranche state machine (`availability_status` + `review_status`) in [state-machine.md](state-machine.md).
- **Milestone 1 — Project Foundation (No Business Logic):**
  - Monorepo configured with `pnpm-workspace.yaml` (`apps/api`, `apps/web`, `packages/shared`).
  - `docker-compose.yml` configured with PostgreSQL 16, Redis 7, MinIO (auto-creating `grant-ledger-vault`), and Mailpit.
  - SQL-first migration pipeline (`node-pg-migrate`) + `Kysely` configured in `apps/api` with initial `0001_init_extensions.sql` (`pgcrypto`).
  - Validated `zod` environment configuration and `.env.example` (no committed secrets).
  - API includes `GET /health`, `@nestjs/swagger` OpenAPI docs (`/docs` and `openapi:generate`), and Pino structured JSON logging with `request_id` and `tenant_id` on every log line.
  - Web placeholder app (`Next.js 15` + `TypeScript` + `Tailwind CSS`) checks `GET /health`.
  - All automated checks pass locally:
    - `pnpm lint` (ESLint 9 + TypeScript-ESLint)
    - `pnpm format:check` (Prettier)
    - `pnpm typecheck` (tsc across all workspace projects)
    - `pnpm build` (shared, api, and Next.js web build)
    - `pnpm openapi:generate` (emits valid `openapi.json`)
    - `pnpm test:unit` (10 passed tests across packages)
  - `AGENTS.md` and `README.md` created.
  - GitHub Actions CI workflow configured (`.github/workflows/ci.yml`).
- **Milestone 2 — Security Base (Multi-Tenant Isolation, Identity, Auth & Audit Log):**
  - Data ownership matrix formalized in [docs/data-ownership.md](data-ownership.md) codifying asymmetric isolation (institutions read only grant-side snapshots; never private startup ledgers).
  - Security database migration (`0002_security_base.sql`) added with RLS policies and append-only triggers.
  - `TenantContextService` transaction wrapper executing `SET LOCAL app.current_tenant_id` and assuming `grant_ledger_app` role with automatic cleanup upon transaction completion.
  - Auth module provides HS256 sessions through `IAuthProvider`; email/password login and tenant-admin invitation acceptance use the existing identity tables.
  - Dashboard access is checked server-side through the API, stored in an HttpOnly cookie, and revoked when the account, workspace, or membership is suspended.
  - Invitation acceptance and membership creation are audited in the same transaction; invitation tokens are stored as hashes.
  - `AuthGuard` and `AuthorizationGuard` enforcing role-based permissions and workspace type compatibility.
  - `SegregationOfDutiesService` enforcing separation between preparer/approver, reviewer/committee approver, and payout recorder/confirmer.
  - `AuditLogService` appending immutable audit logs with deterministic SHA-256 hash chaining serialized via `pg_advisory_xact_lock`.
  - `AuditVerifierService` cryptographically verifying tenant hash chains and detecting data tampering.
  - Integration test suite implemented in `apps/api/test/security.integration.spec.ts` covering generic RLS audits, cross-tenant isolation, pooled connection safety, and append-only immutability.
  - 20 unit tests passing across all workspace packages (`shared`, `web`, `api`).
- **Milestone 3 — Startup Double-Entry Ledger Module:**
  - Exact BigInt-backed `Decimal` arithmetic utility in `packages/shared/src/decimal.ts` enforcing strict Rule 1 of `AGENTS.md` (no IEEE-754 floats for monetary calculations).
  - Database migration `0003_ledger_module.sql` with PostgreSQL deferred constraint trigger `trg_journal_entries_balanced` verifying $\sum \text{debits} = \sum \text{credits}$ in functional currency on commit, immutability triggers (`trg_journal_entries_protect`, `trg_accounts_protect_used`, `trg_journal_lines_protect`), and strict RLS policies on `accounts`, `accounting_periods`, `journal_entries`, and `journal_lines`.
  - Chart of accounts service (`ChartOfAccountsService`) implementing the 42-account tech startup standard template with parent-child hierarchy, contra accounts, and specialized subtypes (`CASH_AND_BANK`, `DEFERRED_GRANT_INCOME`).
  - Accounting periods service (`AccountingPeriodsService`) providing period management, automatic overlap prevention, and period closing with org-level closing pointer update.
  - Journal entries service (`JournalEntriesService`) supporting multi-currency transactions with FX rate conversions, strict debit/credit validation, open period verification, atomic audit log creation, and compensating reversal entries (`source = 'REVERSAL'`).
  - Simple expense recording endpoint (`POST /ledger/expenses`) allowing non-accountants to record expenses without manual dual-line entry creation.
  - Financial reports service (`FinancialReportsService`) computing:
    - General Ledger with running balance per account.
    - Trial Balance asserting total functional debits equal total credits.
    - Profit & Loss Statement (Revenues, Expenses, and Net Income).
    - Balance Sheet maintaining the fundamental accounting equation ($\text{Assets} = \text{Liabilities} + \text{Equity} + \text{Net Income}$).
    - Burn & Runway calculation based on Cash & Bank accounts and trailing 3-month average net burn.
  - Ledger controller (`LedgerController`) exposing all routes documented with OpenAPI Swagger decorators, RBAC roles (`FDR`, `FIN`, `OPS`), and Bearer auth guards.
  - 40 automated unit tests passing across all packages (`packages/shared`: 9, `apps/api`: 29, `apps/web`: 2).
  - All automated checks pass with exit code 0 (`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm openapi:generate`, `pnpm test:unit`).

- **Platform Administration MVP:**
  - Added platform-admin-only workspace provisioning, status management, membership suspension/reactivation, metadata-only cross-tenant audit review, and count-only portfolio analytics.
  - Workspace create and access changes use centralized lifecycle transitions and append-only audit entries in the same transaction. Initial startup/institution admins receive role-appropriate email invitations.
  - Added tenant-scoped CAMT.053 import parsing and a private review queue; imports are duplicate-checked, stored as decimal-string transaction rows, and never auto-posted or reconciled.
  - The platform integration view exposes import metadata only. Initial platform-`ADM` bootstrap, provider connections, statement matching/reconciliation, and financial portfolio reporting remain open.

## Local Database Note

- User manually created the full 36-table PostgreSQL schema directly in local pgAdmin 4 (`grant_ledger` database) for early DB inspection. The local database has no recorded migration history. Do not run the migration chain until the legacy `0004` `tenants` dependency is reconciled with the manually initialized `organizations` schema.

## Grant Lifecycle MVP

- Implemented program/award/tranche setup, startup expense tagging with manual FX, evidence upload/scanning, readiness blockers, password-confirmed Founder submissions, frozen line/milestone evidence snapshots, reviewer decisions, committee authorization, institution payout recording, startup receipt confirmation, and automatic next-tranche unlocking.
- Added the role-aware grant workspace and authenticated Next.js API proxy. Multipart uploads preserve their original binary payload through the proxy.
- Rejected allocations can be repaired, replaced, or explicitly dropped; approved allocations carry forward unchanged. Payout reconciliation remains off-ledger and requires exact authorized-amount matching.
- Added a forward migration for allocation FX snapshots and a migration adding the `DROPPED` allocation status. Neither has been applied to the manually initialized local database.
- Remaining production verification: resolve and baseline the migration chain before deployment; exercise RLS, S3/MinIO signing, ClamAV scanning, and the full lifecycle with the intended PostgreSQL schema; rerun the full API typecheck/build after restoring consistent NestJS dependencies.
