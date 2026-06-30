import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { companyBaseCurrency } from '@/modules/accounting/queries';
import { generalLedger } from '@/modules/accounting/reports-fin';
import { formatDate, formatMoney } from '@/lib/format';

export const metadata = { title: 'General Ledger — TEAL Accounting' };

const fmt = (n: number, currency: string) => (n === 0 ? '—' : formatMoney(n, currency));

export default async function GeneralLedgerPage() {
  await requireModule('accounting', 'reports.view');
  const [gl, currency] = await Promise.all([generalLedger(), companyBaseCurrency()]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Reports</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>General Ledger</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Every posted line by account, with a running balance, in {currency}.
          </p>
        </div>
        {gl.hasData ? (
          <span className="badge badge-neutral" style={{ padding: '5px 12px', fontSize: 'var(--text-sm)' }}>
            {gl.accounts.length} account{gl.accounts.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {!gl.hasData ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Nothing posted yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            The general ledger lists posted journal lines by account.{' '}
            <Link href="/accounting/journals/new">Post an entry</Link> and it appears here instantly.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 26 }}>
          {gl.accounts.map((a) => (
            <section key={a.account_id}>
              <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>
                <span className="num" style={{ fontWeight: 700 }}>{a.account_code}</span>{' '}
                {a.account_name}
                <span className="badge badge-neutral" style={{ marginLeft: 10, textTransform: 'capitalize' }}>
                  {a.category}
                </span>
              </h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="date" style={{ width: 120 }}>Date</th>
                      <th style={{ width: 120 }}>Entry</th>
                      <th>Description</th>
                      <th className="num" style={{ width: 150 }}>Debit</th>
                      <th className="num" style={{ width: 150 }}>Credit</th>
                      <th className="num" style={{ width: 170 }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="date muted">—</td>
                      <td className="muted">—</td>
                      <td className="muted">Opening balance</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">{fmt(a.opening, currency)}</td>
                    </tr>
                    {a.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="date">{formatDate(l.entry_date)}</td>
                        <td className="num">{l.entry_no ?? '—'}</td>
                        <td>{l.description ?? <span className="muted">—</span>}</td>
                        <td className="num">{fmt(l.debit, currency)}</td>
                        <td className="num">{fmt(l.credit, currency)}</td>
                        <td className="num">{fmt(l.balance, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Closing balance</td>
                      <td className="num">{fmt(a.totalDebit, currency)}</td>
                      <td className="num">{fmt(a.totalCredit, currency)}</td>
                      <td className="num">{formatMoney(a.closing, currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
