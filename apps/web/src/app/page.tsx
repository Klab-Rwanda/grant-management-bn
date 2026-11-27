import type { ReactNode } from 'react';

type IconName = 'ledger' | 'shield' | 'milestone' | 'arrow' | 'check' | 'spark';

function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    ledger: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h3M16 15h.01" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    milestone: (
      <>
        <path d="M3 12h18M12 3v18" />
        <circle cx="12" cy="12" r="8" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    arrow: <path d="M7 17 17 7M7 7h10v10" />,
    check: <path d="m5 12 4 4L19 6" />,
    spark: (
      <>
        <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" />
        <path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a
      aria-label="Grant Ledger home"
      className={`inline-flex items-center gap-2.5 font-semibold tracking-tight ${
        inverse ? 'text-white' : 'text-slate-950'
      }`}
      href="#top"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-950/10">
        <Icon name="ledger" className="h-5 w-5" />
      </span>
      <span className="text-lg">grantledger</span>
    </a>
  );
}

const features: {
  icon: IconName;
  title: string;
  description: string;
  color: string;
}[] = [
  {
    icon: 'ledger',
    title: 'A ledger you can trust',
    description:
      'Keep the books clear with balanced entries, a startup-ready chart of accounts, and financial reports grounded in exact decimal arithmetic.',
    color: 'bg-emerald-50 text-emerald-700',
  },
  {
    icon: 'milestone',
    title: 'Grants with a clear trail',
    description:
      'Connect funding, budgets, and milestones so teams can understand what is allocated, what is spent, and what needs attention.',
    color: 'bg-sky-50 text-sky-700',
  },
  {
    icon: 'shield',
    title: 'Accountability built in',
    description:
      'Use role-aware access, tenant isolation, and tamper-evident audit records to support more confident financial oversight.',
    color: 'bg-violet-50 text-violet-700',
  },
];

