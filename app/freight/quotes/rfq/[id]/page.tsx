import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireModule } from '@/core/session/guard';
import { formatDate, formatMoney } from '@/lib/format';
import { getRfq, getRfqRecipients, getSupplierQuotesForRfq, listContacts } from '@/modules/freight/queries';
import { QuoteStatusBadge } from '@/modules/freight/status';
import { addRfqRecipient, markRecipientSent, recordSupplierQuote, selectSupplierQuote, createCustomerQuote } from '@/modules/freight/actions';

export const metadata = { title: 'RFQ — Jupiter Logistics' };

export default async function RfqDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  await requireModule('freight', 'freight.quotes.manage');
  const rfq = await getRfq(params.id);
  if (!rfq) notFound();
  const [recipients, quotes, contacts] = await Promise.all([
    getRfqRecipients(rfq.id), getSupplierQuotesForRfq(rfq.id), listContacts(),
  ]);
  const error = searchParams?.error;
  const best = quotes.filter((q) => q.total_amount != null).slice(0, 1)[0];
  const selected = quotes.find((q) => q.status === 'selected');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/quotes">Quotes</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>{rfq.reference ?? 'RFQ'} <span style={{ marginLeft: 8 }}><QuoteStatusBadge status={rfq.status} /></span></h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {rfq.shipment_id ? <Link href={`/freight/shipments/${rfq.shipment_id}`}>{rfq.shipmentRef ?? 'shipment'}</Link> : 'standalone enquiry'}
            {rfq.due_by ? <> · responses due {formatDate(rfq.due_by)}</> : null}
          </p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16 }}>{error}</div>
      ) : null}

      {/* Recipients */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Recipients</h2>
        {recipients.length > 0 ? (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table">
              <thead><tr><th>Contact</th><th style={{ width: 120 }}>Status</th><th className="date" style={{ width: 130 }}>Sent</th><th style={{ width: 90 }} /></tr></thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td>{r.contactName ?? '—'}</td>
                    <td><QuoteStatusBadge status={r.status} /></td>
                    <td className="muted date">{formatDate(r.sent_at)}</td>
                    <td>
                      {r.status === 'pending' ? (
                        <form action={markRecipientSent}>
                          <input type="hidden" name="rfq_id" value={rfq.id} />
                          <input type="hidden" name="id" value={r.id} />
                          <button className="btn btn-ghost btn-sm" type="submit">Mark sent</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No recipients yet — add the carriers/agents to ask.</p>}
        <form action={addRfqRecipient} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="rfq_id" value={rfq.id} />
          <div className="field" style={{ minWidth: 240 }}><label className="label">Add recipient</label>
            <select name="contact_id" className="input" required defaultValue="">
              <option value="" disabled>Choose a carrier / agent…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button className="btn btn-ghost" type="submit">Add</button>
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>Sending the actual email is the Microsoft 365 connector (next build) — or your AI, later.</span>
        </form>
      </section>

      {/* Supplier quotes comparison */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Supplier quotes</h2>
        {quotes.length > 0 ? (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table">
              <thead><tr><th>Supplier</th><th className="num" style={{ width: 150 }}>Total</th><th className="num" style={{ width: 110 }}>Transit</th><th className="date" style={{ width: 120 }}>Valid to</th><th style={{ width: 110 }}>Status</th><th style={{ width: 90 }} /></tr></thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} style={best && q.id === best.id ? { background: 'var(--primary-weak)' } : undefined}>
                    <td>{q.contactName ?? '—'}{best && q.id === best.id ? <span className="badge badge-success" style={{ marginLeft: 8 }}>lowest</span> : null}</td>
                    <td className="num">{q.total_amount != null ? formatMoney(q.total_amount, q.currency_code ?? 'USD') : '—'}</td>
                    <td className="num">{q.transit_time_days != null ? `${q.transit_time_days}d` : '—'}</td>
                    <td className="muted date">{formatDate(q.valid_until)}</td>
                    <td><QuoteStatusBadge status={q.status} /></td>
                    <td>
                      {q.status !== 'selected' ? (
                        <form action={selectSupplierQuote}>
                          <input type="hidden" name="rfq_id" value={rfq.id} />
                          <input type="hidden" name="id" value={q.id} />
                          <button className="btn btn-ghost btn-sm" type="submit">Select</button>
                        </form>
                      ) : <span className="badge badge-success">Selected</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No supplier quotes recorded yet.</p>}

        <form action={recordSupplierQuote} className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <input type="hidden" name="rfq_id" value={rfq.id} />
          <input type="hidden" name="shipment_id" value={rfq.shipment_id ?? ''} />
          <strong style={{ fontSize: 'var(--text-sm)' }}>Record a supplier quote</strong>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <div className="field" style={{ minWidth: 200 }}><label className="label">Supplier</label>
              <select name="contact_id" className="input" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="label">Total</label><input name="total_amount" type="number" step="0.01" className="input" style={{ width: 130 }} /></div>
            <div className="field"><label className="label">Ccy</label><input name="currency_code" className="input" defaultValue="USD" maxLength={3} style={{ width: 70 }} /></div>
            <div className="field"><label className="label">Transit (days)</label><input name="transit_time_days" type="number" className="input" style={{ width: 110 }} /></div>
            <div className="field"><label className="label">Valid to</label><input name="valid_until" type="date" className="input" /></div>
          </div>
          <div className="field"><label className="label">Notes</label><input name="notes" className="input" placeholder="e.g. excludes THC, subject to space" /></div>
          <div><button className="btn btn-ghost" type="submit">Record quote</button></div>
        </form>
      </section>

      {/* Build customer quotation */}
      {rfq.shipment_id ? (
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Build customer quotation</h2>
          <form action={createCustomerQuote} className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            <input type="hidden" name="shipment_id" value={rfq.shipment_id} />
            <div className="field"><label className="label">Cost basis (supplier quote)</label>
              <select name="supplier_quote_id" className="input" defaultValue={selected?.id ?? ''} style={{ minWidth: 220 }}>
                <option value="">— none —</option>
                {quotes.map((q) => <option key={q.id} value={q.id}>{q.contactName} · {q.total_amount != null ? formatMoney(q.total_amount, q.currency_code ?? 'USD') : 'n/a'}</option>)}
              </select>
            </div>
            <div className="field"><label className="label">Valid to</label><input name="valid_until" type="date" className="input" /></div>
            <button className="btn btn-primary" type="submit">Create quotation →</button>
          </form>
        </section>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Link this RFQ to a shipment to build a customer quotation from it.</p>
      )}
    </div>
  );
}
