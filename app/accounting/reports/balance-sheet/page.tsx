import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { companyBaseCurrency } from '@/modules/accounting/queries';
import { balanceSheet, type BSAccountRow } from '@/modules/accounting/reports-fin';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'Balance Sheet — TEAL Accounting' };

const fmt = (n: number, currency: string) => (n === 0 ? '—' : formatMoney(n, currency));

function Section({ label, rows, currency }: { label: string; rows: BSAccountRow[]; currency: string }) {
  return (
    <tbody>
      <tr>
        <td colSpan={3} style={{ background: 'var(--surface-2)', fontWeight: 650, color: 'var(--ink-2)' }}>
          {label}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.account_id}>
          <td className="num" style={{ fontWeight: 600 }}>{r.account_code}</td>
          <td>{r.account_name}</td>
          <td className="num">{fmt(r.amount, currency)}</td>
        </tr>
      ))}
    </tbody>
  );
}

export default async function BalanceSheetPage() {
  await requireModule('accounting', 'reports.view');
  const [bs, currency] = await Promise.all([balanceSheet(), companyBaseCurrency()]);
  const totalLiabAndEquity = Math.round((bs.totalLiabilities + bs.totalEquity) * 100) / 100;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Reports</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Balance Sheet</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Assets, liabilities and equity from all posted activity to date, in {currency}.
          </p>
        </div>
        {bs.hasData ? (
          <span
            className={`badge ${bs.balanced ? 'badge-success' : 'badge-danger'}`}
            style={{ padding: '5px 12px', fontSize: 'var(--text-sm)' }}
          >
            {bs.balanced ? 'Balanced' : 'Out of balance'}
          </span>
        ) : null}
      </div>

      {!bs.hasData ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Nothing posted yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            The balance sheet is built from posted journal entries.{' '}
            <Link href="/accounting/journals/new">Post an entry</Link> and it appears here instantly.
          </p>
        </div>
      ) : (
        <div className="table-wrap" style={{ maxWidth: 820 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Account</th>
                <th className="num" style={{ width: 180 }}>Balance</th>
              </tr>
            </thead>

            <Section label="Assets" rows={bs.assets} currency={currency} />
            <tbody>
              <tr>
                <td colSpan={2} style={{ fontWeight: 650 }}>Total assets</td>
                <td className="num" style={{ fontWeight: 650 }}>{fmt(bs.totalAssets, currency)}</td>
              </tr>
            </tbody>

            <Section label="Liabilities" rows={bs.liabilities} currency={currency} />
            <tbody>
              <tr>
                <td colSpan={2} style={{ fontWeight: 650 }}>Total liabilities</td>
                <td className="num" style={{ fontWeight: 650 }}>{fmt(bs.totalLiabilities, currency)}</td>
              </tr>
            </tbody>

            <tbody>
              <tr>
                <td colSpan={3} style={{ background: 'var(--surface-2)', fontWeight: 650, color: 'var(--ink-2)' }}>
                  Equity
                </td>
              </tr>
              {bs.equity.map((r) => (
                <tr key={r.account_id}>
                  <td className="num" style={{ fontWeight: 600 }}>{r.account_code}</td>
                  <td>{r.account_name}</td>
                  <td className="num">{fmt(r.amount, currency)}</td>
                </tr>
              ))}
              <tr>
                <td className="num" />
                <td>
                  Current-year earnings
                  <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--text-sm)' }}>
                    (income − expenses)
                  </span>
                </td>
                <td className="num">{fmt(bs.currentYearEarnings, currency)}</td>
              </tr>
              <tr>
                <td colSpan={2} style={{ fontWeight: 650 }}>Total equity</td>
                <td className="num" style={{ fontWeight: 650 }}>{fmt(bs.totalEquity, currency)}</td>
              </tr>
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={2}>Liabilities + equity</td>
                <td className="num">{formatMoney(totalLiabAndEquity, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
