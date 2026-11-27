'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface WorkspaceChoice {
  tenant_id: string;
  legal_name: string;
  org_type: string;
  role: string;
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signIn();
  }

  async function signIn(tenantId?: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, ...(tenantId ? { tenant_id: tenantId } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result.message === 'string' ? result.message : 'Unable to sign in.');
        return;
      }
      if (Array.isArray(result.workspaces)) {
        setWorkspaces(result.workspaces);
        return;
      }
      setPassword('');
      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('The sign-in service is unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-7">
      <form className="space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            autoComplete="email"
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            onChange={(event) => {
              setEmail(event.target.value);
              setWorkspaces([]);
            }}
            required
            type="email"
            value={email}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            autoComplete="current-password"
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            onChange={(event) => {
              setPassword(event.target.value);
              setWorkspaces([]);
            }}
            required
            type="password"
            value={password}
          />
        </label>
        {error && (
          <p aria-live="polite" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {workspaces.length > 0 && (
        <div className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="text-sm font-semibold">Choose a workspace</h2>
          <p className="mt-1 text-xs text-slate-500">
            Your account has access to more than one workspace.
          </p>
          <div className="mt-3 space-y-2">
            {workspaces.map((workspace) => (
              <button
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3 text-left hover:border-emerald-500 hover:bg-emerald-50/50 disabled:opacity-60"
                disabled={busy}
                key={workspace.tenant_id}
                onClick={() => void signIn(workspace.tenant_id)}
                type="button"
              >
                <span>
                  <span className="block text-sm font-medium">{workspace.legal_name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {workspace.org_type} · {workspace.role}
                  </span>
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
