import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate } from '@/lib/format';
import { listShipments } from '@/modules/freight/queries';
import { MODE_LABELS } from '@/modules/freight/lifecycle';
import { StageBadge, ShipmentStatusBadge } from '@/modules/freight/status';

export const metadata = { title: 'Shipments — Jupiter Logistics' };

export default async function ShipmentsPage() {
  await requireModule('freight', 'freight.shipments.manage');
  const shipments = await listShipments();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Shipments</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Every shipment is a workspace — parties, cargo, milestones, tasks, documents, communications and
            finance all live on the job. Click one to open it.
          </p>
        </div>
        <Link href="/freight/shipments/new" className="btn btn-primary">New shipment</Link>
      </div>

      {shipments.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No shipments yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Create your first shipment. It starts as a <em>Lead</em> and moves through the lifecycle —
            each stage automatically raises the tasks and milestones your team needs.
          </p>
          <Link href="/freight/shipments/new" className="btn btn-primary">New shipment</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 140 }}>Reference</th>
                <th>Customer</th>
                <th>Lane</th>
                <th style={{ width: 110 }}>Mode</th>
                <th className="date" style={{ width: 120 }}>ETA</th>
                <th style={{ width: 150 }}>Stage</th>
                <th style={{ width: 100 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}><Link href={`/freight/shipments/${s.id}`}>{s.reference ?? '—'}</Link></td>
                  <td>{s.customerName ?? <span className="muted">—</span>}</td>
                  <td className="muted">{[s.origin_name, s.destination_name].filter(Boolean).join(' → ') || '—'}</td>
                  <td>{s.mode ? MODE_LABELS[s.mode] : <span className="muted">—</span>}</td>
                  <td className="muted date">{formatDate(s.eta)}</td>
                  <td><StageBadge stage={s.stage} /></td>
                  <td><ShipmentStatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
