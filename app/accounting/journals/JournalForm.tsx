'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postJournalEntry } from '@/modules/accounting/actions';

type Account = { id: string; code: string; name: string };
type Line = { accountId: string; description: string; debit: string; credit: string };

const emptyLine = (): Line => ({ accountId: '', description: '', debit: '', credit: '' });
const toNum = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number, c: string) =>
  new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + c;

export function JournalForm({ accounts, baseCurrency }: { accounts: Account[]; baseCurrency: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sumD = round2(lines.reduce((s, l) => s + toNum(l.debit), 0));
  const sumC = round2(lines.reduce((s, l) => s + toNum(l.credit), 0));
  const diff = round2(sumD - sumC);
  const balanced = diff === 0 && sumD > 0;

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function submit(post: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await postJournalEntry({
        entryDate,
        currency: baseCurrency,
        description,
        post,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          description: l.description,
          debit: toNum(l.debit),
          credit: toNum(l.credit),
        })),
      });
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 880 }}>
      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '10px 14px', fontSize: 'var(--text-sm)', marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,180px) minmax(0,1fr)', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="entryDate">Entry date</label>
            <input id="entryDate" className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="desc">Description</label>
            <input id="desc" className="input" placeholder="e.g. Office rent for June" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Account</th>
              <th>Line description</th>
              <th className="num" style={{ width: 140 }}>Debit</th>
              <th className="num" style={{ width: 140 }}>Credit</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select className="input" value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })}>
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="input" value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="optional" />
                </td>
                <td>
                  <input className="input num" inputMode="decimal" value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} placeholder="0.00" style={{ textAlign: 'right' }} />
                </td>
                <td>
                  <input className="input num" inputMode="decimal" value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} placeholder="0.00" style={{ textAlign: 'right' }} />
                </td>
                <td>
                  <button type="button" aria-label="Remove line" className="btn btn-ghost btn-sm" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} style={{ padding: '6px 9px' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>
              </td>
              <td className="num">{money(sumD, baseCurrency)}</td>
              <td className="num">{money(sumC, baseCurrency)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <span
            className={`badge ${balanced ? 'badge-success' : 'badge-warning'}`}
            style={{ fontSize: 'var(--text-sm)', padding: '5px 12px' }}
          >
            {balanced ? 'Balanced' : diff === 0 ? 'Add debits & credits' : `Out of balance by ${money(Math.abs(diff), baseCurrency)}`}
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => submit(false)}>Save draft</button>
          <button type="button" className="btn btn-primary" disabled={pending || !balanced} onClick={() => submit(true)}>
            {pending ? 'Posting…' : 'Post entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
