import { requireModule } from '@/core/session/guard';
import { formatDate } from '@/lib/format';
import { listPeriods, groupPeriodsByYear, type Period } from '@/modules/accounting/queries';
import { createFiscalYear, setPeriodStatus } from '@/modules/accounting/actions';

export const metadata = { title: 'Accounting Periods — TEAL Accounting' };

export default async function PeriodsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'periods.manage');
  const periods = await listPeriods();
  const groups = groupPeriodsByYear(periods);
  const error = searchParams?.error;
  const thisYear = new Date().getUTCFullYear();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Accounting Periods</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Postings are only allowed into <strong>open</strong> periods. Close a period to freeze it; lock it to protect history.
          </p>
        </div>
        <form action={createFiscalYear} className="row" style={{ gap: 8 }}>
          <input
            name="year"
            className="input"
            inputMode="numeric"
            defaultValue={thisYear}
            aria-label="Fiscal year"
            style={{ width: 96 }}
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Generate year
          </button>
        </form>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 640 }}>
          {error}
        </div>
      ) : null}

      {periods.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No periods yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Generate a fiscal year above to create twelve monthly periods (aligned to your company&apos;s
            fiscal-year start). You can then post journals dated within an open period.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.year} style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 10 }}>FY {g.year}</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>Period</th>
                    <th className="date">Dates</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 200 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {g.periods.map((p) => (
                    <tr key={p.id}>
                      <td className="num">{p.period_no}</td>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td className="muted date">
                        {formatDate(p.start_date)} → {formatDate(p.end_date)}
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td>
                        <PeriodActions period={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Period['status'] }) {
  if (status === 'open') return <span className="badge badge-success">Open</span>;
  if (status === 'closed') return <span className="badge badge-warning">Closed</span>;
  return <span className="badge badge-neutral">Locked</span>;
}

function StatusButton({ id, status, label, primary }: { id: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setPeriodStatus} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost'}`}>
        {label}
      </button>
    </form>
  );
}

function PeriodActions({ period }: { period: Period }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {period.status === 'open' ? <StatusButton id={period.id} status="closed" label="Close" /> : null}
      {period.status === 'closed' ? (
        <>
          <StatusButton id={period.id} status="open" label="Reopen" />
          <StatusButton id={period.id} status="locked" label="Lock" />
        </>
      ) : null}
      {period.status === 'locked' ? <StatusButton id={period.id} status="open" label="Reopen" /> : null}
    </div>
  );
}
