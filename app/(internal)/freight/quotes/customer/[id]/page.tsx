import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireModule } from '@/core/session/guard';
import { formatDate, formatMoney } from '@/lib/format';
import { getCustomerQuote, getQuoteLines } from '@/modules/freight/queries';
import { QuoteStatusBadge } from '@/modules/freight/status';
import { addQuoteLine, setCustomerQuoteStatus, pushQuoteToCharges } from '@/modules/freight/actions';

export const metadata = { title: 'Quotation — Jupiter Logistics' };

export default async function CustomerQuoteDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  await requireModule('freight', 'freight.quotes.manage');
  const q = await getCustomerQuote(params.id);
  if (!q) notFound();
  const lines = await getQuoteLines(q.id);
  const ccy = q.currency_code ?? 'USD';
  const error = searchParams?.error;
  const marginPct = q.total_amount > 0 ? (q.margin / q.total_amount) * 100 : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/quotes">Quotes</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>
            {q.reference ?? 'Quotation'} <span className="muted">rev {q.revision}</span> <span style={{ marginLeft: 8 }}><QuoteStatusBadge status={q.status} /></span>
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {q.shipment_id ? <Link href={`/freight/shipments/${q.shipment_id}`}>{q.shipmentRef ?? 'shipment'}</Link> : '—'}
            {q.valid_until ? <> · valid to {formatDate(q.valid_until)}</> : null}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {q.status === 'draft' ? <StatusButton id={q.id} status="sent" label="Mark sent" primary /> : null}
          {q.status === 'sent' ? <><StatusButton id={q.id} status="approved" label="Approved" primary /><StatusButton id={q.id} status="rejected" label="Rejected" /></> : null}
          {q.status === 'approved' ? (
            <form action={pushQuoteToCharges}>
              <input type="hidden" name="id" value={q.id} />
              <button className="btn btn-primary" type="submit">Post to shipment charges →</button>
            </form>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16 }}>{error}</div>
      ) : null}

      <div className="card" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div><div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>Sell total</div><div className="num" style={{ fontSize: 'var(--text-lg)', fontWeight: 650 }}>{formatMoney(q.total_amount, ccy)}</div></div>
        <div><div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>Cost basis</div><div className="num">{formatMoney(q.total_cost, ccy)}</div></div>
        <div><div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>Margin</div><div className="num" style={{ fontWeight: 650 }}>{formatMoney(q.margin, ccy)} <span className="muted" style={{ fontWeight: 400 }}>({marginPct.toFixed(1)}%)</span></div></div>
      </div>

      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Charge lines</h2>
      {lines.length > 0 ? (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table className="table">
            <thead><tr><th>Description</th><th className="num" style={{ width: 90 }}>Qty</th><th className="num" style={{ width: 120 }}>Rate</th><th className="num" style={{ width: 140 }}>Amount</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}{l.charge_code ? <span className="muted"> · {l.charge_code}</span> : null}</td>
                  <td className="num">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                  <td className="num">{formatMoney(l.rate, l.currency_code ?? ccy)}</td>
                  <td className="num">{formatMoney(l.amount, l.currency_code ?? ccy)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td><td className="num" style={{ fontWeight: 650 }}>{formatMoney(q.total_amount, ccy)}</td></tr>
            </tfoot>
          </table>
        </div>
      ) : <p className="muted">No lines yet — add your sell charges below.</p>}

      {q.status === 'draft' ? (
        <form action={addQuoteLine} className="card" style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="customer_quote_id" value={q.id} />
          <div className="field" style={{ flex: 1, minWidth: 200 }}><label className="label">Description</label><input name="description" className="input" placeholder="e.g. Ocean freight Shanghai → POS" required /></div>
          <div className="field"><label className="label">Code</label><input name="charge_code" className="input" placeholder="OFR" style={{ width: 80 }} /></div>
          <div className="field"><label className="label">Qty</label><input name="quantity" type="number" step="0.01" defaultValue={1} className="input" style={{ width: 80 }} /></div>
          <div className="field"><label className="label">Unit</label><input name="unit" className="input" placeholder="ctr" style={{ width: 70 }} /></div>
          <div className="field"><label className="label">Rate</label><input name="rate" type="number" step="0.01" className="input" style={{ width: 110 }} required /></div>
          <div className="field"><label className="label">Ccy</label><input name="currency_code" className="input" defaultValue={ccy} maxLength={3} style={{ width: 70 }} /></div>
          <button className="btn btn-ghost" type="submit">Add line</button>
        </form>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Lines are locked once the quotation leaves draft. Create a new revision to change pricing.</p>
      )}
    </div>
  );
}

function StatusButton({ id, status, label, primary }: { id: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setCustomerQuoteStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={`btn ${primary ? 'btn-primary' : 'btn-ghost'}`} type="submit">{label}</button>
    </form>
  );
}
