'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface Workspace {
  id: string;
  legal_name: string;
  org_type: string;
  country: string;
  functional_currency: string;
  status: string;
  created_at: string;
  memberships: { active: number; invited: number; suspended: number };
}

interface Membership {
  id: string;
  tenant_id: string;
  role: string;
  status: string;
  email: string;
  full_name: string;
  user_status: string;
  legal_name: string;
  org_type: string;
  workspace_status: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  legal_name: string;
}

interface AuditEvent {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  legal_name: string;
}

interface StatementImport {
  id: string;
  legal_name: string;
  statement_format: string;
  status: string;
  transaction_count: number;
  created_at: string;
}

interface Analytics {
  workspace_count: number;
  workspaces_by_type: Record<string, number>;
  workspaces_by_status: Record<string, number>;
  grant_count: number;
  grants_by_status: Record<string, number>;
}

interface AdminData {
  workspaces: Workspace[];
  memberships: Membership[];
  invitations: Invitation[];
  auditEvents: AuditEvent[];
  imports: StatementImport[];
  analytics: Analytics | null;
}

const emptyData: AdminData = {
  workspaces: [],
  memberships: [],
  invitations: [],
  auditEvents: [],
  imports: [],
  analytics: null,
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : `Request failed (HTTP ${response.status})`;
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'invitation_url' in payload &&
      typeof payload.invitation_url === 'string'
    ) {
      message = `${message} ${payload.invitation_url}`;
    }
    throw new Error(message);
  }
  return payload as T;
}

