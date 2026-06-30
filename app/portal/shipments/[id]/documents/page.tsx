import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { requirePortal } from '@/core/session/portal-guard';
import { getPortalShipmentDetail, getPortalDocuments } from '@/modules/freight/portal/queries';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Documents — Jupiter Logistics' };

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

export default async function PortalShipmentDocuments({ params }: { params: { id: string } }) {
  await requirePortal();
  const ship = await getPortalShipmentDetail(params.id);
  if (!ship) notFound();
  const docs = await getPortalDocuments(ship.id);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href={`/portal/shipments/${ship.id}` as Route}>{ship.reference ?? 'Shipment'}</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Documents</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Documents we&apos;ve shared for this shipment.</p>
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="muted" style={{ margin: 0 }}>No documents have been shared for this shipment yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Document</th><th style={{ width: 160 }}>Type</th><th className="date" style={{ width: 120 }}>Date</th><th style={{ width: 120 }} /></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.title ?? d.filename}</td>
                  <td className="muted">{pretty(d.doc_type)}</td>
                  <td className="muted date">{formatDate(d.created_at)}</td>
                  <td>
                    {d.url ? (
                      <a href={d.url} className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer">Download</a>
                    ) : (
                      <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>Unavailable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
