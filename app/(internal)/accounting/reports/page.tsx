import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';

export const metadata = { title: 'Reports — TEAL Accounting' };

const REPORTS = [
  { href: '/accounting/reports/trial-balance', name: 'Trial Balance', desc: 'Every account’s balance from posted entries; debits must equal credits.', ready: true },
  { href: '/accounting/reports/profit-and-loss', name: 'Profit & Loss', desc: 'Income and expenses over a period.', ready: true },
  { href: '/accounting/reports/balance-sheet', name: 'Balance Sheet', desc: 'Assets, liabilities and equity as at a date.', ready: true },
  { href: '/accounting/reports/general-ledger', name: 'General Ledger detail', desc: 'Every posted line by account.', ready: true },
];

export default async function ReportsPage() {
  await requireModule('accounting', 'reports.view');
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Reports</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Built directly from posted journal entries — always reconciled to the ledger.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, maxWidth: 840 }}>
        {REPORTS.map((r) =>
          r.ready ? (
            <Link key={r.name} href={r.href as Route} className="card" style={{ padding: 18, textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div style={{ fontWeight: 650 }}>{r.name}</div>
              <p className="muted" style={{ margin: '5px 0 0', fontSize: 'var(--text-sm)' }}>{r.desc}</p>
              <span style={{ color: 'var(--primary-strong)', fontWeight: 600, fontSize: 'var(--text-sm)', display: 'inline-block', marginTop: 10 }}>Open →</span>
            </Link>
          ) : (
            <div key={r.name} className="card" style={{ padding: 18, opacity: 0.6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 650 }}>{r.name}</span>
                <span className="badge badge-neutral">Soon</span>
              </div>
              <p className="muted" style={{ margin: '5px 0 0', fontSize: 'var(--text-sm)' }}>{r.desc}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
