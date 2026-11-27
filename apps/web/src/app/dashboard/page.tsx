import type { ReactNode } from 'react';
import AdminDashboard from './admin-dashboard';
import { requireAuthenticatedUser } from '../../lib/auth-session';

type DashboardIconName = 'grid' | 'bell' | 'chevron' | 'warning' | 'lock' | 'check' | 'clock';

function DashboardIcon({
  name,
  className = 'h-4 w-4',
}: {
  name: DashboardIconName;
  className?: string;
}) {
  const paths: Record<DashboardIconName, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    chevron: <path d="m6 9 6 6 6-6" />,
    warning: (
      <>
        <path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4m0 4h.01" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
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

const navigation = [
  {
    heading: 'ACCOUNTING',
    links: [
      { label: 'Chart of accounts', href: '#transactions' },
      { label: 'Journal entries', href: '#transactions' },
      { label: 'General ledger', href: '#transactions' },
      { label: 'Reports', href: '#metrics' },
      { label: 'Burn & runway', href: '#metrics' },
      { label: 'Budget vs actuals', href: '#budget-use' },
    ],
  },
  {
    heading: 'OPERATIONS',
    links: [
      { label: 'Activity log', href: '#tasks' },
      { label: 'Bank statements', href: '/dashboard/bank-statements' },
    ],
  },
  {
    heading: 'GRANTS',
    links: [
      { label: 'My grants', href: '/dashboard/grants' },
      { label: 'Tranche workspace', href: '/dashboard/grants' },
      { label: 'Evidence vault', href: '#tasks' },
    ],
  },
  {
    heading: 'WORKSPACE',
    links: [
      { label: 'Notifications', href: '#tasks', badge: '4' },
      { label: 'Audit log', href: '#transactions' },
      { label: 'Team & roles', href: '#workspace' },
    ],
  },
];

const transactions = [
  {
    date: '31 Oct',
    description: 'October payroll — R&D',
    account: '6010 R&D Personnel',
    amount: '9,600.00',
    tag: 'T2 · R&D Personnel',
  },
  {
    date: '28 Oct',
    description: 'Soil probes batch #4',
    account: '1500 Equipment',
    amount: '4,120.00',
    tag: 'T2 · Equipment',
  },
  {
    date: '27 Oct',
    description: 'Cloud hosting',
    account: '6100 Cloud Infrastructure',
    amount: '412.18',
    tag: 'Not tagged',
  },
  {
    date: '25 Oct',
    description: 'Subscription receipts',
    account: '4100 Subscription revenue',
    amount: '2,950.00',
    tag: '—',
  },
];

function StatusPill({
  children,
  color = 'slate',
}: {
  children: ReactNode;
  color?: 'green' | 'teal' | 'slate' | 'red' | 'amber' | 'blue';
}) {
  const colors = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    teal: 'border-teal-200 bg-teal-50 text-teal-800',
    slate: 'border-slate-200 bg-slate-100 text-slate-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
  };

  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold leading-4 ${colors[color]}`}
    >
      {children}
    </span>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-lg border border-[#e7e2d9] bg-white px-3.5 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] sm:px-4">
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
      <p className="mt-1.5 font-serif text-[21px] font-semibold leading-none tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-2 text-[9px] leading-4 text-slate-500">{detail}</p>
    </article>
  );
}

function BudgetBar({
  label,
  used,
  total,
  width,
  over = false,
}: {
  label: string;
  used: string;
  total: string;
  width: string;
  over?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[9px]">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="whitespace-nowrap text-slate-500">
          {over && <StatusPill color="red">Over cap</StatusPill>}
          {used} / {total}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e8e5de]">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-600' : 'bg-teal-700'}`}
          style={{ width }}
        />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  if (user.role === 'ADM') {
    return <AdminDashboard user={user} />;
  }

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <main className="min-h-screen bg-[#f7f5f0] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-[140px] shrink-0 border-r border-[#e5e1d8] bg-[#f0eee7] md:flex md:flex-col">
          <a
            href="/"
            className="flex h-[54px] items-center gap-2 border-b border-[#e5e1d8] px-2.5 text-[12px] font-bold tracking-tight text-slate-900"
          >
            <span className="flex h-[17px] w-[17px] items-center justify-center rounded bg-slate-900 text-[9px] font-bold text-white">
              G
            </span>
            Grant Ledger
          </a>
          <div className="mx-2.5 mt-2.5 flex items-center gap-2 rounded-md border border-[#e3dfd6] bg-white px-1.5 py-1.5">
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-[#dcece7] text-[8px] font-bold text-teal-800">
              GL
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[9px] font-semibold">
                {user.org_type} workspace
              </span>
              <span className="block text-[8px] text-slate-500">{user.role} access</span>
            </span>
            <DashboardIcon name="chevron" className="h-3 w-3 shrink-0 text-slate-400" />
          </div>
          <nav aria-label="Dashboard navigation" className="mt-2 px-1">
            <a
              className="flex items-center rounded-md border-l-2 border-teal-700 bg-white px-1.5 py-1.5 text-[10px] font-semibold text-slate-900 shadow-sm"
              href="/dashboard"
            >
              <DashboardIcon name="grid" className="mr-1.5 h-3 w-3 text-teal-700" />
              Dashboard
            </a>
            {navigation.map((group) => (
              <div className="mt-3" key={group.heading}>
                <p className="px-1.5 text-[8px] font-semibold tracking-[0.12em] text-slate-500">
                  {group.heading}
                </p>
                <div className="mt-1 space-y-0.5">
                  {group.links
                    .filter(
                      (link) =>
                        link.href !== '/dashboard/bank-statements' ||
                        (user.org_type === 'STARTUP' &&
                          (user.role === 'FIN' || user.role === 'FDR')),
                    )
                    .map((link) => (
                      <a
                        className="flex min-h-6 items-center justify-between rounded px-1.5 text-[9px] text-slate-700 transition hover:bg-white/80 hover:text-slate-950"
                        href={link.href}
                        key={link.label}
                      >
                        <span>{link.label}</span>
                        {link.badge && (
                          <span className="rounded-full bg-[#eee8d7] px-1.5 py-0.5 text-[8px] font-semibold text-amber-800">
                            {link.badge}
                          </span>
                        )}
                      </a>
                    ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto border-t border-[#e5e1d8] px-2.5 py-3 text-[8px] leading-4 text-slate-500">
            Demo workspace
            <br />
            Sample data only
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex h-[54px] items-center justify-between border-b border-[#e5e1d8] bg-white px-4 sm:px-5 lg:px-7">
            <div className="flex items-center gap-2">
              <a className="flex items-center gap-1.5 text-xs font-bold md:hidden" href="/">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-900 text-[9px] text-white">
                  G
                </span>
                Grant Ledger
              </a>
              <span className="hidden text-[10px] font-medium text-slate-700 md:inline">
                Dashboard
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[8px] font-bold tracking-wide text-amber-800">
                SAMPLE DATA
              </span>
              <a
                aria-label="View tasks and notifications"
                className="relative flex h-7 w-7 items-center justify-center rounded-md border border-[#e5e1d8] text-slate-700 hover:bg-slate-50"
                href="#tasks"
              >
                <DashboardIcon name="bell" className="h-3.5 w-3.5" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-white" />
              </a>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[8px] font-bold text-white">
                {initials}
              </span>
              <span className="hidden max-w-36 truncate text-[9px] font-semibold sm:inline">
                {user.email}
              </span>
              <span className="hidden rounded-full border border-slate-300 px-1.5 py-0.5 text-[8px] font-medium text-slate-600 sm:inline">
                {user.role}
              </span>
              <form action="/api/auth/logout" method="post">
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-[9px] font-medium text-slate-700 hover:bg-slate-50"
                  type="submit"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-4 pb-8 pt-4 sm:px-5 lg:px-7">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h1 className="font-serif text-[23px] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[25px]">
                  Good morning, Amani
                </h1>
                <p className="mt-1 text-[9px] text-slate-500">
                  Books closed through 31 Oct 2026 · Functional currency USD
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  className="rounded-md border border-[#d8d2c7] bg-white px-3 py-2 text-[9px] font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                  href="#tasks"
                >
                  Upload receipt
                </a>
                <a
                  className="rounded-md bg-teal-800 px-3 py-2 text-[9px] font-semibold text-white shadow-sm transition hover:bg-teal-900"
                  href="#transactions"
                >
                  New journal entry
                </a>
              </div>
            </div>

            <section
              aria-label="Grant submission alert"
              className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#e8c98d] bg-[#fff4dc] px-3 py-2"
            >
              <div className="flex min-w-0 items-start gap-2">
                <DashboardIcon
                  name="warning"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-800"
                />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-slate-800">
                    Tranche 2 can’t be submitted yet: 3 readiness issues
                  </p>
                  <p className="text-[8px] leading-3.5 text-slate-600">
                    Equipment is over its cap, 2 line items have no receipt, and the Milestone M-3
                    deliverable is missing.
                  </p>
                </div>
              </div>
              <a
                className="shrink-0 rounded-md border border-[#d8c49d] bg-white px-2.5 py-1.5 text-[8px] font-semibold text-slate-800 hover:bg-amber-50"
                href="#tasks"
              >
                Fix issues
              </a>
            </section>

            <section
              id="metrics"
              aria-label="Financial summary"
              className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              <MetricCard label="Cash on hand" value="$89,600.55" detail="Bank + mobile money" />
              <MetricCard label="Net burn (3-mo avg)" value="$9,806.67" detail="per month" />
              <MetricCard label="Runway" value="9.1 mo" detail="At current net burn" />
              <MetricCard
                label="Grant funds to claim"
                value="$48,200.00"
                detail="Tagged to Tranche 2 of $50,000"
              />
            </section>

            <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1.8fr)_minmax(180px,0.82fr)]">
              <div className="min-w-0 space-y-3">
                <section
                  id="active-grant"
                  className="rounded-lg border border-[#e7e2d9] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] sm:p-4"
                >
                  <h2 className="text-[12px] font-semibold tracking-tight text-slate-900">
                    Active grant · Climate-Smart Agriculture Accelerator 2026
                  </h2>
                  <a
                    className="mt-1 inline-block text-[9px] font-medium text-teal-800 underline underline-offset-2"
                    href="#active-grant"
                  >
                    Open grant
                  </a>
                  <p className="mt-1 text-[8px] text-slate-500">
                    Riverbend Innovation Trust · Award $120,000.00 · 3 tranches
                  </p>

                  <div className="mt-2 overflow-hidden rounded-md border border-[#e7e2d9]">
                    <div className="grid grid-cols-[0.8fr_0.75fr_1.2fr_1.3fr] gap-1 bg-[#f1efe9] px-2 py-2 text-[8px] font-semibold text-slate-600 sm:px-2.5">
                      <span>Tranche</span>
                      <span>Amount</span>
                      <span>Status</span>
                      <span>Next step</span>
                    </div>
                    <div className="divide-y divide-[#eeeae2]">
                      <div className="grid min-h-10 grid-cols-[0.8fr_0.75fr_1.2fr_1.3fr] items-center gap-1 px-2 py-1.5 text-[8px] sm:px-2.5">
                        <span className="font-medium">Tranche 1</span>
                        <span className="text-slate-600">40,000.00</span>
                        <StatusPill color="green">
                          <DashboardIcon name="check" className="h-2.5 w-2.5" />
                          Disbursed &amp; reconciled
                        </StatusPill>
                        <span className="text-slate-500">Closed 18 Jul 2026</span>
                      </div>
                      <div className="grid min-h-10 grid-cols-[0.8fr_0.75fr_1.2fr_1.3fr] items-center gap-1 bg-[#edf6f3] px-2 py-1.5 text-[8px] sm:px-2.5">
                        <span className="font-semibold">Tranche 2</span>
                        <span className="text-slate-700">50,000.00</span>
                        <StatusPill color="teal">
                          <span className="h-1.5 w-1.5 rounded-full bg-teal-700" />
                          Active · Draft
                        </StatusPill>
                        <a
                          className="font-semibold text-teal-800 underline underline-offset-2"
                          href="#tasks"
                        >
                          Resolve 3 readiness issues
                        </a>
                      </div>
                      <div className="grid min-h-10 grid-cols-[0.8fr_0.75fr_1.2fr_1.3fr] items-center gap-1 px-2 py-1.5 text-[8px] sm:px-2.5">
                        <span className="font-medium">Tranche 3</span>
                        <span className="text-slate-600">30,000.00</span>
                        <StatusPill>
                          <DashboardIcon name="lock" className="h-2.5 w-2.5" />
                          Locked
                        </StatusPill>
                        <span className="text-slate-500">Needs T2 reconciled + M-4 verified</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  id="transactions"
                  className="rounded-lg border border-[#e7e2d9] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] sm:p-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-[12px] font-semibold tracking-tight text-slate-900">
                      Recent transactions
                    </h2>
                    <a
                      className="text-[8px] font-semibold text-teal-800 underline underline-offset-2"
                      href="#transactions"
                    >
                      General ledger
                    </a>
                  </div>
                  <div className="mt-2 overflow-x-auto rounded-md border border-[#e7e2d9]">
                    <table className="w-full min-w-[400px] table-fixed border-collapse text-left text-[8px]">
                      <thead className="bg-[#f1efe9] text-slate-600">
                        <tr>
                          <th className="w-[11%] px-2 py-2 font-semibold">Date</th>
                          <th className="w-[25%] px-2 py-2 font-semibold">Description</th>
                          <th className="w-[24%] px-2 py-2 font-semibold">Account</th>
                          <th className="w-[16%] px-2 py-2 text-right font-semibold">USD</th>
                          <th className="w-[24%] px-2 py-2 font-semibold">Grant tag</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#eeeae2]">
                        {transactions.map((transaction) => (
                          <tr className="text-slate-700" key={transaction.description}>
                            <td className="px-2 py-2 align-top text-slate-500">
                              {transaction.date}
                            </td>
                            <td className="px-2 py-2 align-top">{transaction.description}</td>
                            <td className="px-2 py-2 align-top">{transaction.account}</td>
                            <td className="px-2 py-2 text-right align-top tabular-nums">
                              {transaction.amount}
                            </td>
                            <td className="px-2 py-2 align-top">
                              {transaction.tag === 'Not tagged' ? (
                                <span className="text-slate-500">Not tagged</span>
                              ) : transaction.tag === '—' ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <span className="inline-block rounded bg-[#f0eee8] px-1.5 py-1 text-[7px] text-slate-600">
                                  {transaction.tag}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="min-w-0 space-y-3">
                <section
                  id="tasks"
                  className="rounded-lg border border-[#e7e2d9] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] sm:p-4"
                >
                  <h2 className="text-[11px] font-semibold tracking-tight text-slate-900">
                    Your tasks
                  </h2>
                  <ul className="mt-2.5 space-y-2.5">
                    <li className="flex items-start gap-2">
                      <StatusPill color="red">Blocked</StatusPill>
                      <span className="text-[8px] leading-3.5 text-slate-600">
                        Equipment over cap by $1,380.00 (T2)
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <StatusPill color="amber">Missing</StatusPill>
                      <span className="text-[8px] leading-3.5 text-slate-600">
                        2 receipts for T2 line items
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <StatusPill color="amber">Missing</StatusPill>
                      <span className="text-[8px] leading-3.5 text-slate-600">
                        M-3 deliverable owner: Joel K.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <StatusPill color="blue">Review</StatusPill>
                      <span className="text-[8px] leading-3.5 text-slate-600">
                        6 OCR receipts waiting for confirmation
                      </span>
                    </li>
                  </ul>
                </section>

                <section
                  id="budget-use"
                  className="rounded-lg border border-[#e7e2d9] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] sm:p-4"
                >
                  <h2 className="text-[11px] font-semibold tracking-tight text-slate-900">
                    Tranche 2 budget use
                  </h2>
                  <div className="mt-3 space-y-3">
                    <BudgetBar label="R&D Personnel" used="27,400" total="30,000" width="91%" />
                    <BudgetBar label="Equipment" used="13,880" total="12,500" width="100%" over />
                    <BudgetBar label="Contractors" used="6,920" total="7,500" width="92%" />
                  </div>
                </section>
              </div>
            </div>
            <p id="workspace" className="mt-4 text-center text-[8px] text-slate-400">
              Demonstration dashboard · All names, balances, transactions, and statuses are sample
              data.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
