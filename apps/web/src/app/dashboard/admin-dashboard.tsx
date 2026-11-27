import type { AuthUserContext, HealthCheckResponse } from '@grant-ledger/shared';
import { getApiBaseUrl, isRecord } from '../../lib/auth-session';
import AdminConsole from './admin-console';

type HealthResult =
  { available: true; health: HealthCheckResponse } | { available: false; message: string };

function isHealthCheckResponse(value: unknown): value is HealthCheckResponse {
  return (
    isRecord(value) &&
    (value.status === 'ok' || value.status === 'degraded') &&
    typeof value.service === 'string' &&
    typeof value.timestamp === 'string' &&
    isRecord(value.checks) &&
    (value.checks.postgres === 'up' || value.checks.postgres === 'down')
  );
}

async function getPlatformHealth(): Promise<HealthResult> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/health`, { cache: 'no-store' });
  } catch {
    return {
      available: false,
      message: 'Could not reach the API health endpoint. Check the API service and refresh.',
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      available: false,
      message: 'The API returned an unreadable health response.',
    };
  }

  if (!isHealthCheckResponse(payload)) {
    return {
      available: false,
      message: 'The API returned an unexpected health response.',
    };
  }

  return { available: true, health: payload };
}

export default async function AdminDashboard({ user }: { user: AuthUserContext }) {
  const result = await getPlatformHealth();
  const apiStatus = !result.available
    ? 'Unavailable'
    : result.health.status === 'ok'
      ? 'Operational'
      : 'Degraded';
  const databaseStatus = result.available ? result.health.checks.postgres : 'Unknown';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a className="flex items-center gap-3 font-semibold tracking-tight" href="/">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm text-white">
              G
            </span>
            <span>Grant Ledger</span>
            <span className="hidden rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800 sm:inline">
              Platform
            </span>
          </a>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-56 truncate text-sm font-medium">{user.email}</p>
              <p className="text-xs text-slate-500">Ecosystem administrator</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {user.role}
            </span>
            <form action="/api/auth/logout" method="post">
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">
              Platform administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">System overview</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Monitor platform availability and see which administration capabilities are ready.
            </p>
          </div>
          <p className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-900">
            Platform-wide access · Sensitive actions should be audited
          </p>
        </div>

        <section aria-label="Platform health" className="mt-8">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">System health</h2>
            <p className="mt-1 text-sm text-slate-600">
              Live readiness check from the API; no sample status is shown.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-600">Grant Ledger API</p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  apiStatus === 'Operational' ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {apiStatus}
              </p>
              {result.available ? (
                <p className="mt-2 text-xs text-slate-500">
                  Service: {result.health.service} · Checked: {result.health.timestamp}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-600">{result.message}</p>
              )}
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-600">PostgreSQL</p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  databaseStatus === 'up' ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {databaseStatus === 'up'
                  ? 'Connected'
                  : databaseStatus === 'down'
                    ? 'Unavailable'
                    : 'Unknown'}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {result.available
                  ? 'Database readiness reported by the API.'
                  : 'Database status is unavailable until the API health check responds.'}
              </p>
            </article>
          </div>
        </section>

        <section aria-labelledby="admin-capabilities" className="mt-10">
          <div className="mb-3">
            <h2 id="admin-capabilities" className="text-lg font-semibold">
              Platform administration
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Workspace, access, audit, analytics, and integration operations backed by live APIs.
            </p>
          </div>
          <nav aria-label="Platform administration sections" className="mb-6 flex flex-wrap gap-2">
            {[
              ['Workspaces', '#workspaces'],
              ['Users & access', '#access'],
              ['Audit events', '#audit'],
              ['Portfolio analytics', '#analytics'],
              ['Integrations', '#integrations'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {label}
              </a>
            ))}
          </nav>
          <AdminConsole />
        </section>
      </div>
    </main>
  );
}
