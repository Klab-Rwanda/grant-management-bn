# Implementation Progress (`Grant Ledger`)

## Completed

- **Pre-Code Specification Audit:**
  - Audited architecture spec and uploaded reference/Figma screens in [spec-gaps.md](spec-gaps.md).
  - Documented 6 blocking product/architecture decisions in [decisions.md](decisions.md) (awaiting human input).
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
  - Auth module implemented behind `IAuthProvider` interface with `StubJwtAuthProvider` (HS256 tokens, MFA/SSO hook points).
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

## Local Database Note

- User manually created the full 36-table PostgreSQL schema directly in local pgAdmin 4 (`grant_ledger` database) for early DB inspection. Application migrations remain strictly at Foundation (`0001_init_extensions.sql`) until Milestones 2+ are approved.

## Pending / Blocked on Decisions

- Fill in the 6 open **`Decision:`** fields in [decisions.md](decisions.md) before starting Milestone 2+ (Security Base, Ledger, Grants, Evidence, Submission, Disbursement Confirmation).
- Install/start Docker locally to run `docker compose up -d` and Testcontainers integration tests locally (runs in GitHub Actions on `ubuntu-latest`).
