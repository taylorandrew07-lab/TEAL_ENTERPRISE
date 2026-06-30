import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate, formatMoney } from '@/lib/format';
import { listRfqs, listCustomerQuotes } from '@/modules/freight/queries';
import { QuoteStatusBadge } from '@/modules/freight/status';

export const metadata = { title: 'Quotes — Jupiter Logistics' };

export default async function QuotesPage() {
  await requireModule('freight', 'freight.quotes.manage');
  const [rfqs, customerQuotes] = await Promise.all([listRfqs(), listCustomerQuotes()]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Quotes</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Request rates from carriers and agents, compare them, then issue the customer quotation. This is the
            workflow your future AI email-loop will run.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/freight/quotes/rfq/new" className="btn btn-ghost">New RFQ</Link>
          <Link href="/freight/quotes/customer/new" className="btn btn-primary">New quotation</Link>
        </div>
      </div>

      <section>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Requests for Quote (RFQs)</h2>
        {rfqs.length === 0 ? (
          <div className="card" style={{ padding: 20, marginBottom: 24 }}>
            <p className="muted" style={{ margin: 0 }}>No RFQs yet. <Link href="/freight/quotes/rfq/new">Raise one</Link> to start collecting supplier rates.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ marginBottom: 24 }}>
            <table className="table">
              <thead><tr><th style={{ width: 150 }}>Reference</th><th>Shipment</th><th className="date" style={{ width: 130 }}>Due</th><th style={{ width: 110 }}>Status</th></tr></thead>
              <tbody>
                {rfqs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}><Link href={`/freight/quotes/rfq/${r.id}`}>{r.reference ?? '—'}</Link></td>
                    <td>{r.shipment_id ? <Link href={`/freight/shipments/${r.shipment_id}`}>{r.shipmentRef ?? 'shipment'}</Link> : <span className="muted">standalone</span>}</td>
                    <td className="muted date">{formatDate(r.due_by)}</td>
                    <td><QuoteStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Customer quotations</h2>
        {customerQuotes.length === 0 ? (
          <div className="card" style={{ padding: 20 }}>
            <p className="muted" style={{ margin: 0 }}>No quotations yet. <Link href="/freight/quotes/customer/new">Create one</Link> from a shipment.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 150 }}>Reference</th><th>Shipment</th><th className="num" style={{ width: 150 }}>Total</th><th className="num" style={{ width: 140 }}>Margin</th><th style={{ width: 110 }}>Status</th></tr></thead>
              <tbody>
                {customerQuotes.map((q) => (
                  <tr key={q.id}>
                    <td style={{ fontWeight: 600 }}><Link href={`/freight/quotes/customer/${q.id}`}>{q.reference ?? '—'} <span className="muted">r{q.revision}</span></Link></td>
                    <td>{q.shipment_id ? <Link href={`/freight/shipments/${q.shipment_id}`}>{q.shipmentRef ?? 'shipment'}</Link> : '—'}</td>
                    <td className="num">{formatMoney(q.total_amount, q.currency_code ?? 'USD')}</td>
                    <td className="num">{formatMoney(q.margin, q.currency_code ?? 'USD')}</td>
                    <td><QuoteStatusBadge status={q.status} /></td>
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
