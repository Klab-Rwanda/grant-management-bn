'use client';

import type { AuthUserContext } from '@grant-ledger/shared';
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface Program {
  id: string;
  title: string;
  total_pool_amount: string;
  currency: string;
  status: string;
}

interface Startup {
  id: string;
  legal_name: string;
  country: string;
  functional_currency: string;
}

interface Evidence {
  document_id: string;
  doc_type: string;
  sha256: string | null;
  size_bytes: string;
  created_at: string;
}

interface BudgetLine {
  id: string;
  category_code: string;
  category_name: string;
  cap_amount: string;
  cap_percentage: string | null;
  variance_tolerance_pct: string;
}

interface Milestone {
  id: string;
  code: string;
  title: string;
  due_date: string;
  deliverable_required: boolean;
  completion_status: string;
}

interface SubmissionSummary {
  id: string;
  version_number: number;
  status: string;
  total_claimable_amount: string;
  submitted_at: string;
}

interface Disbursement {
  id: string;
  submission_id: string | null;
  status: string;
  bank_reference: string | null;
  paid_date: string | null;
  amount_paid: string | null;
  currency: string;
  fx_rate: string;
  confirmation_evidence_doc_id: string | null;
}

interface Tranche {
  id: string;
  sequence_order: number;
  amount: string;
  currency: string;
  availability_status: string;
  review_status: string;
  budget_lines: BudgetLine[];
  milestones: Milestone[];
  submissions: SubmissionSummary[];
  disbursements: Disbursement[];
}

interface Grant {
  id: string;
  title: string;
  status: string;
  awarded_amount: string;
  currency: string;
  institution_name: string;
  startup_name: string;
  tranches: Tranche[];
}

interface JournalLine {
  id: string;
  entry_date: string;
  memo: string;
  account_code: string;
  account_name: string;
  account_type: string;
  amount_functional: string;
  functional_currency: string;
  remaining_functional_amount: string;
}

interface Allocation {
  allocation_id: string;
  journal_line_id: string;
  tranche_budget_line_id: string;
  allocated_amount: string;
  fx_rate_to_grant: string | null;
  converted_amount: string | null;
  status: string;
  category_name: string;
  transaction_date: string;
  memo: string;
  evidence: Evidence[];
}

interface Readiness {
  ready: boolean;
  total_claimable_amount: string;
  currency: string;
  blockers: Array<{ code: string; message: string; entity_id?: string }>;
}

interface SubmissionItem {
  id: string;
  line_item_allocation_id: string;
  category_name: string;
  allocated_amount: string;
  functional_amount: string | null;
  functional_currency: string | null;
  fx_rate_to_grant: string | null;
  transaction_date: string;
  line_memo: string;
  carried_forward_approval: boolean;
  evidence_snapshot: Evidence[];
  decision: { decision: string; reason_code: string | null; comment: string | null } | null;
}

interface MilestoneSnapshot {
  milestone_id: string;
  code: string;
  title: string;
  due_date: string;
  deliverable_required: boolean;
  evidence: Evidence[];
  decision: { decision: string; reason_code: string | null; notes: string | null } | null;
}

interface Submission {
  id: string;
  status: string;
  total_claimable_amount: string;
  items: SubmissionItem[];
  milestone_snapshot: MilestoneSnapshot[];
}

