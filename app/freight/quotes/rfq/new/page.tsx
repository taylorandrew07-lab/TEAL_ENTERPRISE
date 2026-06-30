import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { listShipments } from '@/modules/freight/queries';
import { createRfq } from '@/modules/freight/actions';

export const metadata = { title: 'New RFQ — Jupiter Logistics' };

export default async function NewRfqPage({ searchParams }: { searchParams: { error?: string; shipment?: string } }) {
  await requireModule('freight', 'freight.quotes.manage');
  const shipments = await listShipments();
  const error = searchParams?.error;
  const preset = searchParams?.shipment ?? '';

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/quotes">Quotes</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New Request for Quote</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Raise an RFQ, then add the carriers/agents to ask and record their rates.</p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 620 }}>{error}</div>
      ) : null}

      <form action={createRfq} className="card" style={{ padding: 20, maxWidth: 620, display: 'grid', gap: 16 }}>
        <div className="field">
          <label className="label" htmlFor="shipment_id">Shipment (optional)</label>
          <select id="shipment_id" name="shipment_id" className="input" defaultValue={preset}>
            <option value="">— standalone enquiry —</option>
            {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference ?? s.id.slice(0, 8)} · {s.customerName ?? 'no customer'}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="due_by">Responses due by</label>
          <input id="due_by" name="due_by" type="date" className="input" />
        </div>
        <div><button className="btn btn-primary" type="submit">Create RFQ</button></div>
      </form>
    </div>
  );
}
