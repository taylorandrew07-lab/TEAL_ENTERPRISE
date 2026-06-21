import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { trialBalance, companyBaseCurrency } from '@/modules/accounting/queries';

export const metadata = { title: 'Trial Balance — TEAL Accounting' };

const fmt = (n: number) =>
  n === 0 ? '—' : new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default async function TrialBalancePage() {
  await requireModule('accounting', 'reports.view');
  const [{ rows, totalDebit, totalCredit }, currency] = await Promise.all([trialBalance(), companyBaseCurrency()]);
  const balanced = Math.round((totalDebit - totalCredit) * 100) === 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Reports</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Trial Balance</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            All posted activity to date, in {currency}. Debits must equal credits.
          </p>
        </div>
        {rows.length > 0 ? (
          <span className={`badge ${balanced ? 'badge-success' : 'badge-danger'}`} style={{ padding: '5px 12px', fontSize: 'var(--text-sm)' }}>
            {balanced ? 'In balance' : 'Out of balance'}
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Nothing posted yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            The trial balance is built from posted journal entries. <Link href="/accounting/journals/new">Post an entry</Link>{' '}
            and it appears here instantly.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Account</th>
                <th className="num" style={{ width: 150 }}>Debit</th>
                <th className="num" style={{ width: 150 }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account_code}>
                  <td className="num" style={{ fontWeight: 600 }}>{r.account_code}</td>
                  <td>{r.account_name}</td>
                  <td className="num">{fmt(r.debit)}</td>
                  <td className="num">{fmt(r.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">{fmt(totalDebit)}</td>
                <td className="num">{fmt(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
