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
   - Public landing page: http://localhost:3000
   - Sign-in: http://localhost:3000/login
   - Dashboard (requires an authenticated session): http://localhost:3000/dashboard
   - API health endpoint: http://localhost:3001/health
   - API Swagger / OpenAPI UI: http://localhost:3001/docs

## User Authentication

There is no public registration. A tenant administrator signs in, then creates an invitation with
`POST /invitations` in the API docs. Invitation permissions follow the access matrix: `FDR` for a
startup, `PM` for an institution, and `ADM` for the platform workspace. The invitee follows the
emailed link, sets a password of at least 12 characters, and is signed in to the invited workspace.
Existing accounts must use their current password when accepting another workspace invitation.
An initial tenant-admin account and membership must be provisioned by the deployment operator;
the invitation flow does not create its own first administrator.

In local development, invitation email is delivered to Mailpit at http://localhost:8025. The web
session is stored in an HttpOnly cookie; the dashboard redirects to sign-in when the cookie or
workspace membership is no longer valid. Set a unique `AUTH_JWT_SECRET` and a public `WEB_BASE_URL`
in non-local environments. Current implementation defaults are a 12-character minimum password
and 24-hour invitation/session expiry; confirm these security policies before production use.

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
