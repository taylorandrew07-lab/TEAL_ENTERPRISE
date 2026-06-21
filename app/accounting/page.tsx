import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { ModuleEmptyState } from '@/core/ui';
import {
  listAccounts,
  listPeriods,
  listJournalEntries,
  trialBalance,
  companyBaseCurrency,
} from '@/modules/accounting/queries';

export const metadata = { title: 'Accounting — TEAL Enterprise' };

const fmtMoney = (n: number, c: string) =>
  new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + c;

export default async function AccountingHome() {
  const ctx = await requireModule('accounting', 'reports.view');
  const company = ctx.companies.find((c) => c.id === ctx.activeCompanyId);
  const [accounts, periods, entries, tb, currency] = await Promise.all([
    listAccounts(),
    listPeriods(),
    listJournalEntries(),
    trialBalance(),
    companyBaseCurrency(),
  ]);

  const openPeriods = periods.filter((p) => p.status === 'open').length;
  const posted = entries.filter((e) => e.status === 'posted');
  const balanced = tb.rows.length > 0 && Math.round((tb.totalDebit - tb.totalCredit) * 100) === 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Dashboard</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {company?.name} · base currency {currency}
          </p>
        </div>
        {accounts.length > 0 ? (
          <Link href="/accounting/journals/new" className="btn btn-primary">
            New journal entry
          </Link>
        ) : null}
      </div>

      {accounts.length === 0 ? (
        <ModuleEmptyState
          title="Set up your books"
          description="Add your chart of accounts and open an accounting period — then post a journal and watch the trial balance build itself."
          actions={[
            { label: 'Chart of Accounts', href: '/accounting/accounts' },
            { label: 'Periods', href: '/accounting/periods', primary: false },
          ]}
        />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24, maxWidth: 880 }}>
            <Stat label="Accounts" value={String(accounts.length)} href="/accounting/accounts" />
            <Stat label="Open periods" value={String(openPeriods)} href="/accounting/periods" />
            <Stat label="Posted entries" value={String(posted.length)} href="/accounting/journals" />
            <Stat
              label="Trial balance"
              value={tb.rows.length ? fmtMoney(tb.totalDebit, currency) : '—'}
              badge={tb.rows.length ? (balanced ? { text: 'In balance', cls: 'badge-success' } : { text: 'Out of balance', cls: 'badge-danger' }) : undefined}
              href="/accounting/reports/trial-balance"
            />
          </div>

          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 10 }}>Recent entries</h2>
          {posted.length === 0 ? (
            <div className="card" style={{ padding: 22, maxWidth: 620 }}>
              <p className="muted" style={{ margin: 0 }}>
                No posted entries yet. <Link href="/accounting/journals/new">Post your first journal entry</Link>.
              </p>
            </div>
          ) : (
            <div className="table-wrap" style={{ maxWidth: 720 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Date</th>
                    <th style={{ width: 80 }}>No.</th>
                    <th>Description</th>
                    <th className="num" style={{ width: 150 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {posted.slice(0, 6).map((e) => (
                    <tr key={e.id}>
                      <td className="num">{e.entry_date}</td>
                      <td style={{ fontWeight: 600 }}>{e.entry_no}</td>
                      <td>{e.description ?? <span className="muted">(no description)</span>}</td>
                      <td className="num">{fmtMoney(e.total, e.currency_code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  badge,
}: {
  label: string;
  value: string;
  href: string;
  badge?: { text: string; cls: string };
}) {
  return (
    <Link href={href as never} className="card" style={{ padding: '16px 18px', textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{label}</div>
      <div className="num" style={{ fontSize: 'var(--text-xl)', fontWeight: 650, marginTop: 4 }}>{value}</div>
      {badge ? <span className={`badge ${badge.cls}`} style={{ marginTop: 8 }}>{badge.text}</span> : null}
    </Link>
  );
}