interface UploadedDocument {
  id: string;
  doc_type: string;
  scan_status: string;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

const fieldClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700';
const buttonClass =
  'rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50';
const panelClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';

function statusColor(status: string) {
  if (
    ['ACTIVE', 'APPROVED_FOR_DISBURSEMENT', 'VERIFIED_PENDING_APPROVAL', 'RECONCILED'].includes(
      status,
    )
  ) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (['CHANGES_REQUESTED', 'REJECTED'].includes(status)) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (['CLOSED', 'DISBURSED_AND_RECONCILED'].includes(status)) {
    return 'border-blue-200 bg-blue-50 text-blue-800';
  }
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

export default function GrantsWorkspace({ user }: { user: AuthUserContext }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [selectedGrantId, setSelectedGrantId] = useState('');
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);
  const [selectedTrancheId, setSelectedTrancheId] = useState('');
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>([]);
  const [allocationEdits, setAllocationEdits] = useState<
    Record<string, { amount: string; fxRate: string; budgetLineId: string }>
  >({});
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [submissionId, setSubmissionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [programTitle, setProgramTitle] = useState('');
  const [programPool, setProgramPool] = useState('');
  const [programCurrency, setProgramCurrency] = useState('USD');
  const [programTolerance, setProgramTolerance] = useState('0');
  const [programCategories, setProgramCategories] = useState(
    '[{"code":"PERSONNEL","name":"Personnel"}]',
  );
  const [awardProgramId, setAwardProgramId] = useState('');
  const [awardStartupId, setAwardStartupId] = useState('');
  const [awardTitle, setAwardTitle] = useState('');
  const [awardAmount, setAwardAmount] = useState('');
  const [awardCurrency, setAwardCurrency] = useState('USD');
  const [awardTranches, setAwardTranches] = useState(
    '[{"amount":"10000","categories":[{"code":"PERSONNEL","name":"Personnel","capAmount":"10000"}],"milestones":[]}]',
  );
  const [journalLineId, setJournalLineId] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [allocatedAmount, setAllocatedAmount] = useState('');
  const [fxRate, setFxRate] = useState('1');
  const [signaturePassword, setSignaturePassword] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountPaid, setAmountPaid] = useState('');
  const [payoutFxRate, setPayoutFxRate] = useState('1');
  const [payoutEvidence, setPayoutEvidence] = useState<UploadedDocument | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<
    Record<string, { decision: 'APPROVED' | 'REJECTED'; reasonCode: string; comment: string }>
  >({});
  const [milestoneDecisions, setMilestoneDecisions] = useState<
    Record<string, { decision: 'APPROVED' | 'REJECTED'; reasonCode: string; notes: string }>
  >({});

  const isInstitution = user.org_type === 'INSTITUTION';
  const isStartup = user.org_type === 'STARTUP';
  const canSetup = isInstitution && user.role === 'PM';
  const canAllocate = isStartup && ['FIN', 'FDR'].includes(user.role);
  const canUploadDeliverables = isStartup && ['OPS', 'FIN', 'FDR'].includes(user.role);
  const canCheckReadiness = isStartup && ['FIN', 'FDR'].includes(user.role);
  const canSign = isStartup && user.role === 'FDR';
  const canReview = isInstitution && user.role === 'REV';
  const canAuthorize = isInstitution && user.role === 'APR';
  const canRecordPayout = isInstitution && user.role === 'PM';
  const canConfirm = isStartup && ['FIN', 'FDR'].includes(user.role);

  const selectedTranche = useMemo(
    () => selectedGrant?.tranches.find((tranche) => tranche.id === selectedTrancheId) ?? null,
    [selectedGrant, selectedTrancheId],
  );
  const submissions = selectedTranche?.submissions ?? [];

  const refreshGrants = useCallback(async () => {
    setGrants(await apiRequest<Grant[]>('/api/grants/grants'));
  }, []);

  useEffect(() => {
    let active = true;
    async function loadInitialData() {
      setLoading(true);
      setError(null);
      try {
        const [grantRows, programRows, startupRows, lines] = await Promise.all([
          apiRequest<Grant[]>('/api/grants/grants'),
          canSetup ? apiRequest<Program[]>('/api/grants/grant-programs') : Promise.resolve([]),
          canSetup
            ? apiRequest<Startup[]>('/api/grants/grant-setup/startups')
            : Promise.resolve([]),
          canAllocate
            ? apiRequest<JournalLine[]>('/api/grants/journal-lines/grant-eligible')
            : Promise.resolve([]),
        ]);
        if (!active) return;
        setGrants(grantRows);
        setPrograms(programRows);
        setStartups(startupRows);
        setJournalLines(lines);
        if (grantRows.length) setSelectedGrantId(grantRows[0]!.id);
        if (programRows.length) setAwardProgramId(programRows[0]!.id);
        if (startupRows.length) setAwardStartupId(startupRows[0]!.id);
        if (lines.length) setJournalLineId(lines[0]!.id);
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not load grant workspace.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadInitialData();
    return () => {
      active = false;
    };
  }, [canAllocate, canSetup]);

  useEffect(() => {
    if (!selectedGrantId) {
      setSelectedGrant(null);
      return;
    }
    setError(null);
    let active = true;
    void apiRequest<Grant>(`/api/grants/grants/${encodeURIComponent(selectedGrantId)}`)
      .then((grant) => {
        if (!active) return;
        setSelectedGrant(grant);
        setSelectedTrancheId((current) =>
          grant.tranches.some((tranche) => tranche.id === current)
            ? current
            : ((
                grant.tranches.find((tranche) => tranche.availability_status === 'ACTIVE') ??
                grant.tranches[0]
              )?.id ?? ''),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load this grant.');
      });
    return () => {
      active = false;
    };
  }, [selectedGrantId]);

  const reloadTrancheData = useCallback(async () => {
    if (!selectedTrancheId) return;
    const [rows, check] = await Promise.all([
      canAllocate
        ? apiRequest<Allocation[]>(`/api/grants/tranches/${selectedTrancheId}/allocations`)
        : Promise.resolve([]),
      canCheckReadiness &&
      selectedTranche?.availability_status === 'ACTIVE' &&
      ['DRAFT', 'CHANGES_REQUESTED'].includes(selectedTranche.review_status)
        ? apiRequest<Readiness>(`/api/grants/tranches/${selectedTrancheId}/readiness`)
        : Promise.resolve(null),
    ]);
    setAllocations(rows);
    setReadiness(check);
  }, [
    canAllocate,
    canCheckReadiness,
    selectedTranche?.availability_status,
    selectedTranche?.review_status,
    selectedTrancheId,
  ]);

  useEffect(() => {
    setSelectedSubmission(null);
    setSubmissionId('');
    void reloadTrancheData().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not refresh tranche details.'),
    );
  }, [reloadTrancheData]);

  async function perform(action: () => Promise<void>, successMessage: string) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The requested action failed.');
    } finally {
      setWorking(false);
    }
  }

  async function createProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      const categories: unknown = JSON.parse(programCategories);
      const created = await apiRequest<Program>(
        '/api/grants/grant-programs',
        jsonBody({
          title: programTitle,
          totalPoolAmount: programPool,
          currency: programCurrency,
          varianceTolerancePct: programTolerance,
          eligibleCategories: categories,
        }),
      );
      const rows = await apiRequest<Program[]>('/api/grants/grant-programs');
      setPrograms(rows);
      setAwardProgramId(created.id);
      setAwardCurrency(created.currency);
      setProgramTitle('');
    }, 'Grant program created.');
  }

  async function createAward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      const tranches: unknown = JSON.parse(awardTranches);
      const created = await apiRequest<{ id: string }>(
        '/api/grants/grant-programs/' + awardProgramId + '/grants',
        {
          ...jsonBody({
            startupOrgId: awardStartupId,
            title: awardTitle,
            awardedAmount: awardAmount,
            currency: awardCurrency,
            tranches,
          }),
        },
      );
      await refreshGrants();
      setSelectedGrantId(created.id);
      setAwardTitle('');
    }, 'Grant awarded and tranche schedule created.');
  }

  async function uploadEvidence(file: File, docType: string): Promise<UploadedDocument> {
    const data = new FormData();
    data.set('file', file);
    data.set('doc_type', docType);
    const uploaded = await apiRequest<UploadedDocument>('/api/grants/evidence', {
      method: 'POST',
      body: data,
    });
    if (uploaded.scan_status !== 'CLEAN') {
      throw new Error('The evidence file did not pass the security scan.');
    }
    return uploaded;
  }

  async function uploadAndAttach(
    file: File,
    docType: string,
    targetId: string,
    target: 'allocation' | 'milestone',
  ) {
    await perform(async () => {
      const uploaded = await uploadEvidence(file, docType);
      const endpoint =
        target === 'allocation'
          ? `/api/grants/allocations/${targetId}/evidence`
          : `/api/grants/milestones/${targetId}/evidence`;
      await apiRequest(endpoint, jsonBody({ documentId: uploaded.id }));
      await reloadTrancheData();
      if (target === 'milestone') {
        await reloadSelectedGrant();
      }
    }, 'Evidence uploaded, scanned, and attached.');
  }

  async function reloadSelectedGrant() {
    if (!selectedGrantId) return;
    const grant = await apiRequest<Grant>(`/api/grants/grants/${selectedGrantId}`);
    setSelectedGrant(grant);
  }

  async function createAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      if (!selectedTrancheId) throw new Error('Select an active tranche first.');
      await apiRequest(
        `/api/grants/tranches/${selectedTrancheId}/allocations`,
        jsonBody({
          journalLineId,
          trancheBudgetLineId: budgetLineId,
          allocatedAmount,
          fxRateToGrant: fxRate,
        }),
      );
      await reloadTrancheData();
      setAllocatedAmount('');
    }, 'Expense tagged to the tranche.');
  }

  async function loadSubmission(id: string) {
    setSubmissionId(id);
    setSelectedSubmission(
      await apiRequest<Submission>(`/api/grants/submissions/${encodeURIComponent(id)}`),
    );
    setReviewDecisions({});
    setMilestoneDecisions({});
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSubmission) return;
    await perform(async () => {
      const items = selectedSubmission.items
        .filter((item) => !item.carried_forward_approval)
        .map((item) => {
          const decision = reviewDecisions[item.id] ?? {
            decision: 'APPROVED' as const,
            reasonCode: '',
            comment: '',
          };
          return {
            submissionItemId: item.id,
            decision: decision.decision,
            ...(decision.decision === 'REJECTED'
              ? { reasonCode: decision.reasonCode, comment: decision.comment }
              : {}),
          };
        });
      const milestones = selectedSubmission.milestone_snapshot
        .filter((milestone) => milestone.deliverable_required)
        .map((milestone) => {
          const decision = milestoneDecisions[milestone.milestone_id] ?? {
            decision: 'APPROVED' as const,
            reasonCode: '',
            notes: '',
          };
          return {
            milestoneId: milestone.milestone_id,
            decision: decision.decision,
            ...(decision.decision === 'REJECTED'
              ? { reasonCode: decision.reasonCode, notes: decision.notes }
              : {}),
          };
        });
      await apiRequest(
        `/api/grants/submissions/${selectedSubmission.id}/review`,
        jsonBody({ items, milestones }),
      );
      await reloadSelectedGrant();
      await loadSubmission(selectedSubmission.id);
    }, 'Review decisions recorded.');
  }

  async function uploadPayoutEvidence(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    event.currentTarget.value = '';
    await perform(async () => {
      setPayoutEvidence(await uploadEvidence(file, 'BANK_WIRE_SLIP'));
    }, 'Bank confirmation uploaded and scanned.');
  }

  async function recordPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      if (!selectedTrancheId || !selectedSubmission || !payoutEvidence) {
        throw new Error(
          'Select an approved submission and upload clean bank confirmation evidence.',
        );
      }
      await apiRequest(
        `/api/grants/tranches/${selectedTrancheId}/disbursements`,
        jsonBody({
          submissionId: selectedSubmission.id,
          bankReference,
          paidDate,
          amountPaid,
          fxRate: payoutFxRate,
          confirmationEvidenceDocumentId: payoutEvidence.id,
        }),
      );
      await reloadSelectedGrant();
      setPayoutEvidence(null);
      setBankReference('');
    }, 'Executed payout recorded for startup confirmation.');
  }

  async function openEvidence(url: string) {
    await perform(async () => {
      const result = await apiRequest<{ url: string }>(url);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    }, 'Evidence opened in a new tab.');
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>, callback: (file: File) => void) {
    const file = event.currentTarget.files?.[0];
    if (file) callback(file);
    event.currentTarget.value = '';
  }

  if (user.role === 'ADM' || user.org_type === 'PLATFORM') {
    return (
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-2xl font-semibold">Grant lifecycle</h1>
        <p className="mt-3 text-sm text-slate-600">
          Grant lifecycle actions are limited to institution and startup workspaces.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div>
            <a
              href="/dashboard"
              className="text-sm font-semibold text-slate-700 hover:text-slate-950"
            >
              Dashboard
            </a>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Grant lifecycle workspace</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">{user.email}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold">
              {user.role}
            </span>
            <form action="/api/auth/logout" method="post">
              <button
                className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-5 py-7 sm:px-8">
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

        {canSetup && (
          <section className={panelClass}>
            <h2 className="text-lg font-semibold">Grant setup</h2>
            <p className="mt-1 text-sm text-slate-600">
              Create a program, assign a startup, and define tranche budgets, eligible categories,
              and deliverables.
            </p>
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <form className="space-y-3" onSubmit={(event) => void createProgram(event)}>
                <h3 className="font-medium">New grant program</h3>
                <label className="block text-sm">
                  Program title
                  <input
                    className={fieldClass}
                    required
                    maxLength={160}
                    value={programTitle}
                    onChange={(event) => setProgramTitle(event.target.value)}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm">
                    Pool amount
                    <input
                      className={fieldClass}
                      required
                      inputMode="decimal"
                      value={programPool}
                      onChange={(event) => setProgramPool(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Currency
                    <input
                      className={fieldClass}
                      required
                      maxLength={3}
                      value={programCurrency}
                      onChange={(event) => setProgramCurrency(event.target.value.toUpperCase())}
                    />
                  </label>
                  <label className="block text-sm">
                    Variance %
                    <input
                      className={fieldClass}
                      required
                      inputMode="decimal"
                      value={programTolerance}
                      onChange={(event) => setProgramTolerance(event.target.value)}
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Eligible categories (JSON)
                  <textarea
                    className={`${fieldClass} min-h-20 font-mono text-xs`}
                    required
                    value={programCategories}
                    onChange={(event) => setProgramCategories(event.target.value)}
                  />
                </label>
                <button className={buttonClass} disabled={working}>
                  Create program
                </button>
              </form>

              <form className="space-y-3" onSubmit={(event) => void createAward(event)}>
                <h3 className="font-medium">Award a grant</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    Program
                    <select
                      className={fieldClass}
                      required
                      value={awardProgramId}
                      onChange={(event) => {
                        setAwardProgramId(event.target.value);
                        const program = programs.find((item) => item.id === event.target.value);
                        if (program) setAwardCurrency(program.currency);
                      }}
                    >
                      {programs.map((program) => (
                        <option key={program.id} value={program.id}>
                          {program.title} · {program.currency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Startup
                    <select
                      className={fieldClass}
                      required
                      value={awardStartupId}
                      onChange={(event) => setAwardStartupId(event.target.value)}
                    >
                      {startups.map((startup) => (
                        <option key={startup.id} value={startup.id}>
                          {startup.legal_name} · {startup.functional_currency}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block text-sm">
                  Grant title
                  <input
                    className={fieldClass}
                    required
                    maxLength={160}
                    value={awardTitle}
                    onChange={(event) => setAwardTitle(event.target.value)}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    Awarded amount
                    <input
                      className={fieldClass}
                      required
                      inputMode="decimal"
                      value={awardAmount}
                      onChange={(event) => setAwardAmount(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Currency
                    <input
                      className={fieldClass}
                      required
                      maxLength={3}
                      value={awardCurrency}
                      onChange={(event) => setAwardCurrency(event.target.value.toUpperCase())}
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Tranches, categories, and milestones (JSON)
                  <textarea
                    className={`${fieldClass} min-h-32 font-mono text-xs`}
                    required
                    value={awardTranches}
                    onChange={(event) => setAwardTranches(event.target.value)}
                  />
                </label>
                <button
                  className={buttonClass}
                  disabled={working || programs.length === 0 || startups.length === 0}
                >
                  Create award
                </button>
              </form>
            </div>
          </section>
        )}

        <section className={panelClass}>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-lg font-semibold">My grants</h2>
              <p className="mt-1 text-sm text-slate-600">
                Choose a grant and tranche to see its current lifecycle state.
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              onClick={() =>
                void perform(async () => {
                  await refreshGrants();
                  if (selectedGrantId) await reloadSelectedGrant();
                }, 'Grant list refreshed.')
              }
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Grant
              <select
                className={fieldClass}
                value={selectedGrantId}
                onChange={(event) => setSelectedGrantId(event.target.value)}
              >
                {grants.map((grant) => (
                  <option key={grant.id} value={grant.id}>
                    {grant.title} · {grant.startup_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Tranche
              <select
                className={fieldClass}
                value={selectedTrancheId}
                onChange={(event) => setSelectedTrancheId(event.target.value)}
              >
                {(selectedGrant?.tranches ?? []).map((tranche) => (
                  <option key={tranche.id} value={tranche.id}>
                    Tranche {tranche.sequence_order} · {tranche.amount} {tranche.currency} ·{' '}
                    {tranche.review_status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading && <p className="mt-4 text-sm text-slate-500">Loading grants…</p>}
          {!loading && grants.length === 0 && (
            <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              No grants are assigned to this workspace yet.
            </p>
          )}

          {selectedGrant && selectedTranche && (
            <div className="mt-5 space-y-5 border-t border-slate-200 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{selectedGrant.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedGrant.institution_name} → {selectedGrant.startup_name} · Award{' '}
                    {selectedGrant.awarded_amount} {selectedGrant.currency}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusColor(selectedTranche.review_status)}`}
                >
                  {selectedTranche.availability_status} · {selectedTranche.review_status}
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-lg border border-slate-200 p-4">
                  <h4 className="font-semibold">Eligible cost categories</h4>
                  <ul className="mt-2 space-y-2 text-sm">
                    {selectedTranche.budget_lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex justify-between gap-3 border-b border-slate-100 pb-2 last:border-0"
                      >
                        <span>{line.category_name}</span>
                        <span className="text-right text-slate-600">
                          Cap {line.cap_amount}
                          {line.cap_percentage ? ` / ${line.cap_percentage}%` : ''} · +
                          {line.variance_tolerance_pct}% variance
                        </span>
                      </li>
                    ))}
                  </ul>
                  {selectedTranche.milestones.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold">Milestones and deliverables</h4>
                      <ul className="mt-2 space-y-3">
                        {selectedTranche.milestones.map((milestone) => (
                          <li key={milestone.id} className="rounded-md bg-slate-50 p-3">
                            <div className="flex flex-wrap justify-between gap-2 text-sm">
                              <span className="font-medium">
                                {milestone.code} · {milestone.title}
                              </span>
                              <span className="text-slate-500">
                                {milestone.completion_status} · due {milestone.due_date}
                              </span>
                            </div>
                            {milestone.deliverable_required &&
                              canUploadDeliverables &&
                              ['PENDING', 'REJECTED'].includes(milestone.completion_status) && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <input
                                    aria-label={`Upload deliverable for ${milestone.code}`}
                                    type="file"
                                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                                    onChange={(event) =>
                                      chooseFile(
                                        event,
                                        (file) =>
                                          void uploadAndAttach(
                                            file,
                                            'DELIVERABLE',
                                            milestone.id,
                                            'milestone',
                                          ),
                                      )
                                    }
                                  />
                                  <button
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                    disabled={working}
                                    onClick={() =>
                                      void perform(
                                        async () => {
                                          await apiRequest(
                                            `/api/grants/milestones/${milestone.id}/submit`,
                                            { method: 'POST' },
                                          );
                                          await reloadSelectedGrant();
                                        },
                                        milestone.completion_status === 'REJECTED'
                                          ? 'Milestone deliverable resubmitted for review.'
                                          : 'Milestone deliverable submitted for review.',
                                      )
                                    }
                                  >
                                    {milestone.completion_status === 'REJECTED'
                                      ? 'Resubmit deliverable'
                                      : 'Submit deliverable'}
                                  </button>
                                </div>
                              )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-slate-200 p-4">
                  <h4 className="font-semibold">Submissions and review</h4>
                  {submissions.length ? (
                    <label className="mt-2 block text-sm">
                      Submission
                      <select
                        className={fieldClass}
                        value={submissionId}
                        onChange={(event) =>
                          void perform(
                            async () => loadSubmission(event.target.value),
                            'Submission loaded.',
                          )
                        }
                      >
                        <option value="">Select a submission</option>
                        {[...submissions]
                          .sort((a, b) => b.version_number - a.version_number)
                          .map((submission) => (
                            <option key={submission.id} value={submission.id}>
                              Version {submission.version_number} · {submission.status} ·{' '}
                              {submission.total_claimable_amount} {selectedGrant.currency}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      No submission has been created for this tranche.
                    </p>
                  )}

                  {selectedSubmission && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="font-medium">Versioned package</h5>
                        <span
                          className={`rounded-full border px-2 py-1 text-xs ${statusColor(selectedSubmission.status)}`}
                        >
                          {selectedSubmission.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">
                        Claim {selectedSubmission.total_claimable_amount} {selectedGrant.currency} ·{' '}
                        {selectedSubmission.items.length} line items
                      </p>
                      {(selectedSubmission.items.some((item) => item.decision) ||
                        selectedSubmission.milestone_snapshot.some(
                          (milestone) => milestone.decision,
                        )) && (
                        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                          <h6 className="text-sm font-semibold">Institutional decisions</h6>
                          {selectedSubmission.items
                            .filter((item) => item.decision)
                            .map((item) => (
                              <p key={item.id} className="text-xs text-amber-950">
                                {item.category_name}: {item.decision?.decision}
                                {item.decision?.reason_code
                                  ? ` · ${item.decision.reason_code}`
                                  : ''}
                                {item.decision?.comment ? ` · ${item.decision.comment}` : ''}
                              </p>
                            ))}
                          {selectedSubmission.milestone_snapshot
                            .filter((milestone) => milestone.decision)
                            .map((milestone) => (
                              <p key={milestone.milestone_id} className="text-xs text-amber-950">
                                {milestone.code}: {milestone.decision?.decision}
                                {milestone.decision?.reason_code
                                  ? ` · ${milestone.decision.reason_code}`
                                  : ''}
                                {milestone.decision?.notes ? ` · ${milestone.decision.notes}` : ''}
                              </p>
                            ))}
                        </div>
                      )}
                      {canReview && selectedSubmission.status === 'SUBMITTED_PENDING_REVIEW' && (
                        <form className="space-y-3" onSubmit={(event) => void submitReview(event)}>
                          {selectedSubmission.items
                            .filter((item) => !item.carried_forward_approval)
                            .map((item) => {
                              const decision = reviewDecisions[item.id] ?? {
                                decision: 'APPROVED' as const,
                                reasonCode: '',
                                comment: '',
                              };
                              return (
                                <div
                                  key={item.id}
                                  className="rounded-md border border-slate-200 p-3"
                                >
                                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                                    <span className="font-medium">
                                      {item.category_name} · {item.allocated_amount}{' '}
                                      {selectedGrant.currency}
                                    </span>
                                    <span className="text-slate-500">{item.transaction_date}</span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-600">
                                    {item.line_memo} · {item.functional_amount}{' '}
                                    {item.functional_currency} × {item.fx_rate_to_grant}
                                  </p>
                                  <EvidenceLinks
                                    evidence={item.evidence_snapshot}
                                    onOpen={(id) =>
                                      void openEvidence(
                                        `/api/grants/submissions/${selectedSubmission.id}/evidence/${id}/download`,
                                      )
                                    }
                                  />
                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                    <select
                                      className={fieldClass}
                                      value={decision.decision}
                                      onChange={(event) =>
                                        setReviewDecisions((current) => ({
                                          ...current,
                                          [item.id]: {
                                            ...decision,
                                            decision: event.target.value as 'APPROVED' | 'REJECTED',
                                          },
                                        }))
                                      }
                                    >
                                      <option value="APPROVED">Approve</option>
                                      <option value="REJECTED">Reject</option>
                                    </select>
                                    {decision.decision === 'REJECTED' && (
                                      <>
                                        <select
                                          className={fieldClass}
                                          required
                                          value={decision.reasonCode}
                                          onChange={(event) =>
                                            setReviewDecisions((current) => ({
                                              ...current,
                                              [item.id]: {
                                                ...decision,
                                                reasonCode: event.target.value,
                                              },
                                            }))
                                          }
                                        >
                                          <option value="">Select reason code</option>
                                          <option value="INVALID_RECEIPT">Invalid receipt</option>
                                          <option value="INELIGIBLE_CATEGORY">
                                            Ineligible category
                                          </option>
                                          <option value="AMOUNT_MISMATCH">Amount mismatch</option>
                                          <option value="DUPLICATE_CLAIM">Duplicate claim</option>
                                        </select>
                                        <input
                                          className={fieldClass}
                                          required
                                          placeholder="Required rejection note"
                                          value={decision.comment}
                                          onChange={(event) =>
                                            setReviewDecisions((current) => ({
                                              ...current,
                                              [item.id]: {
                                                ...decision,
                                                comment: event.target.value,
                                              },
                                            }))
                                          }
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          {selectedSubmission.milestone_snapshot
                            .filter((milestone) => milestone.deliverable_required)
                            .map((milestone) => {
                              const decision = milestoneDecisions[milestone.milestone_id] ?? {
                                decision: 'APPROVED' as const,
                                reasonCode: '',
                                notes: '',
                              };
                              return (
                                <div
                                  key={milestone.milestone_id}
                                  className="rounded-md border border-slate-200 p-3"
                                >
                                  <p className="text-sm font-medium">
                                    {milestone.code} · {milestone.title}
                                  </p>
                                  <EvidenceLinks
                                    evidence={milestone.evidence}
                                    onOpen={(id) =>
                                      void openEvidence(
                                        `/api/grants/submissions/${selectedSubmission.id}/evidence/${id}/download`,
                                      )
                                    }
                                  />
                                  <select
                                    className={fieldClass}
                                    value={decision.decision}
                                    onChange={(event) =>
                                      setMilestoneDecisions((current) => ({
                                        ...current,
                                        [milestone.milestone_id]: {
                                          ...decision,
                                          decision: event.target.value as 'APPROVED' | 'REJECTED',
                                        },
                                      }))
                                    }
                                  >
                                    <option value="APPROVED">Approve milestone</option>
                                    <option value="REJECTED">Reject milestone</option>
                                  </select>
                                  {decision.decision === 'REJECTED' && (
                                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                      <select
                                        className={fieldClass}
                                        required
                                        value={decision.reasonCode}
                                        onChange={(event) =>
                                          setMilestoneDecisions((current) => ({
                                            ...current,
                                            [milestone.milestone_id]: {
                                              ...decision,
                                              reasonCode: event.target.value,
                                            },
                                          }))
                                        }
                                      >
                                        <option value="">Select reason</option>
                                        <option value="MISSING_DELIVERABLE">
                                          Missing deliverable
                                        </option>
                                        <option value="INVALID_DELIVERABLE">
                                          Invalid deliverable
                                        </option>
                                        <option value="MILESTONE_NOT_MET">Milestone not met</option>
                                      </select>
                                      <input
                                        className={fieldClass}
                                        required
                                        placeholder="Required review note"
                                        value={decision.notes}
                                        onChange={(event) =>
                                          setMilestoneDecisions((current) => ({
                                            ...current,
                                            [milestone.milestone_id]: {
                                              ...decision,
                                              notes: event.target.value,
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          <button className={buttonClass} disabled={working}>
                            Submit institutional review
                          </button>
                        </form>
                      )}
                      {selectedSubmission.items.filter((item) => item.carried_forward_approval)
                        .length > 0 && (
                        <p className="rounded bg-emerald-50 p-2 text-xs text-emerald-800">
                          Previously approved expenses are carried forward unchanged.
                        </p>
                      )}
                      {selectedSubmission.status === 'VERIFIED_PENDING_APPROVAL' &&
                        canAuthorize && (
                          <button
                            className={buttonClass}
                            disabled={working}
                            onClick={() =>
                              void perform(async () => {
                                await apiRequest(
                                  `/api/grants/submissions/${selectedSubmission.id}/authorize`,
                                  { method: 'POST' },
                                );
                                await reloadSelectedGrant();
                                await loadSubmission(selectedSubmission.id);
                              }, 'Disbursement authorized.')
                            }
                          >
                            Authorize disbursement
                          </button>
                        )}
                    </div>
                  )}
                </section>
              </div>

              {canAllocate &&
                selectedTranche.availability_status === 'ACTIVE' &&
                ['DRAFT', 'CHANGES_REQUESTED'].includes(selectedTranche.review_status) && (
                  <section className="rounded-lg border border-slate-200 p-4">
                    <h4 className="font-semibold">Tag expenses and attach evidence</h4>
                    <form
                      className="mt-3 grid gap-3 md:grid-cols-5"
                      onSubmit={(event) => void createAllocation(event)}
                    >
                      <label className="block text-sm md:col-span-2">
                        Posted expense
                        <select
                          className={fieldClass}
                          required
                          value={journalLineId}
                          onChange={(event) => setJournalLineId(event.target.value)}
                        >
                          {journalLines.map((line) => (
                            <option key={line.id} value={line.id}>
                              {line.entry_date} · {line.memo} · {line.remaining_functional_amount}{' '}
                              {line.functional_currency}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        Eligible category
                        <select
                          className={fieldClass}
                          required
                          value={budgetLineId}
                          onChange={(event) => setBudgetLineId(event.target.value)}
                        >
                          {selectedTranche.budget_lines.map((line) => (
                            <option key={line.id} value={line.id}>
                              {line.category_name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        Allocated amount
                        <input
                          className={fieldClass}
                          required
                          inputMode="decimal"
                          value={allocatedAmount}
                          onChange={(event) => setAllocatedAmount(event.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        FX → grant currency
                        <input
                          className={fieldClass}
                          required
                          inputMode="decimal"
                          value={fxRate}
                          onChange={(event) => setFxRate(event.target.value)}
                        />
                      </label>
                      <button
                        className={`${buttonClass} md:col-start-5`}
                        disabled={
                          working ||
                          journalLines.length === 0 ||
                          selectedTranche.budget_lines.length === 0
                        }
                      >
                        Tag expense
                      </button>
                    </form>
                    <div className="mt-4 space-y-2">
                      {allocations.map((allocation) => {
                        const edit = allocationEdits[allocation.allocation_id] ?? {
                          amount: allocation.allocated_amount,
                          fxRate: allocation.fx_rate_to_grant ?? '1',
                          budgetLineId: allocation.tranche_budget_line_id,
                        };
                        return (
                          <div
                            key={allocation.allocation_id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
                          >
                            <div className="min-w-[220px]">
                              <p className="text-sm font-medium">
                                {allocation.category_name} ·{' '}
                                {allocation.converted_amount ?? allocation.allocated_amount}{' '}
                                {selectedGrant.currency}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {allocation.transaction_date} · {allocation.memo} ·{' '}
                                {allocation.status}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {['DRAFT', 'REJECTED'].includes(allocation.status) && (
                                <input
                                  aria-label="Upload invoice or receipt"
                                  type="file"
                                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                                  onChange={(event) =>
                                    chooseFile(
                                      event,
                                      (file) =>
                                        void uploadAndAttach(
                                          file,
                                          'RECEIPT',
                                          allocation.allocation_id,
                                          'allocation',
                                        ),
                                    )
                                  }
                                />
                              )}
                              {allocation.evidence.map((document) => (
                                <button
                                  key={document.document_id}
                                  type="button"
                                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                                  onClick={() =>
                                    void openEvidence(
                                      `/api/grants/evidence/${document.document_id}/download`,
                                    )
                                  }
                                >
                                  {document.doc_type} attached
                                </button>
                              ))}
                              {allocation.status === 'REJECTED' && (
                                <>
                                  <select
                                    aria-label="Repair category"
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                    value={edit.budgetLineId}
                                    onChange={(event) =>
                                      setAllocationEdits((current) => ({
                                        ...current,
                                        [allocation.allocation_id]: {
                                          ...edit,
                                          budgetLineId: event.target.value,
                                        },
                                      }))
                                    }
                                  >
                                    {selectedTranche.budget_lines.map((line) => (
                                      <option key={line.id} value={line.id}>
                                        {line.category_name}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    aria-label="Repair amount"
                                    className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                                    inputMode="decimal"
                                    value={edit.amount}
                                    onChange={(event) =>
                                      setAllocationEdits((current) => ({
                                        ...current,
                                        [allocation.allocation_id]: {
                                          ...edit,
                                          amount: event.target.value,
                                        },
                                      }))
                                    }
                                  />
                                  <input
                                    aria-label="Repair FX rate"
                                    className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                                    inputMode="decimal"
                                    value={edit.fxRate}
                                    onChange={(event) =>
                                      setAllocationEdits((current) => ({
                                        ...current,
                                        [allocation.allocation_id]: {
                                          ...edit,
                                          fxRate: event.target.value,
                                        },
                                      }))
                                    }
                                  />
                                  <button
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                    disabled={working}
                                    onClick={() =>
                                      void perform(async () => {
                                        await apiRequest(
                                          `/api/grants/allocations/${allocation.allocation_id}`,
                                          {
                                            method: 'PATCH',
                                            headers: { 'content-type': 'application/json' },
                                            body: JSON.stringify({
                                              trancheBudgetLineId: edit.budgetLineId,
                                              allocatedAmount: edit.amount,
                                              fxRateToGrant: edit.fxRate,
                                            }),
                                          },
                                        );
                                        await reloadTrancheData();
                                      }, 'Rejected claim repaired and returned to draft.')
                                    }
                                  >
                                    Save repair
                                  </button>
                                  <button
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                    disabled={working}
                                    onClick={() =>
                                      void perform(async () => {
                                        await apiRequest(
                                          `/api/grants/allocations/${allocation.allocation_id}/drop`,
                                          { method: 'POST' },
                                        );
                                        await reloadTrancheData();
                                      }, 'Rejected claim dropped; approved claims are unchanged.')
                                    }
                                  >
                                    Drop claim
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {allocations.length === 0 && (
                        <p className="text-sm text-slate-500">
                          No expenses tagged to this tranche yet.
                        </p>
                      )}
                    </div>
                    {readiness && (
                      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">
                            {readiness.ready ? 'Ready to submit' : 'Readiness check found blockers'}
                          </p>
                          <p className="text-sm">
                            {readiness.total_claimable_amount} {readiness.currency}
                          </p>
                        </div>
                        {readiness.blockers.length > 0 && (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                            {readiness.blockers.map((blocker, index) => (
                              <li key={`${blocker.code}-${blocker.entity_id ?? index}`}>
                                {blocker.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {canSign && readiness.ready && (
                          <form
                            className="mt-3 flex flex-wrap items-end gap-3"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void perform(async () => {
                                await apiRequest(
                                  `/api/grants/tranches/${selectedTranche.id}/submit`,
                                  jsonBody({
                                    idempotencyKey: crypto.randomUUID(),
                                    password: signaturePassword,
                                  }),
                                );
                                setSignaturePassword('');
                                await reloadSelectedGrant();
                              }, 'Signed submission sent to institutional review.');
                            }}
                          >
                            <label className="block text-sm">
                              Re-enter password to sign
                              <input
                                className={fieldClass}
                                required
                                type="password"
                                autoComplete="current-password"
                                value={signaturePassword}
                                onChange={(event) => setSignaturePassword(event.target.value)}
                              />
                            </label>
                            <button className={buttonClass} disabled={working}>
                              Sign and submit
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                    {canCheckReadiness &&
                      !readiness &&
                      selectedTranche.availability_status === 'ACTIVE' && (
                        <button
                          className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                          disabled={working}
                          onClick={() => void reloadTrancheData()}
                        >
                          Run readiness check
                        </button>
                      )}
                  </section>
                )}

              {canRecordPayout && selectedTranche.review_status === 'APPROVED_FOR_DISBURSEMENT' && (
                <form
                  className="rounded-lg border border-slate-200 p-4"
                  onSubmit={(event) => void recordPayout(event)}
                >
                  <h4 className="font-semibold">Record off-platform payment</h4>
                  <p className="mt-1 text-sm text-slate-600">
                    After treasury executes the transfer, record its reference, date, exact
                    authorized amount, FX rate, and bank proof.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block text-sm">
                      Approved submission
                      <select
                        className={fieldClass}
                        required
                        value={submissionId}
                        onChange={(event) =>
                          void perform(
                            async () => loadSubmission(event.target.value),
                            'Submission loaded.',
                          )
                        }
                      >
                        {submissions
                          .filter((submission) => submission.status === 'APPROVED_FOR_DISBURSEMENT')
                          .map((submission) => (
                            <option key={submission.id} value={submission.id}>
                              Version {submission.version_number} ·{' '}
                              {submission.total_claimable_amount}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Bank reference
                      <input
                        className={fieldClass}
                        required
                        maxLength={120}
                        value={bankReference}
                        onChange={(event) => setBankReference(event.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Transfer date
                      <input
                        className={fieldClass}
                        required
                        type="date"
                        value={paidDate}
                        onChange={(event) => setPaidDate(event.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Amount paid
                      <input
                        className={fieldClass}
                        required
                        inputMode="decimal"
                        value={amountPaid}
                        onChange={(event) => setAmountPaid(event.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Applied FX rate
                      <input
                        className={fieldClass}
                        required
                        inputMode="decimal"
                        value={payoutFxRate}
                        onChange={(event) => setPayoutFxRate(event.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Bank confirmation PDF/image
                      <input
                        className={fieldClass}
                        required
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                        onChange={(event) => void uploadPayoutEvidence(event)}
                      />
                    </label>
                    <p className="self-end text-xs text-slate-600">
                      {payoutEvidence
                        ? `Scanned: ${payoutEvidence.doc_type}`
                        : 'Proof upload required'}
                    </p>
                    <button
                      className={`${buttonClass} self-end`}
                      disabled={working || !payoutEvidence}
                    >
                      Record payout
                    </button>
                  </div>
                </form>
              )}

              {selectedTranche.disbursements.map((disbursement) => (
                <section key={disbursement.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="font-semibold">Off-platform transfer</h4>
                      <p className="mt-1 text-sm text-slate-600">
                        {disbursement.bank_reference} · {disbursement.paid_date} ·{' '}
                        {disbursement.amount_paid} {disbursement.currency} · FX{' '}
                        {disbursement.fx_rate}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusColor(disbursement.status)}`}
                    >
                      {disbursement.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50"
                      disabled={working}
                      onClick={() =>
                        void openEvidence(
                          `/api/grants/disbursements/${disbursement.id}/evidence/download`,
                        )
                      }
                    >
                      Open bank confirmation
                    </button>
                    {canConfirm && disbursement.status === 'RECORDED_BY_INSTITUTION' && (
                      <button
                        className={buttonClass}
                        disabled={working}
                        onClick={() =>
                          void perform(async () => {
                            await apiRequest(
                              `/api/grants/disbursements/${disbursement.id}/confirm`,
                              { method: 'POST' },
                            );
                            await reloadSelectedGrant();
                          }, 'Receipt confirmed; tranche reconciliation and next-tranche unlock completed.')
                        }
                      >
                        Confirm receipt and reconcile
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function EvidenceLinks({
  evidence,
  onOpen,
}: {
  evidence: Evidence[];
  onOpen: (documentId: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {evidence.map((document) => (
        <button
          key={document.document_id}
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          onClick={() => onOpen(document.document_id)}
        >
          {document.doc_type} · {document.size_bytes} bytes
        </button>
      ))}
      {evidence.length === 0 && (
        <span className="text-xs text-slate-500">No evidence attached.</span>
      )}
    </div>
  );
}
