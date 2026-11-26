import type { HealthCheckResponse } from '@grant-ledger/shared';
import { getWebEnv } from '../lib/env';

async function fetchApiHealth(apiUrl: string): Promise<HealthCheckResponse | null> {
  try {
    const res = await fetch(`${apiUrl}/health`, { cache: 'no-store' });
    if (!res.ok && res.status !== 503) {
      return null;
    }
    return (await res.json()) as HealthCheckResponse;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const env = getWebEnv();
  const health = await fetchApiHealth(env.NEXT_PUBLIC_API_URL);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <div className="rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
          Foundation Placeholder
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-slate-900">Grant Ledger</h1>
        <p className="mt-2 text-sm text-slate-600">
          Startup Accounting &amp; Grant Management Platform monorepo scaffold.
        </p>

        <div className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700">API Status</span>
            <span
              className={
                health?.status === 'ok'
                  ? 'rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800'
                  : 'rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800'
              }
            >
              {health ? `${health.status} (postgres: ${health.checks.postgres})` : 'unreachable'}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Endpoint: <code>{env.NEXT_PUBLIC_API_URL}/health</code>
          </p>
        </div>
      </div>
    </main>
  );
}
