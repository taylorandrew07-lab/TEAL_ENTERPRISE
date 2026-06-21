import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { requireModule } from '@/core/session/guard';
import {
  getAccount,
  listTransactions,
  listStatements,
  listMatchTargets,
  updateBalance,
  addTransaction,
  uploadStatement,
} from '@/modules/accounting/banking';
import { formatMoney, formatDate } from '@/lib/format';
import { MatchSelect } from './MatchSelect';

export const metadata = { title: 'Bank Account — TEAL Accounting' };

export default async function BankAccountPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  await requireModule('accounting', 'banking.private');
  const account = await getAccount(params.id);
  if (!account) notFound();
  const [txns, statements, targets] = await Promise.all([
    listTransactions(params.id),
    listStatements(params.id),
    listMatchTargets(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const error = searchParams?.error;
  const cur = account.currency_code;

  return (
    <div style={{ maxWidth: 920 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow" style={{ color: 'var(--primary-strong)' }}>
            <Link href={'/accounting/banking' as Route}>Bank Accounts</Link> · {account.bank_name}
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>{account.name}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {cur}{account.account_number ? ` · ${account.account_number}` : ''}
          </p>
        </div>
        <span className="badge badge-brand" style={{ alignSelf: 'start' }}>Private</span>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 660 }}>
          {error}
        </div>
      ) : null}

      {/* Balance */}
      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 560 }}>
        <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>Current balance{account.balance_as_of ? ` · as of ${formatDate(account.balance_as_of)}` : ''}</div>
        <div className="num" style={{ fontSize: 'var(--text-2xl)', fontWeight: 650, margin: '4px 0 14px' }}>{formatMoney(account.current_balance, cur)}</div>
        <form action={updateBalance} className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <input type="hidden" name="account_id" value={account.id} />
          <div className="field">
            <label className="label" htmlFor="bal">Update balance ({cur})</label>
            <input id="bal" name="current_balance" className="input num" inputMode="decimal" defaultValue={account.current_balance.toFixed(2)} style={{ textAlign: 'right', maxWidth: 180 }} />
          </div>
          <div className="field">
            <label className="label" htmlFor="asof">As of</label>
            <input id="asof" name="balance_as_of" className="input" type="date" defaultValue={account.balance_as_of ?? today} />
          </div>
          <button type="submit" className="btn btn-ghost btn-sm">Save</button>
        </form>
      </div>

      {/* Statement upload */}
      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 560 }}>
        <h2 style={{ fontSize: 'var(--text-base)', margin: '0 0 10px' }}>Upload a statement</h2>
        <form action={uploadStatement} className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="account_id" value={account.id} />
          <input type="file" name="file" required className="input" style={{ maxWidth: 320, padding: '8px 10px' }} />
          <button type="submit" className="btn btn-primary btn-sm">Upload</button>
        </form>
        <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '10px 0 0' }}>
          CSV/TSV statements are read into transactions automatically; PDFs are stored securely (extraction comes next).
        </p>
        {statements.length > 0 ? (
          <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
            {statements.map((s) => (
              <div key={s.id} className="row" style={{ justifyContent: 'space-between', gap: 10, fontSize: 'var(--text-sm)' }}>
                <span>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.filename}</a> : s.filename}</span>
                <span className="muted">{formatDate(s.created_at)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Add transaction */}
      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 660 }}>
        <h2 style={{ fontSize: 'var(--text-base)', margin: '0 0 10px' }}>Add a transaction</h2>
        <form action={addTransaction} className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <input type="hidden" name="account_id" value={account.id} />
          <div className="field"><label className="label" htmlFor="td">Date</label><input id="td" name="txn_date" type="date" className="input" defaultValue={today} required /></div>
          <div className="field"><label className="label" htmlFor="dir">Direction</label>
            <select id="dir" name="direction" className="input" defaultValue="out"><option value="out">Money out</option><option value="in">Money in</option></select>
          </div>
          <div className="field"><label className="label" htmlFor="amt">Amount</label><input id="amt" name="amount" className="input num" inputMode="decimal" placeholder="e.g. 500.00" style={{ textAlign: 'right', maxWidth: 140 }} required /></div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}><label className="label" htmlFor="dsc">Description</label><input id="dsc" name="description" className="input" placeholder="optional" /></div>
          <button type="submit" className="btn btn-ghost btn-sm">Add</button>
        </form>
      </div>

      {/* Transactions */}
      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Transactions</h2>
      {txns.length === 0 ? (
        <div className="card" style={{ padding: 22, maxWidth: 620 }}>
          <p className="muted" style={{ margin: 0 }}>No transactions yet. Upload a CSV statement or add one above.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="date" style={{ width: 120 }}>Date</th>
                <th>Description</th>
                <th className="num" style={{ width: 150 }}>Amount</th>
                <th style={{ width: 200 }}>Matched to</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => {
                const current = t.matched_bill_id ? `bill:${t.matched_bill_id}` : t.matched_invoice_id ? `invoice:${t.matched_invoice_id}` : '';
                return (
                  <tr key={t.id}>
                    <td className="date">{formatDate(t.txn_date)}</td>
                    <td>{t.description ?? <span className="muted">—</span>}</td>
                    <td className="num" style={{ color: t.amount < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                      {t.amount < 0 ? '' : '+'}{formatMoney(t.amount, cur)}
                    </td>
                    <td><MatchSelect txnId={t.id} accountId={account.id} current={current} targets={targets} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
