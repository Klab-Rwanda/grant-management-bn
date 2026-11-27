import Link from 'next/link';
import LoginForm from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8f5] px-5 py-12 text-slate-900">
      <div className="w-full max-w-md">
        <Link className="mb-8 inline-flex items-center gap-2 font-semibold tracking-tight" href="/">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
            G
          </span>
          grantledger
        </Link>
        <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-900/5 sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
            Secure workspace access
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Sign in to Grant Ledger</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use the email and password associated with your workspace invitation.
          </p>
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
