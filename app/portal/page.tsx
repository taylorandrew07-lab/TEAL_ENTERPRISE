import Link from 'next/link';
import type { Route } from 'next';
import { requirePortal } from '@/core/session/portal-guard';
import { getPortalShipments } from '@/modules/freight/portal/queries';
import { StageBadge } from '@/modules/freight/status';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'My shipments — Jupiter Logistics' };

export default async function PortalHome() {
  await requirePortal();
  const shipments = await getPortalShipments();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>My shipments</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Track progress, download documents and view your quotations.</p>
        </div>
      </div>

      {shipments.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="muted" style={{ margin: 0 }}>You have no shipments yet. They will appear here once we open one for you.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Reference</th>
                <th>Lane</th>
                <th>Commodity</th>
                <th className="date" style={{ width: 120 }}>ETA</th>
                <th style={{ width: 150 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/portal/shipments/${s.id}` as Route}>{s.reference ?? '—'}</Link>
                  </td>
                  <td className="muted">{[s.origin_name, s.destination_name].filter(Boolean).join(' → ') || '—'}</td>
                  <td className="muted">{s.commodity ?? '—'}</td>
                  <td className="muted date">{formatDate(s.eta)}</td>
                  <td><StageBadge stage={s.stage as never} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
