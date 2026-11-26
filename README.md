# Grant Ledger

Startup Accounting & Grant Management Platform monorepo (`apps/api`, `apps/web`, `packages/shared`).

## Prerequisites

- **Node.js** `>= 22` (tested on Node 24)
- **pnpm** `>= 9` (`corepack enable pnpm`)
- **Docker** & **Docker Compose** (for PostgreSQL 16, Redis, MinIO, Mailpit, and Testcontainers integration tests)

## Fresh Clone Setup

1. **Copy environment configuration:**

   ```bash
   cp .env.example .env
   ```

   _(On Windows PowerShell: `Copy-Item .env.example .env`)_

2. **Start local infrastructure services:**

   ```bash
   docker compose up -d
   ```

   Services exposed locally:
   - PostgreSQL 16: `localhost:5432` (`grant_ledger` / `grant_ledger_dev`)
   - Redis 7: `localhost:6379`
   - MinIO S3 API / Console: `localhost:9000` / `localhost:9001` (`minioadmin` / `minioadmin`, bucket `grant-ledger-vault`)
   - Mailpit SMTP / Web UI: `localhost:1025` / `localhost:8025`

3. **Install dependencies:**

   ```bash
   pnpm install
   ```

4. **Run database migrations:**

   ```bash
   pnpm db:migrate
   ```

5. **Start API and Web in development mode:**
   ```bash
   pnpm dev
   ```
   - Web placeholder: http://localhost:3000
   - API health endpoint: http://localhost:3001/health
   - API Swagger / OpenAPI UI: http://localhost:3001/docs

## Verification Commands

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm openapi:generate
pnpm test:unit
pnpm test:integration
```
