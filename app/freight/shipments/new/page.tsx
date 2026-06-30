import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { listContacts } from '@/modules/freight/queries';
import { createShipment } from '@/modules/freight/actions';
import { MODE_LABELS, DIRECTION_LABELS } from '@/modules/freight/lifecycle';

export const metadata = { title: 'New shipment — Jupiter Logistics' };

export default async function NewShipmentPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('freight', 'freight.shipments.manage');
  const contacts = await listContacts();
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/shipments">Shipments</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New shipment</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Capture the essentials — you can complete cargo, booking and parties inside the workspace.</p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 640 }}>
          {error}
        </div>
      ) : null}

      <form action={createShipment} className="card" style={{ padding: 20, maxWidth: 640, display: 'grid', gap: 16 }}>
        <div className="field">
          <label className="label" htmlFor="customer_contact_id">Customer</label>
          <select id="customer_contact_id" name="customer_contact_id" className="input" defaultValue="">
            <option value="">— choose later —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {contacts.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-sm)', margin: '6px 0 0' }}>
              No contacts yet — <Link href="/freight/contacts/new">add one</Link> (you can still create the shipment now).
            </p>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="mode">Mode</label>
            <select id="mode" name="mode" className="input" defaultValue="">
              <option value="">—</option>
              {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="direction">Direction</label>
            <select id="direction" name="direction" className="input" defaultValue="">
              <option value="">—</option>
              {Object.entries(DIRECTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="origin_name">Origin</label>
            <input id="origin_name" name="origin_name" className="input" placeholder="e.g. Shanghai, CN" />
          </div>
          <div className="field">
            <label className="label" htmlFor="destination_name">Destination</label>
            <input id="destination_name" name="destination_name" className="input" placeholder="e.g. Port of Spain, TT" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="commodity">Commodity</label>
            <input id="commodity" name="commodity" className="input" placeholder="e.g. Machinery parts" />
          </div>
          <div className="field">
            <label className="label" htmlFor="incoterm">Incoterm</label>
            <input id="incoterm" name="incoterm" className="input" placeholder="CIF" />
          </div>
          <div className="field">
            <label className="label" htmlFor="currency_code">Currency</label>
            <input id="currency_code" name="currency_code" className="input" placeholder="USD" maxLength={3} />
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-primary">Create shipment</button>
        </div>
      </form>
    </div>
  );
}
