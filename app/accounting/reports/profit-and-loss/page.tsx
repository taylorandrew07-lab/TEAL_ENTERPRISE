import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { companyBaseCurrency } from '@/modules/accounting/queries';
import { profitAndLoss } from '@/modules/accounting/reports-fin';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'Profit & Loss — TEAL Accounting' };

const fmt = (n: number, currency: string) => (n === 0 ? '—' : formatMoney(n, currency));

export default async function ProfitAndLossPage() {
  await requireModule('accounting', 'reports.view');
  const [pl, currency] = await Promise.all([profitAndLoss(), companyBaseCurrency()]);
  const profit = pl.netProfit >= 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Reports</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Profit &amp; Loss</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Income and expenses from all posted activity to date, in {currency}.
          </p>
        </div>
        {pl.hasData ? (
          <span
            className={`badge ${profit ? 'badge-success' : 'badge-danger'}`}
            style={{ padding: '5px 12px', fontSize: 'var(--text-sm)' }}
          >
            {profit ? 'Net profit' : 'Net loss'}
          </span>
        ) : null}
      </div>

      {!pl.hasData ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Nothing posted yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Profit &amp; Loss is built from posted journal entries. <Link href="/accounting/journals/new">Post an entry</Link>{' '}
            and it appears here instantly.
          </p>
        </div>
      ) : (
        <div className="table-wrap" style={{ maxWidth: 820 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Account</th>
                <th className="num" style={{ width: 180 }}>Amount</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td colSpan={3} style={{ background: 'var(--surface-2)', fontWeight: 650, color: 'var(--ink-2)' }}>
                  Income
                </td>
              </tr>
              {pl.income.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">No income posted.</td>
                </tr>
              ) : (
                pl.income.map((r) => (
                  <tr key={r.account_id}>
                    <td className="num" style={{ fontWeight: 600 }}>{r.account_code}</td>
                    <td>{r.account_name}</td>
                    <td className="num">{fmt(r.amount, currency)}</td>
                  </tr>
                ))
              )}
              <tr>
                <td colSpan={2} style={{ fontWeight: 650 }}>Total income</td>
                <td className="num" style={{ fontWeight: 650 }}>{fmt(pl.totalIncome, currency)}</td>
              </tr>
            </tbody>

            <tbody>
              <tr>
                <td colSpan={3} style={{ background: 'var(--surface-2)', fontWeight: 650, color: 'var(--ink-2)' }}>
                  Expenses
                </td>
              </tr>
              {pl.expenses.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">No expenses posted.</td>
                </tr>
              ) : (
                pl.expenses.map((r) => (
                  <tr key={r.account_id}>
                    <td className="num" style={{ fontWeight: 600 }}>{r.account_code}</td>
                    <td>{r.account_name}</td>
                    <td className="num">{fmt(r.amount, currency)}</td>
                  </tr>
                ))
              )}
              <tr>
                <td colSpan={2} style={{ fontWeight: 650 }}>Total expenses</td>
                <td className="num" style={{ fontWeight: 650 }}>{fmt(pl.totalExpenses, currency)}</td>
              </tr>
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={2}>{profit ? 'Net profit' : 'Net loss'}</td>
                <td className="num">{formatMoney(pl.netProfit, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
