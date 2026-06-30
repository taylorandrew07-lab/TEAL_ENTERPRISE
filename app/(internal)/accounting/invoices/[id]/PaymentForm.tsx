'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordPayment } from '@/modules/accounting/ar';

type Account = { id: string; code: string; name: string };

export function PaymentForm({
  invoiceId,
  balance,
  currency,
  bankAccounts,
}: {
  invoiceId: string;
  balance: number;
  currency: string;
  bankAccounts: Account[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [bankAccountId, setBankAccountId] = useState(bankAccounts.length === 1 ? bankAccounts[0].id : '');
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (bankAccounts.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
        Add a bank account (a Chart of Accounts entry flagged “bank account”) to record receipts.
      </p>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await recordPayment({
        invoiceId,
        bankAccountId,
        amount: parseFloat(amount),
        paymentDate: date,
        reference: reference || undefined,
      });
      if (res?.error) setError(res.error);
      else {
        setReference('');
        router.refresh();
      }
    });
  }

  const ready = Boolean(bankAccountId) && parseFloat(amount) > 0;

  return (
    <div>
      {error ? (
        <div role="alert" style={{ background: 'var(--danger-weak)', border: '1px solid oklch(0.85 0.06 25)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r)', fontSize: 'var(--text-sm)', marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div className="field">
          <label className="label" htmlFor="bank">Received into</label>
          <select id="bank" className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Bank account…</option>
            {bankAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="amount">Amount ({currency})</label>
          <input id="amount" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ textAlign: 'right' }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="date">Date</label>
          <input id="date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ref">Reference</label>
          <input id="ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
        </div>
        <button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={submit}>
          {pending ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </div>
  );
}
