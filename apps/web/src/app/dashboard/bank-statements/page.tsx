import { notFound } from 'next/navigation';
import { requireAuthenticatedUser } from '../../../lib/auth-session';
import BankStatementsPanel from './bank-statements-panel';

export default async function BankStatementsPage() {
  const user = await requireAuthenticatedUser();
  if (user.org_type !== 'STARTUP' || (user.role !== 'FIN' && user.role !== 'FDR')) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <a href="/dashboard" className="text-sm font-semibold text-slate-700 hover:text-slate-950">
          ← Back to dashboard
        </a>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">
          Workspace finance
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Bank statement imports</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Import CAMT.053 XML statements into a private review queue. Importing does not reconcile
          transactions or post journal entries.
        </p>
        <BankStatementsPanel />
      </div>
    </main>
  );
}