export default function HomePage() {
  return (
    <main id="top" className="overflow-hidden bg-[#f7f8f5] text-slate-900">
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Brand />
        <nav aria-label="Main navigation" className="hidden items-center gap-8 md:flex">
          <a className="text-sm text-slate-600 transition hover:text-slate-950" href="#platform">
            Platform
          </a>
          <a className="text-sm text-slate-600 transition hover:text-slate-950" href="#teams">
            Who it’s for
          </a>
          <a className="text-sm text-slate-600 transition hover:text-slate-950" href="#approach">
            Our approach
          </a>
        </nav>
        <a
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          href="/login"
        >
          Sign in
          <Icon name="arrow" className="h-4 w-4" />
        </a>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-12 sm:px-8 sm:pb-28 sm:pt-16 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:px-12 lg:pb-32 lg:pt-20">
        <div className="pointer-events-none absolute -left-48 top-0 h-[34rem] w-[34rem] rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="relative z-10 max-w-2xl">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/80 px-3.5 py-2 text-xs font-semibold tracking-wide text-emerald-800 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            STARTUP FINANCE, BUILT FOR GRANTS
          </div>
          <h1 className="max-w-xl text-[3.25rem] font-semibold leading-[1.05] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-[4.35rem]">
            Good funding deserves <span className="text-emerald-700">good records.</span>
          </h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Bring startup accounting and grant oversight into one clearer picture. Track the money,
            connect it to the work, and make every decision easier to explain.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              href="#platform"
            >
              Discover the platform
              <Icon name="arrow" className="h-4 w-4" />
            </a>
            <a
              className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white/80 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              href="#approach"
            >
              How it works
            </a>
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-medium text-slate-500">
            <span className="inline-flex items-center gap-2">
              <Icon name="check" className="h-4 w-4 text-emerald-600" />
              Double-entry foundations
            </span>
            <span className="inline-flex items-center gap-2">
              <Icon name="check" className="h-4 w-4 text-emerald-600" />
              Role-aware by design
            </span>
          </div>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[610px] lg:ml-auto">
          <div className="absolute -right-7 -top-8 h-36 w-36 rounded-full border border-emerald-200/70" />
          <div className="absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-amber-200/50 blur-2xl" />
          <div className="relative rounded-[1.75rem] border border-white/80 bg-white p-3 shadow-[0_32px_90px_-35px_rgba(15,23,42,0.28)] sm:p-4">
            <div className="overflow-hidden rounded-[1.2rem] bg-[#101c1b] text-white">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                    <Icon name="ledger" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Workspace overview</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Illustrative product preview
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-medium text-emerald-200">
                  STARTUP
                </span>
              </div>

              <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <p className="text-xs text-slate-400">Cash position</p>
                  <div className="mt-2 flex items-end justify-between">
                    <p className="text-2xl font-semibold tracking-tight">$84,250</p>
                    <span className="mb-1 text-[10px] text-emerald-300">Example</span>
                  </div>
                  <div
                    className="mt-5 flex h-12 items-end gap-1.5"
                    aria-label="Illustrative cash trend"
                  >
                    {[28, 42, 34, 55, 47, 68, 57, 78, 64, 88, 72, 96].map((height, index) => (
                      <span
                        key={index}
                        className={`flex-1 rounded-t-sm ${
                          index > 8 ? 'bg-emerald-400' : 'bg-emerald-400/35'
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <p className="text-xs text-slate-400">Grant allocation</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">$120,000</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-[62%] rounded-full bg-emerald-400" />
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-slate-400">
                    <span>Illustrative progress</span>
                    <span>62%</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 sm:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-300">Recent activity</p>
                    <span className="text-[10px] text-slate-500">Example data</span>
                  </div>
                  <div className="space-y-3">
                    {[
                      {
                        title: 'Cloud infrastructure',
                        detail: 'Ledger entry · Operating costs',
                        amount: '−$1,240',
                      },
                      {
                        title: 'Milestone report',
                        detail: 'Grant update · Submitted for review',
                        amount: 'In review',
                      },
                    ].map((item) => (
                      <div className="flex items-center gap-3" key={item.title}>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-emerald-300">
                          <Icon name="check" className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-white">{item.title}</p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-400">
                            {item.detail}
                          </p>
                        </div>
                        <span className="whitespace-nowrap text-[10px] font-medium text-slate-300">
                          {item.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-[10px] text-slate-400 sm:px-6">
                <Icon name="shield" className="h-3.5 w-3.5 text-emerald-300" />A clearer view for
                the people responsible for every dollar.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Platform principles"
        className="border-y border-slate-200/80 bg-white/70"
      >
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-5 py-7 sm:px-8 md:grid-cols-4 lg:px-12">
          {[
            'Balanced books',
            'Grant visibility',
            'Clear accountability',
            'Audit-ready records',
          ].map((item) => (
            <div
              className="flex items-center justify-center gap-2 text-center text-xs font-semibold text-slate-600 sm:text-sm"
              key={item}
            >
              <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-600" />
              {item}
            </div>
          ))}
        </div>
      </section>

      <section id="platform" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            One connected foundation
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">
            Financial clarity at every step.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            A shared financial picture starts with sound records, thoughtful controls, and a
            transparent connection between funding and outcomes.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {features.map((feature, index) => (
            <article
              className="group rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/5 sm:p-7"
              key={feature.title}
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl ${feature.color}`}
              >
                <Icon name={feature.icon} className="h-6 w-6" />
              </div>
              <p className="mt-7 text-xs font-semibold uppercase tracking-wider text-slate-400">
                0{index + 1}
              </p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
                {feature.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="teams" className="bg-[#eaf0e9]">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:px-12">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-800">
              Built around collaboration
            </p>
            <h2 className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-4xl">
              Different responsibilities. A shared commitment to clarity.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-slate-600">
              Startups and funding institutions need different views of the work. Grant Ledger is
              designed to respect those boundaries while making the shared grant story easier to
              follow.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-3xl border border-white bg-white/90 p-6 shadow-sm sm:p-7">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-800">
                  STARTUP WORKSPACE
                </span>
                <Icon name="spark" className="h-5 w-5 text-emerald-700" />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-slate-900">
                Stay on top of the books.
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Give founders, finance leads, and operations teams a consistent place to understand
                activity, track budgets, and prepare clear updates.
              </p>
              <p className="mt-5 border-t border-slate-100 pt-4 text-xs font-medium text-slate-500">
                Founder · Finance · Operations
              </p>
            </article>
            <article className="rounded-3xl border border-white bg-white/90 p-6 shadow-sm sm:p-7">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold text-sky-800">
                  INSTITUTION WORKSPACE
                </span>
                <Icon name="shield" className="h-5 w-5 text-sky-700" />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-slate-900">
                Make oversight transparent.
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Support program managers, reviewers, and approvers with a more structured view of
                grant budgets, evidence, and decisions.
              </p>
              <p className="mt-5 border-t border-slate-100 pt-4 text-xs font-medium text-slate-500">
                Program Manager · Reviewer · Approver
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="approach" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-12 text-white sm:px-12 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-emerald-200">
                <Icon name="shield" className="h-4 w-4" />
                Clarity without compromising control
              </div>
              <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
                Funding should move forward with confidence.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">
                Build a stronger financial foundation for startups and a more accountable grant
                experience for the institutions that support them.
              </p>
            </div>
            <a
              className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-slate-950"
              href="#top"
            >
              Back to top
              <Icon name="arrow" className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <Brand />
          <p className="text-xs text-slate-500">
            Startup accounting and grant management, built for clarity.
          </p>
        </div>
      </footer>
    </main>
  );
}
