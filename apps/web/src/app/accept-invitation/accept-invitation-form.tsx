'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function AcceptInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, full_name: fullName, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          typeof result.message === 'string' ? result.message : 'Unable to accept invitation.',
        );
        return;
      }
      setPassword('');
      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('The invitation service is unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-slate-700">
        Full name
        <input
          autoComplete="name"
          className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          onChange={(event) => setFullName(event.target.value)}
          required
          value={fullName}
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Password
        <input
          autoComplete="new-password"
          className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Use at least 12 characters.
        </span>
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
        {busy ? 'Accepting invitation…' : 'Accept invitation'}
      </button>
    </form>
  );
}
