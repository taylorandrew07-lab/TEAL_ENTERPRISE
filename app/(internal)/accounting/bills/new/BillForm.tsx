'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBill } from '@/modules/accounting/ap';

type Account = { id: string; code: string; name: string };
type Supplier = { id: string; code: string; name: string; payable_account_id: string | null };
type Line = { accountId: string; description: string; amount: string };

const emptyLine = (): Line => ({ accountId: '', description: '', amount: '' });
const toNum = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, c: string) =>
  new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + c;

export function BillForm({
  suppliers,
  expenseAccounts,
  payableAccounts,
  baseCurrency,
}: {
  suppliers: Supplier[];
  expenseAccounts: Account[];
  payableAccounts: Account[];
  baseCurrency: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [supplierId, setSupplierId] = useState('');
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [payableAccountId, setPayableAccountId] = useState(
    payableAccounts.length === 1 ? payableAccounts[0].id : '',
  );
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = round2(lines.reduce((s, l) => s + toNum(l.amount), 0));
  const canSubmit = Boolean(supplierId) && Boolean(payableAccountId) && total > 0;

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function onSupplierChange(id: string) {
    setSupplierId(id);
    // Default the payable account to the supplier's control account when set.
    const sup = suppliers.find((s) => s.id === id);
    if (sup?.payable_account_id && payableAccounts.some((a) => a.id === sup.payable_account_id)) {
      setPayableAccountId(sup.payable_account_id);
    }
  }

  function submit(post: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await createBill({
        supplierId,
        billDate,
        dueDate: dueDate || undefined,
        payableAccountId,
        post,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          description: l.description,
          amount: toNum(l.amount),
        })),
      });
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 880 }}>
      {error ? (
        <div
          role="alert"
          className="card"
          style={{
            borderColor: 'oklch(0.85 0.06 25)',
            background: 'var(--danger-weak)',
            color: 'var(--danger)',
            padding: '10px 14px',
            fontSize: 'var(--text-sm)',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="supplier">
              Supplier
            </label>
            <select
              id="supplier"
              className="input"
              value={supplierId}
              onChange={(e) => onSupplierChange(e.target.value)}
            >
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="payable">
              Payable account
            </label>
            <select
              id="payable"
              className="input"
              value={payableAccountId}
              onChange={(e) => setPayableAccountId(e.target.value)}
            >
              <option value="">Select account…</option>
              {payableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="billDate">
              Bill date
            </label>
            <input
              id="billDate"
              className="input"
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="dueDate">
              Due date <span className="muted">(optional)</span>
            </label>
            <input
              id="dueDate"
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Expense account</th>
              <th>Line description</th>
              <th className="num" style={{ width: 160 }}>
                Amount
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select
                    className="input"
                    value={l.accountId}
                    onChange={(e) => update(i, { accountId: e.target.value })}
                  >
                    <option value="">Select account…</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input"
                    value={l.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="optional"
                  />
                </td>
                <td>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={l.amount}
                    onChange={(e) => update(i, { amount: e.target.value })}
                    placeholder="0.00"
                    style={{ textAlign: 'right' }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    aria-label="Remove line"
                    className="btn btn-ghost btn-sm"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    style={{ padding: '6px 9px' }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setLines((ls) => [...ls, emptyLine()])}
                >
                  + Add line
                </button>
              </td>
              <td className="num" style={{ fontWeight: 650 }}>
                {money(total, baseCurrency)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <span
            className={`badge ${total > 0 ? 'badge-brand' : 'badge-neutral'}`}
            style={{ fontSize: 'var(--text-sm)', padding: '5px 12px' }}
          >
            Bill total {money(total, baseCurrency)}
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn btn-ghost" disabled={pending || !canSubmit} onClick={() => submit(false)}>
            Save draft
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !canSubmit}
            onClick={() => submit(true)}
          >
            {pending ? 'Posting…' : 'Post bill'}
          </button>
        </div>
      </div>
    </div>
  );
}