export default function AdminConsole() {
  const [data, setData] = useState<AdminData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [auditAction, setAuditAction] = useState('');
  const [auditWorkspace, setAuditWorkspace] = useState('');
  const [auditSubmitted, setAuditSubmitted] = useState({ action: '', workspace: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workspaces, membershipData, auditEvents, analytics, imports] = await Promise.all([
        requestJson<Workspace[]>('/api/admin/workspaces'),
        requestJson<{ memberships: Membership[]; invitations: Invitation[] }>(
          '/api/admin/memberships',
        ),
        requestJson<AuditEvent[]>('/api/admin/audit-events?limit=100'),
        requestJson<Analytics>('/api/admin/analytics'),
        requestJson<StatementImport[]>('/api/admin/integrations/bank-statement-imports'),
      ]);
      setData({
        workspaces,
        memberships: membershipData.memberships,
        invitations: membershipData.invitations,
        auditEvents,
        analytics,
        imports,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load platform administration data.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(
    action: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The requested action failed.');
      return false;
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = {
      legal_name: String(form.get('legal_name') ?? ''),
      org_type: String(form.get('org_type') ?? ''),
      country: String(form.get('country') ?? ''),
      functional_currency: String(form.get('functional_currency') ?? ''),
      fiscal_year_start_month: Number(form.get('fiscal_year_start_month')),
      initial_admin_email: String(form.get('initial_admin_email') ?? ''),
      tax_id: String(form.get('tax_id') ?? ''),
    };
    const created = await runAction(
      () =>
        requestJson('/api/admin/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      'Workspace created and first-administrator invitation sent.',
    );
    if (created) formElement.reset();
  }

  async function applyAuditFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuditSubmitted({ action: auditAction, workspace: auditWorkspace });
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (auditAction) params.set('action', auditAction);
      if (auditWorkspace) params.set('workspace_id', auditWorkspace);
      const auditEvents = await requestJson<AuditEvent[]>(`/api/admin/audit-events?${params}`);
      setData((current) => ({ ...current, auditEvents }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search audit events.');
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500">Loading live administration data…</p>}

      <section id="workspaces" aria-labelledby="workspaces-heading" className="scroll-mt-6">
        <div className="mb-4">
          <h2 id="workspaces-heading" className="text-xl font-semibold">
            Workspaces
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Provision startup or institution accounts. First admins receive a 24-hour invitation.
          </p>
        </div>
        <form
          onSubmit={(event) => void createWorkspace(event)}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="text-sm font-medium">
            Legal name
            <input
              name="legal_name"
              required
              minLength={2}
              maxLength={200}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Workspace type
            <select
              name="org_type"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
            >
              <option value="STARTUP">Startup</option>
              <option value="INSTITUTION">Institution</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Country (ISO 3166-1 alpha-2)
            <input
              name="country"
              required
              pattern="[A-Za-z]{2}"
              maxLength={2}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Functional currency
            <input
              name="functional_currency"
              required
              pattern="[A-Za-z]{3}"
              maxLength={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Fiscal-year start month
            <select
              name="fiscal_year_start_month"
              defaultValue="1"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            First admin email
            <input
              name="initial_admin_email"
              type="email"
              required
              maxLength={254}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Tax ID (optional)
            <input
              name="tax_id"
              maxLength={100}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Create workspace
            </button>
          </div>
        </form>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Country / currency</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <td className="px-4 py-3 font-medium">{workspace.legal_name}</td>
                  <td className="px-4 py-3">{workspace.org_type}</td>
                  <td className="px-4 py-3">
                    {workspace.country} · {workspace.functional_currency}
                  </td>
                  <td className="px-4 py-3">
                    {workspace.memberships.active} active / {workspace.memberships.invited} invited
                  </td>
                  <td className="px-4 py-3">{workspace.status}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () =>
                            requestJson(`/api/admin/workspaces/${workspace.id}/status`, {
                              method: 'PATCH',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                status: workspace.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                              }),
                            }),
                          `Workspace ${workspace.status === 'ACTIVE' ? 'suspended' : 'reactivated'}.`,
                        )
                      }
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
                    >
                      {workspace.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && data.workspaces.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No workspaces found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="access" aria-labelledby="access-heading" className="scroll-mt-6">
        <div className="mb-4">
          <h2 id="access-heading" className="text-xl font-semibold">
            Users and access
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Suspend or reactivate workspace memberships. Global user accounts are not modified.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Membership</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.memberships.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-3">
                    <span className="block font-medium">{member.full_name}</span>
                    <span className="text-xs text-slate-500">{member.email}</span>
                  </td>
                  <td className="px-4 py-3">{member.legal_name}</td>
                  <td className="px-4 py-3">{member.role}</td>
                  <td className="px-4 py-3">
                    {member.status} · account {member.user_status}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={member.status === 'INVITED'}
                      onClick={() =>
                        void runAction(
                          () =>
                            requestJson(`/api/admin/memberships/${member.id}/status`, {
                              method: 'PATCH',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                status: member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                              }),
                            }),
                          `Membership ${member.status === 'ACTIVE' ? 'suspended' : 'reactivated'}.`,
                        )
                      }
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {member.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && data.memberships.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No workspace memberships found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {data.invitations.length > 0 && (
            <div className="border-t border-slate-200 px-4 py-4">
              <h3 className="font-semibold">Recent invitations</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {data.invitations.slice(0, 10).map((invitation) => (
                  <li key={invitation.id}>
                    {invitation.email} · {invitation.role} · {invitation.legal_name} ·{' '}
                    {invitation.accepted_at
                      ? 'accepted'
                      : `expires ${new Date(invitation.expires_at).toLocaleString()}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section id="audit" aria-labelledby="audit-heading" className="scroll-mt-6">
        <div className="mb-4">
          <h2 id="audit-heading" className="text-xl font-semibold">
            Audit event review
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Platform-wide event metadata only. Before/after state and private tenant data are
            excluded.
          </p>
        </div>
        <form
          onSubmit={(event) => void applyAuditFilters(event)}
          className="mb-3 flex flex-wrap gap-2"
        >
          <select
            value={auditWorkspace}
            onChange={(event) => setAuditWorkspace(event.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All workspaces</option>
            {data.workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.legal_name}
              </option>
            ))}
          </select>
          <input
            value={auditAction}
            onChange={(event) => setAuditAction(event.target.value)}
            placeholder="Exact action name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-white"
          >
            Search
          </button>
          <span className="self-center text-xs text-slate-500">
            {auditSubmitted.action || auditSubmitted.workspace
              ? 'Filtered results'
              : 'Latest 100 events'}
          </span>
        </form>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Event ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.auditEvents.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap px-4 py-3">
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{event.legal_name}</td>
                  <td className="px-4 py-3">{event.actor_id ?? event.actor_type}</td>
                  <td className="px-4 py-3 font-medium">{event.action}</td>
                  <td className="px-4 py-3">
                    {event.entity_type}
                    {event.entity_id ? ` · ${event.entity_id}` : ''}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{event.id}</td>
                </tr>
              ))}
              {!loading && data.auditEvents.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No audit events match the filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="analytics" aria-labelledby="analytics-heading" className="scroll-mt-6">
        <div className="mb-4">
          <h2 id="analytics-heading" className="text-xl font-semibold">
            Portfolio analytics
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Counts only; no cross-tenant financial totals or currency conversion.
          </p>
        </div>
        {data.analytics && (
          <div className="grid gap-4 sm:grid-cols-2">
            <CountCard
              title="Workspaces"
              total={data.analytics.workspace_count}
              breakdown={data.analytics.workspaces_by_type}
            />
            <CountCard
              title="Workspace status"
              total={undefined}
              breakdown={data.analytics.workspaces_by_status}
            />
            <CountCard
              title="Grants"
              total={data.analytics.grant_count}
              breakdown={data.analytics.grants_by_status}
            />
          </div>
        )}
      </section>

      <section id="integrations" aria-labelledby="integrations-heading" className="scroll-mt-6">
        <div className="mb-4">
          <h2 id="integrations-heading" className="text-xl font-semibold">
            Bank statement imports
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            CAMT.053 imports are tenant-owned and staged for review. Importing never posts a journal
            entry.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Import ID</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Transactions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Imported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.imports.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.legal_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.id}</td>
                  <td className="px-4 py-3">{item.statement_format}</td>
                  <td className="px-4 py-3">{item.transaction_count}</td>
                  <td className="px-4 py-3">{item.status}</td>
                  <td className="px-4 py-3">{new Date(item.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {!loading && data.imports.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No statement imports have been recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CountCard({
  title,
  total,
  breakdown,
}: {
  title: string;
  total?: number;
  breakdown: Record<string, number>;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-medium text-slate-600">{title}</h3>
      {total !== undefined && <p className="mt-1 text-2xl font-semibold">{total}</p>}
      <ul className="mt-3 space-y-1 text-sm text-slate-600">
        {Object.entries(breakdown).length === 0 ? (
          <li>No records</li>
        ) : (
          Object.entries(breakdown).map(([label, count]) => (
            <li className="flex justify-between gap-4" key={label}>
              <span>{label}</span>
              <span className="font-medium tabular-nums">{count}</span>
            </li>
          ))
        )}
      </ul>
    </article>
  );
}
