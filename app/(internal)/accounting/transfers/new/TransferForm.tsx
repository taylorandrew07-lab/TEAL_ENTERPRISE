'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  createIntercompanyTransfer,
  accountsForCompany,
  type CompanyOption,
  type CompanyAccount,
} from '@/modules/accounting/intercompany';

type Account = CompanyAccount;

const toNum = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, c: string) =>
  new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + c;

function AccountSelect({
  id,
  label,
  hint,
  value,
  onChange,
  accounts,
  placeholder,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  accounts: Account[];
  placeholder: string;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} · {a.name}
          </option>
        ))}
      </select>
      <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        {hint}
      </span>
    </div>
  );
}

export function TransferForm({
  fromCompanyName,
  otherCompanies,
  fromAccounts,
}: {
  fromCompanyName: string;
  otherCompanies: CompanyOption[];
  fromAccounts: Account[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const fromAssets = fromAccounts.filter((a) => a.category === 'asset');

  const [toCompanyId, setToCompanyId] = useState('');
  const [toAccounts, setToAccounts] = useState<Account[]>([]);
  const [loadingTo, setLoadingTo] = useState(false);

  const [fromCreditAccountId, setFromCreditAccountId] = useState('');
  const [fromDueFromAccountId, setFromDueFromAccountId] = useState('');
  const [toDebitAccountId, setToDebitAccountId] = useState('');
  const [toDueToAccountId, setToDueToAccountId] = useState('');

  const [amount, setAmount] = useState('');
  const [transferDate, setTransferDate] = useState(today);
  const [description, setDescription] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toCompanyName = otherCompanies.find((c) => c.id === toCompanyId)?.name ?? 'the other company';
  const toAssets = toAccounts.filter((a) => a.category === 'asset');
  const toLiabilities = toAccounts.filter((a) => a.category === 'liability');

  const amt = round2(toNum(amount));
  const ready =
    Boolean(toCompanyId) &&
    Boolean(fromCreditAccountId) &&
    Boolean(fromDueFromAccountId) &&
    Boolean(toDebitAccountId) &&
    Boolean(toDueToAccountId) &&
    Boolean(transferDate) &&
    amt > 0;

  async function onChooseCompany(id: string) {
    setToCompanyId(id);
    setToDebitAccountId('');
    setToDueToAccountId('');
    setToAccounts([]);
    if (!id) return;
    setLoadingTo(true);
    try {
      const accounts = await accountsForCompany(id);
      setToAccounts(accounts);
    } finally {
      setLoadingTo(false);
    }
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createIntercompanyTransfer({
        toCompanyId,
        fromCreditAccountId,
        fromDueFromAccountId,
        toDebitAccountId,
        toDueToAccountId,
        amount: amt,
        transferDate,
        description: description || undefined,
      });
      if (res?.error) setError(res.error);
      else {
        router.push('/accounting/transfers' as Route);
        router.refresh();
      }
    });
  }

  return (
    <div style={{ maxWidth: 720 }}>
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

      {/* Transfer basics */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="toCompany">
              Destination company
            </label>
            <select
              id="toCompany"
              className="input"
              value={toCompanyId}
              onChange={(e) => onChooseCompany(e.target.value)}
            >
              <option value="">Select company…</option>
              {otherCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="transferDate">
              Transfer date
            </label>
            <input
              id="transferDate"
              className="input"
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="amount">
              Amount
            </label>
            <input
              id="amount"
              className="input num"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={{ textAlign: 'right' }}
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label className="label" htmlFor="description">
              Description
            </label>
            <input
              id="description"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="optional — e.g. funding for Q3 operations"
            />
          </div>
        </div>
      </div>

      {/* Source leg (active company) */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Source · {fromCompanyName}
        </div>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 'var(--text-sm)' }}>
          We debit the Due-from (asset) account and credit the account the money leaves.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <AccountSelect
            id="fromDueFrom"
            label={`Due-from ${toCompanyName} (debit)`}
            hint="Asset account recording what the other company owes."
            value={fromDueFromAccountId}
            onChange={setFromDueFromAccountId}
            accounts={fromAssets}
            placeholder="Select asset account…"
          />
          <AccountSelect
            id="fromCredit"
            label="Source account (credit)"
            hint="e.g. the bank account the money leaves from."
            value={fromCreditAccountId}
            onChange={setFromCreditAccountId}
            accounts={fromAccounts}
            placeholder="Select account…"
          />
        </div>
      </div>

      {/* Destination leg (chosen company) */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Destination · {toCompanyId ? toCompanyName : '—'}
        </div>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 'var(--text-sm)' }}>
          We debit the account the money arrives in and credit the Due-to (liability) account.
        </p>
        {!toCompanyId ? (
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            Choose a destination company above to pick its accounts.
          </p>
        ) : loadingTo ? (
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            Loading accounts…
          </p>
        ) : toAccounts.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {toCompanyName} has no active accounts yet. Set up its chart of accounts before transferring.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <AccountSelect
              id="toDebit"
              label="Receiving account (debit)"
              hint="e.g. the bank account the money arrives in."
              value={toDebitAccountId}
              onChange={setToDebitAccountId}
              accounts={toAssets}
              placeholder="Select asset account…"
            />
            <AccountSelect
              id="toDueTo"
              label={`Due-to ${fromCompanyName} (credit)`}
              hint="Liability account recording what this company owes."
              value={toDueToAccountId}
              onChange={setToDueToAccountId}
              accounts={toLiabilities}
              placeholder="Select liability account…"
            />
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span
          className={`badge ${amt > 0 ? 'badge-brand' : 'badge-neutral'}`}
          style={{ fontSize: 'var(--text-sm)', padding: '5px 12px' }}
        >
          Transfer {money(amt, 'TTD')}
        </span>
        <button type="button" className="btn btn-primary" disabled={pending || !ready} onClick={submit}>
          {pending ? 'Posting…' : 'Post transfer'}
        </button>
      </div>
    </div>
  );
}
