import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate, formatMoney } from '@/lib/format';
import {
  getDashboardStats, listShipments, getPendingApprovals, getBookingsToConfirm,
  getArrivals, getContainerRiskBoard, getRecentCommunications,
} from '@/modules/freight/queries';
import { computeFreeTime } from '@/modules/freight/freetime';
import { StageBadge, RiskBadge } from '@/modules/freight/status';

export const metadata = { title: 'Dashboard — Jupiter Logistics' };

function Stat({ label, value, href, accent }: { label: string; value: number; href?: string; accent?: boolean }) {
  const inner = (
    <div className="card" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{label}</div>
      <div className="num" style={{ fontSize: 'var(--text-2xl)', fontWeight: 650, marginTop: 4, color: accent && value > 0 ? 'var(--danger)' : undefined }}>{value}</div>
    </div>
  );
  return href ? <Link href={href as never} style={{ display: 'block' }}>{inner}</Link> : inner;
}

function Panel({ title, count, href, empty, children }: { title: string; count: number; href?: string; empty: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{title} {count > 0 ? <span className="muted num" style={{ fontWeight: 400, fontSize: 'var(--text-sm)' }}>· {count}</span> : null}</h2>
        {href && count > 0 ? <Link href={href as never} className="muted" style={{ fontSize: 'var(--text-sm)' }}>View all →</Link> : null}
      </div>
      {count === 0 ? (
        <div className="card" style={{ padding: 16 }}><p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>{empty}</p></div>
      ) : (
        <div className="card" style={{ padding: 6 }}>{children}</div>
      )}
    </section>
  );
}

function Item({ href, left, right }: { href: string; left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Link href={href as never} className="account-item" style={{ justifyContent: 'space-between' }}>
      <span style={{ minWidth: 0 }}>{left}</span>
      {right}
    </Link>
  );
}

export default async function FreightDashboard() {
  await requireModule('freight');
  const [stats, recent, approvals, bookings, arrivals, riskBoard, comms] = await Promise.all([
    getDashboardStats(), listShipments({ limit: 10 }), getPendingApprovals(), getBookingsToConfirm(),
    getArrivals(), getContainerRiskBoard(), getRecentCommunications(),
  ]);

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

      <form action="/freight/search" method="get" style={{ maxWidth: 560, marginBottom: 24 }}>
        <input name="q" className="input" placeholder="Search shipments, contacts, containers, B/L, booking, container no.…" aria-label="Search" />
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 28 }}>
        <Stat label="Active shipments" value={stats.activeShipments} href="/freight/shipments" />
        <Stat label="In transit" value={stats.inTransit} />
        <Stat label="Awaiting approval" value={stats.awaitingApproval} />
        <Stat label="Quotes sent" value={stats.pendingQuotes} href="/freight/quotes" />
        <Stat label="Open tasks" value={stats.openTasks} href="/freight/tasks" />
        <Stat label="Arriving ≤7 days" value={stats.arrivingSoon} />
        <Stat label="Free-time risk" value={riskBoard.riskCount} href="/freight/containers" accent />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
        {/* NEEDS ATTENTION */}
        <div style={{ display: 'grid', gap: 24 }}>
          <Panel title="Pending customer approvals" count={approvals.length} href="/freight/quotes" empty="No quotations awaiting a customer decision.">
            {approvals.map((a) => (
              <Item key={a.id} href={`/freight/quotes/customer/${a.id}`}
                left={<><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{a.reference ?? 'Quotation'}</span> <span className="muted">{a.shipmentRef ?? ''}</span></>}
                right={<span className="num">{formatMoney(a.total_amount, a.currency_code ?? 'USD')}</span>} />
            ))}
          </Panel>

          <Panel title="Free-time / demurrage risk" count={riskBoard.atRisk.length} href="/freight/containers" empty="No containers at risk.">
            {riskBoard.atRisk.map((c) => (
              <Item key={c.id} href={c.shipment_id ? `/freight/shipments/${c.shipment_id}` : '/freight/containers'}
                left={<><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.container_no ?? 'Container'}</span> <span className="muted">{c.shipmentRef ?? ''}</span></>}
                right={<RiskBadge status={computeFreeTime(c)} />} />
            ))}
          </Panel>

          <Panel title="Bookings to confirm" count={bookings.length} href="/freight/shipments" empty="No approved shipments awaiting booking.">
            {bookings.map((b) => (
              <Item key={b.id} href={`/freight/shipments/${b.id}`}
                left={<><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{b.reference ?? 'Shipment'}</span> <span className="muted">{b.customerName ?? b.lane}</span></>} />
            ))}
          </Panel>
        </div>

        {/* UPCOMING & ACTIVITY */}
        <div style={{ display: 'grid', gap: 24 }}>
          <Panel title="Vessel arrivals (next 14 days)" count={arrivals.length} href="/freight/shipments" empty="No arrivals scheduled in the next two weeks.">
            {arrivals.map((a) => (
              <Item key={a.id} href={`/freight/shipments/${a.id}`}
                left={<><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{a.reference ?? 'Shipment'}</span> <span className="muted">{a.lane || a.customerName}</span></>}
                right={<span className="muted num" style={{ fontSize: 'var(--text-sm)' }}>{formatDate(a.eta)}</span>} />
            ))}
          </Panel>

          <Panel title="Recent communications" count={comms.length} empty="No communications logged yet.">
            {comms.map((c) => (
              <Item key={c.id} href={c.shipment_id ? `/freight/shipments/${c.shipment_id}` : '/freight'}
                left={<><span className="badge badge-neutral" style={{ marginRight: 8 }}>{c.channel}</span><span style={{ color: 'var(--ink)' }}>{c.subject ?? `${c.direction} ${c.channel}`}</span> <span className="muted">{c.shipmentRef ?? ''}</span></>}
                right={<span className="muted num" style={{ fontSize: 'var(--text-sm)' }}>{formatDate(c.occurred_at)}</span>} />
            ))}
          </Panel>
        </div>
      </div>

      {/* RECENT SHIPMENTS */}
      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Recent shipments</h2>
        {recent.length === 0 ? (
          <div className="card" style={{ padding: 20 }}>
            <p className="muted" style={{ margin: 0 }}>No shipments yet. <Link href="/freight/shipments/new">Create the first one</Link>.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th style={{ width: 140 }}>Reference</th><th>Customer</th><th>Lane</th><th className="date" style={{ width: 120 }}>ETA</th><th style={{ width: 150 }}>Stage</th></tr>
              </thead>
              <tbody>
                {recent.slice(0, 10).map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}><Link href={`/freight/shipments/${s.id}`}>{s.reference ?? '—'}</Link></td>
                    <td>{s.customerName ?? <span className="muted">—</span>}</td>
                    <td className="muted">{[s.origin_name, s.destination_name].filter(Boolean).join(' → ') || '—'}</td>
                    <td className="muted date">{formatDate(s.eta)}</td>
                    <td><StageBadge stage={s.stage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
