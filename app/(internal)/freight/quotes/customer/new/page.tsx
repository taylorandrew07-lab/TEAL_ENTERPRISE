import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { listShipments } from '@/modules/freight/queries';
import { createCustomerQuote } from '@/modules/freight/actions';

export const metadata = { title: 'New quotation — Jupiter Logistics' };

export default async function NewCustomerQuotePage({ searchParams }: { searchParams: { error?: string; shipment?: string } }) {
  await requireModule('freight', 'freight.quotes.manage');
  const shipments = await listShipments();
  const error = searchParams?.error;
  const preset = searchParams?.shipment ?? '';

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/quotes">Quotes</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New customer quotation</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Pick the shipment; then add charge lines and set your margin inside the quotation.</p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 620 }}>{error}</div>
      ) : null}

      {shipments.length === 0 ? (
        <div className="card" style={{ padding: 24, maxWidth: 620 }}>
          <p style={{ marginTop: 0 }}>You need a shipment first. <Link href="/freight/shipments/new">Create one</Link>, then quote it.</p>
        </div>
      ) : (
        <form action={createCustomerQuote} className="card" style={{ padding: 20, maxWidth: 620, display: 'grid', gap: 16 }}>
          <div className="field">
            <label className="label" htmlFor="shipment_id">Shipment</label>
            <select id="shipment_id" name="shipment_id" className="input" required defaultValue={preset}>
              <option value="" disabled>Choose a shipment…</option>
              {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference ?? s.id.slice(0, 8)} · {s.customerName ?? 'no customer'}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label className="label" htmlFor="currency_code">Currency</label><input id="currency_code" name="currency_code" className="input" defaultValue="USD" maxLength={3} /></div>
            <div className="field"><label className="label" htmlFor="valid_until">Valid until</label><input id="valid_until" name="valid_until" type="date" className="input" /></div>
          </div>
          <div><button className="btn btn-primary" type="submit">Create quotation</button></div>
        </form>
      )}
    </div>
  );
}
