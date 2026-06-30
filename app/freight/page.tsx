import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate } from '@/lib/format';
import { getDashboardStats, listShipments, listOpenTasks } from '@/modules/freight/queries';
import { STAGE_LABELS } from '@/modules/freight/lifecycle';
import { StageBadge } from '@/modules/freight/status';

export const metadata = { title: 'Dashboard — Jupiter Logistics' };

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="card" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{label}</div>
      <div className="num" style={{ fontSize: 'var(--text-2xl)', fontWeight: 650, marginTop: 4 }}>{value}</div>
    </div>
  );
  return href ? <Link href={href as never} style={{ display: 'block' }}>{inner}</Link> : inner;
}

export default async function FreightDashboard() {
  await requireModule('freight');
  const [stats, shipments, tasks] = await Promise.all([
    getDashboardStats(),
    listShipments(),
    listOpenTasks(),
  ]);
  const recent = shipments.slice(0, 8);
  const topTasks = tasks.slice(0, 8);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Operations Dashboard</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Your day at a glance — what needs attention, what is moving.</p>
        </div>
        <Link href="/freight/shipments/new" className="btn btn-primary">New shipment</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Stat label="Active shipments" value={stats.activeShipments} href="/freight/shipments" />
        <Stat label="In transit" value={stats.inTransit} />
        <Stat label="Awaiting approval" value={stats.awaitingApproval} />
        <Stat label="Quotes sent" value={stats.pendingQuotes} />
        <Stat label="Open tasks" value={stats.openTasks} href="/freight/tasks" />
        <Stat label="Arriving ≤7 days" value={stats.arrivingSoon} />
        <Stat label="Free-time risk" value={stats.freeTimeRisk} href="/freight/containers" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Recent shipments</h2>
          {recent.length === 0 ? (
            <div className="card" style={{ padding: 20 }}>
              <p className="muted" style={{ margin: 0 }}>No shipments yet. <Link href="/freight/shipments/new">Create the first one</Link>.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Reference</th>
                    <th>Customer</th>
                    <th>Lane</th>
                    <th style={{ width: 150 }}>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}><Link href={`/freight/shipments/${s.id}`}>{s.reference ?? '—'}</Link></td>
                      <td>{s.customerName ?? <span className="muted">—</span>}</td>
                      <td className="muted">{[s.origin_name, s.destination_name].filter(Boolean).join(' → ') || '—'}</td>
                      <td><StageBadge stage={s.stage} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Open tasks</h2>
          {topTasks.length === 0 ? (
            <div className="card" style={{ padding: 20 }}>
              <p className="muted" style={{ margin: 0 }}>Nothing outstanding. Tasks appear automatically as shipments advance.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 8 }}>
              {topTasks.map((t) => (
                <div key={t.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 550 }}>{t.title}</div>
                  <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>
                    {t.shipmentRef ? <>{t.shipmentRef} · </> : null}
                    {t.due_at ? <>due {formatDate(t.due_at)}</> : 'no due date'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 24, maxWidth: 720 }}>
        Tiles for demurrage/detention risk, overdue invoices, vessel arrivals and AI recommendations land in later
        builds — the data model already supports them (see {STAGE_LABELS.in_transit} milestones and container free-time).
      </p>
    </div>
  );
}
