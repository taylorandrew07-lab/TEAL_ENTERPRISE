import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import { listBanks, addBank, addAccount, listCurrencyCodes, listGlAssetAccounts, deleteBank } from '@/modules/accounting/banking';
import { formatMoney } from '@/lib/format';
import { DeleteButton } from '@/core/ui/DeleteButton';

export const metadata = { title: 'Bank Accounts — TEAL Accounting' };

export default async function BankingPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'banking.private');
  const [banks, currencies, glAccounts] = await Promise.all([listBanks(), listCurrencyCodes(), listGlAssetAccounts()]);
  const error = searchParams?.error;

  // Total cash per currency across all accounts.
  const byCurrency = new Map<string, number>();
  for (const b of banks) for (const a of b.accounts) byCurrency.set(a.currency_code, (byCurrency.get(a.currency_code) ?? 0) + a.current_balance);
  const totals = [...byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow" style={{ color: 'var(--primary-strong)' }}>Accounting · Private</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Bank Accounts</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            Your real bank balances, private to people with “View bank accounts”. Add banks and the accounts
            under them, upload statements, and match transactions to bills and invoices.
          </p>
        </div>
        <span className="badge badge-brand" style={{ alignSelf: 'start' }}>Private</span>
      </div>

      {error ? <Banner>{error}</Banner> : null}

      {totals.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24, maxWidth: 760 }}>
          {totals.map(([cur, amt]) => (
            <div key={cur} className="card" style={{ padding: '16px 18px' }}>
              <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>Total cash · {cur}</div>
              <div className="num" style={{ fontSize: 'var(--text-xl)', fontWeight: 650, marginTop: 4 }}>{formatMoney(amt, cur)}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <details className="card" style={{ padding: 0, minWidth: 280 }}>
          <summary style={{ padding: '12px 16px', cursor: 'pointer', fontWeight: 600, listStyle: 'none' }}>+ Add a bank</summary>
          <form action={addBank} style={{ padding: '4px 16px 16px', display: 'grid', gap: 10 }}>
            <input name="name" className="input" placeholder="e.g. Republic Bank" required />
            <button type="submit" className="btn btn-primary btn-sm">Add bank</button>
          </form>
        </details>

        {banks.length > 0 ? (
          <details className="card" style={{ padding: 0, minWidth: 320, flex: 1, maxWidth: 560 }}>
            <summary style={{ padding: '12px 16px', cursor: 'pointer', fontWeight: 600, listStyle: 'none' }}>+ Add an account</summary>
            <form action={addAccount} style={{ padding: '4px 16px 16px', display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <select name="bank_id" className="input" required defaultValue="">
                  <option value="" disabled>Bank…</option>
                  {banks.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                </select>
                <select name="currency_code" className="input" required defaultValue={currencies.includes('USD') ? 'USD' : ''}>
                  <option value="" disabled>Currency…</option>
                  {currencies.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <input name="name" className="input" placeholder="e.g. Operating account" required />
              <input name="account_number" className="input" placeholder="e.g. 0012345678 (optional)" />
              <input name="current_balance" className="input num" inputMode="decimal" placeholder="e.g. 25000.00 (current balance)" style={{ textAlign: 'right' }} />
              <select name="gl_account_id" className="input" defaultValue="">
                <option value="">Link to a ledger account (optional)…</option>
                {glAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
              </select>
              <button type="submit" className="btn btn-primary btn-sm">Add account</button>
            </form>
          </details>
        ) : null}
      </div>

      {banks.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <p className="muted" style={{ margin: 0 }}>No banks yet. Add your first bank above, then add accounts under it.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
          {banks.map((b) => (
            <div key={b.id}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{b.name}</h2>
                <DeleteButton action={deleteBank} fields={{ id: b.id }} label="Delete bank"
                  confirm={`Delete "${b.name}" and all its accounts, statements and transactions? This can’t be undone.`} />
              </div>
              {b.accounts.length === 0 ? (
                <p className="muted" style={{ fontSize: 'var(--text-sm)', margin: 0 }}>No accounts yet — add one above.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th style={{ width: 150 }}>Number</th>
                        <th style={{ width: 80 }}>Cur.</th>
                        <th className="num" style={{ width: 170 }}>Balance</th>
                        <th style={{ width: 90 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {b.accounts.map((a) => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 600 }}>
                            <Link href={`/accounting/banking/${a.id}` as Route}>{a.name}</Link>
                          </td>
                          <td className="muted">{a.account_number ?? '—'}</td>
                          <td>{a.currency_code}</td>
                          <td className="num">{formatMoney(a.current_balance, a.currency_code)}</td>
                          <td><Link href={`/accounting/banking/${a.id}` as Route} className="btn btn-ghost btn-sm">Open</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 660 }}>
      {children}
    </div>
  );
}
