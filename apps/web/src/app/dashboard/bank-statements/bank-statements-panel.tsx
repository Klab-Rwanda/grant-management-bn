'use client';

import { ChangeEvent, useCallback, useEffect, useState } from 'react';

interface StatementImport {
  id: string;
  source_filename: string;
  statement_format: string;
  status: string;
  transaction_count: number;
  created_at: string;
}

interface ImportedTransaction {
  id: string;
  booking_date: string;
  amount: string;
  currency: string;
  direction: string;
  bank_reference: string | null;
  remittance: string | null;
  review_status: string;
}

interface ImportDetails extends StatementImport {
  transactions: ImportedTransaction[];
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

export default function BankStatementsPanel() {
  const [imports, setImports] = useState<StatementImport[]>([]);
  const [selected, setSelected] = useState<ImportDetails | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setImports(await apiRequest<StatementImport[]>('/api/bank-statements/imports'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load statement imports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function importStatement() {
    if (!file) {
      setError('Choose a CAMT.053 XML file first.');
      return;
    }
    if (file.size > 1_000_000) {
      setError('Statement files must not exceed 1 MB.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const xml = await file.text();
      const result = await apiRequest<{ import_id: string; transaction_count: number }>(
        '/api/bank-statements/imports',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source_filename: file.name, xml }),
        },
      );
      setNotice(
        `${result.transaction_count} transactions added to review queue. No journal entries were posted.`,
      );
      setFile(null);
      const input = document.getElementById('statement-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await refresh();
      await showImport(result.import_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Statement import failed.');
    } finally {
      setBusy(false);
    }
  }

  async function showImport(id: string) {
    setError(null);
    try {
      setSelected(
        await apiRequest<ImportDetails>(`/api/bank-statements/imports/${encodeURIComponent(id)}`),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the review queue.');
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] ?? null);
    setNotice(null);
    setError(null);
  }

  return (
    <div className="mt-8 space-y-6">
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

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Import CAMT.053</h2>
        <p className="mt-1 text-sm text-slate-600">
          XML files up to 1 MB are accepted. Duplicate files in this workspace are rejected.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            id="statement-file"
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={chooseFile}
            className="block max-w-full text-sm"
          />
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => void importStatement()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import for review'}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Files are parsed into tenant-private transaction rows; original XML is not retained.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold">Recent imports</h2>
            <p className="mt-1 text-xs text-slate-500">
              Pending transactions remain unposted until separately processed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {imports.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => void showImport(item.id)}
              className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left hover:bg-slate-50"
            >
              <span>
                <span className="block text-sm font-medium">{item.source_filename}</span>
                <span className="text-xs text-slate-500">
                  {item.statement_format} · {new Date(item.created_at).toLocaleString()}
                </span>
              </span>
              <span className="text-sm text-slate-600">
                {item.transaction_count} entries · {item.status}
              </span>
            </button>
          ))}
          {!loading && imports.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              No statements imported yet.
            </p>
          )}
          {loading && (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Loading imports…</p>
          )}
        </div>
      </section>

      {selected && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold">Review queue: {selected.source_filename}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {selected.transactions.length} imported rows · pending review · no journal entries
              posted
            </p>
          </div>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Booking date</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Remittance</th>
                <th className="px-4 py-3">Review status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selected.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="whitespace-nowrap px-4 py-3">{transaction.booking_date}</td>
                  <td className="px-4 py-3">{transaction.direction}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    {transaction.amount} {transaction.currency}
                  </td>
                  <td className="px-4 py-3">{transaction.bank_reference ?? '—'}</td>
                  <td className="max-w-sm px-4 py-3">{transaction.remittance ?? '—'}</td>
                  <td className="px-4 py-3">{transaction.review_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
