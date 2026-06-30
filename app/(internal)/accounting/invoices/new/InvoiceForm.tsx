'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createInvoice } from '@/modules/accounting/ar';

type Customer = { id: string; code: string; name: string; receivable_account_id: string | null };
type Account = { id: string; code: string; name: string };
type Tax = { id: string; code: string; name: string; rate: number };
type Line = { accountId: string; description: string; amount: string; taxCodeId: string };

const emptyLine = (): Line => ({ accountId: '', description: '', amount: '', taxCodeId: '' });
const toNum = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, c: string) =>
  new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + c;

export function InvoiceForm({
  customers,
  incomeAccounts,
  receivableAccounts,
  taxCodes,
  baseCurrency,
}: {
  customers: Customer[];
  incomeAccounts: Account[];
  receivableAccounts: Account[];
  taxCodes: Tax[];
  baseCurrency: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const rateById = new Map(taxCodes.map((t) => [t.id, t.rate]));

  const [customerId, setCustomerId] = useState('');
  const [receivableAccountId, setReceivableAccountId] = useState(
    receivableAccounts.length === 1 ? receivableAccounts[0].id : '',
  );
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const subtotal = round2(lines.reduce((s, l) => s + toNum(l.amount), 0));
  const taxTotal = round2(lines.reduce((s, l) => s + toNum(l.amount) * (rateById.get(l.taxCodeId) ?? 0), 0));
  const total = round2(subtotal + taxTotal);
  const ready = Boolean(customerId) && Boolean(receivableAccountId) && total > 0;

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function onCustomerChange(id: string) {
    setCustomerId(id);
    const cust = customers.find((c) => c.id === id);
    if (cust?.receivable_account_id && receivableAccounts.some((a) => a.id === cust.receivable_account_id)) {
      setReceivableAccountId(cust.receivable_account_id);
    }
  }

  function submit(post: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await createInvoice({
        customerId,
        invoiceDate,
        dueDate: dueDate || undefined,
        receivableAccountId,
        post,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          description: l.description,
          amount: toNum(l.amount),
          taxCodeId: l.taxCodeId || undefined,
        })),
      });
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 940 }}>
      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '10px 14px', fontSize: 'var(--text-sm)', marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="customer">Customer</label>
            <select id="customer" className="input" value={customerId} onChange={(e) => onCustomerChange(e.target.value)}>
              <option value="">Select customer…</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.code} · {c.name}</option>))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="receivable">Receivable account</label>
            <select id="receivable" className="input" value={receivableAccountId} onChange={(e) => setReceivableAccountId(e.target.value)}>
              <option value="">Select account…</option>
              {receivableAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="invoiceDate">Invoice date</label>
            <input id="invoiceDate" className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="dueDate">Due date</label>
            <input id="dueDate" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Income account</th>
              <th>Line description</th>
              <th style={{ width: 150 }}>Tax</th>
              <th className="num" style={{ width: 150 }}>Amount</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select className="input" value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })}>
                    <option value="">Select income account…</option>
                    {incomeAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
                  </select>
                </td>
                <td>
                  <input className="input" value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="optional" />
                </td>
                <td>
                  <select className="input" value={l.taxCodeId} onChange={(e) => update(i, { taxCodeId: e.target.value })} disabled={taxCodes.length === 0}>
                    <option value="">No tax</option>
                    {taxCodes.map((t) => (<option key={t.id} value={t.id}>{t.code} · {round2(t.rate * 100)}%</option>))}
                  </select>
                </td>
                <td>
                  <input className="input num" inputMode="decimal" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} placeholder="0.00" style={{ textAlign: 'right' }} />
                </td>
                <td>
                  <button type="button" aria-label="Remove line" className="btn btn-ghost btn-sm" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} style={{ padding: '6px 9px' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>
              </td>
              <td className="num muted" style={{ fontSize: 'var(--text-xs)' }}>Subtotal {money(subtotal, baseCurrency)}</td>
              <td />
            </tr>
            {taxTotal > 0 ? (
              <tr>
                <td colSpan={3} />
                <td className="num muted" style={{ fontSize: 'var(--text-xs)' }}>Tax {money(taxTotal, baseCurrency)}</td>
                <td />
              </tr>
            ) : null}
            <tr>
              <td colSpan={3} />
              <td className="num" style={{ fontWeight: 650 }}>{money(total, baseCurrency)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {taxCodes.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 10 }}>
          No tax codes set up yet — lines post without tax. Add VAT in <a href="/accounting/tax-codes">Tax Codes</a> to charge it.
        </p>
      ) : null}

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <span className={`badge ${total > 0 ? 'badge-brand' : 'badge-neutral'}`} style={{ fontSize: 'var(--text-sm)', padding: '5px 12px' }}>
          Invoice total {money(total, baseCurrency)}
        </span>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn btn-ghost" disabled={pending || !ready} onClick={() => submit(false)}>
            {pending ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={() => submit(true)}>
            {pending ? 'Posting…' : 'Post invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
