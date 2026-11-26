# AGENTS.md — Engineering Rules & Architecture Guide

## Tech Stack

- **Monorepo:** `pnpm` workspaces (`apps/*`, `packages/*`)
- **Backend (`apps/api`):** NestJS 11, TypeScript (strict), PostgreSQL 16, Kysely (SQL query builder), `node-pg-migrate` (SQL-first `.sql` migrations), Pino (structured JSON logging), `@nestjs/swagger` (OpenAPI), `zod` (env validation)
- **Frontend (`apps/web`):** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- **Shared (`packages/shared`):** Shared TypeScript contracts & decimal utilities
- **Infrastructure (Local Docker Compose):** PostgreSQL 16, Redis 7, MinIO (S3-compatible), Mailpit (SMTP)
- **Testing & CI:** Vitest (unit), Testcontainers (`@testcontainers/postgresql` for real Postgres integration tests), ESLint, Prettier, GitHub Actions

## Folder Layout

```text
.
├── .github/workflows/ci.yml   # CI pipeline (lint, format, typecheck, migrations, build, tests)
├── apps/
│   ├── api/                   # NestJS backend API
│   │   ├── migrations/        # SQL-first up/down migrations (node-pg-migrate)
│   │   ├── src/               # API modules (config, logging, database, health, ...)
│   │   └── test/              # Integration tests (Testcontainers against real Postgres)
│   └── web/                   # Next.js frontend
├── packages/
│   └── shared/                # Shared TypeScript types & helpers
├── docs/                      # Architecture audit, decisions, state machine, progress
├── docker-compose.yml         # Local Postgres 16, Redis, MinIO, Mailpit
├── .env.example               # Environment variable template (no secrets)
├── AGENTS.md                  # Repository engineering rules (this file)
└── README.md                  # Fresh-clone setup instructions
```

## Exact Commands

```bash
# Local infrastructure & environment
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate

# Run API (port 3001) and Web (port 3000) in development
pnpm dev

# Quality, build, OpenAPI & tests
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm openapi:generate
pnpm test:unit
pnpm test:integration
pnpm test
```

## Mandatory Engineering Rules

1. **Money Is Numeric or Decimal Strings, Never Floats:** Store monetary amounts as PostgreSQL `NUMERIC` (e.g. `NUMERIC(19, 4)`) and pass them as decimal strings in TypeScript/JSON (`DecimalString`). Never use IEEE-754 floating-point numbers (`float`, `double precision`, JS `number`, or `parseFloat`) for money calculations or formatting.
2. **Forced Row-Level Security on Every Tenant Table:** Every tenant table must include `tenant_id` (or explicit dual-party tenant columns for shared grant tables) with `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`, evaluated inside transactions via `SET LOCAL app.current_tenant_id`, and queried by a non-owner database role without `BYPASSRLS`.
3. **Append-Only Ledger Entries:** Posted ledger entries (`journal_entries`, `journal_lines`) cannot be updated or deleted. Corrections must be performed exclusively by posting balanced reversal entries (`reverses_entry_id`).
4. **Single State-Machine Module & Mandatory Audit Entries:** All lifecycle state changes must go through a single centralized state-machine module and write an entry to `audit_logs` within the same database transaction.
5. **Never Edit an Applied Migration:** Once a `.sql` migration file has been applied, never modify it. Always add a new forward migration file for schema changes.
6. **Do Not Invent Requirements:** When product behavior, accounting treatment, roles, or UI specifications are unspecified or contradictory, stop and record open questions in `docs/decisions.md` or `docs/spec-gaps.md` instead of guessing.
