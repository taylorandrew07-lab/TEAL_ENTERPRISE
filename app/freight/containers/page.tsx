import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate, formatMoney } from '@/lib/format';
import { listAllContainers } from '@/modules/freight/queries';
import { computeFreeTime, riskLabel } from '@/modules/freight/freetime';

export const metadata = { title: 'Containers — Jupiter Logistics' };

const RISK_BADGE: Record<string, string> = { overdue: 'badge-danger', watch: 'badge-warning', none: 'badge-neutral' };

export default async function ContainersPage() {
  await requireModule('freight', 'freight.containers.manage');
  const containers = await listAllContainers();
  const withRisk = containers
    .map((c) => ({ c, ft: computeFreeTime(c) }))
    .sort((a, b) => {
      const order = { overdue: 0, watch: 1, none: 2 } as Record<string, number>;
      return order[a.ft.risk] - order[b.ft.risk];
    });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Containers</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            Free-time, demurrage and detention watch across every shipment — sorted by risk. Add and update
            containers from inside each shipment workspace.
          </p>
        </div>
      </div>

      {containers.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No containers yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>Open a shipment and add its containers — free-time risk then shows here automatically.</p>
          <Link href="/freight/shipments" className="btn btn-primary">Go to shipments</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>Container</th>
                <th style={{ width: 130 }}>Shipment</th>
                <th style={{ width: 110 }}>Status</th>
                <th>Location</th>
                <th className="date" style={{ width: 120 }}>Discharged</th>
                <th style={{ width: 180 }}>Free-time</th>
                <th className="num" style={{ width: 140 }}>Est. penalty</th>
              </tr>
            </thead>
            <tbody>
              {withRisk.map(({ c, ft }) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {c.shipment_id ? <Link href={`/freight/shipments/${c.shipment_id}`}>{c.container_no ?? '—'}</Link> : (c.container_no ?? '—')}
                  </td>
                  <td className="muted">{c.shipmentRef ?? '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{c.status.replace(/_/g, ' ')}</td>
                  <td className="muted">{c.current_location ?? '—'}</td>
                  <td className="muted date">{formatDate(c.discharge_date)}</td>
                  <td><span className={`badge ${RISK_BADGE[ft.risk]}`}>{riskLabel(ft)}</span></td>
                  <td className="num">{ft.estPenalty > 0 ? formatMoney(ft.estPenalty, ft.rateCurrency ?? 'USD') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
