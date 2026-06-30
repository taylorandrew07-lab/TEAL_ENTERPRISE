import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireModule } from '@/core/session/guard';
import { formatDate, formatMoney } from '@/lib/format';
import {
  getShipment, getShipmentParties, getShipmentMilestones, getShipmentTasks,
  getShipmentCommunications, getShipmentCharges, getShipmentContainers, listContacts, getShipmentQuotes,
  getShipmentDocuments, getShipmentBilling, getShipmentPayments, paymentStatus,
} from '@/modules/freight/queries';
import {
  STAGE_ORDER, STAGE_LABELS, MODE_LABELS, DIRECTION_LABELS, CONTACT_ROLE_LABELS, nextStage,
} from '@/modules/freight/lifecycle';
import { StageBadge, ShipmentStatusBadge, QuoteStatusBadge, DocVisibilityBadge } from '@/modules/freight/status';
import {
  setShipmentStage, setShipmentStatus, addShipmentParty, createTask, setTaskStatus,
  addCommunication, addCharge, addContainer, updateContainer, recordManualTracking, refreshContainerTracking,
  setShipmentBilling, recordShipmentPayment, releaseShipment,
} from '@/modules/freight/actions';
import { uploadShipmentDocument, deleteShipmentDocument } from '@/modules/freight/documents';

const PAY_BADGE: Record<string, string> = { paid: 'badge-success', partial: 'badge-warning', unpaid: 'badge-danger', uninvoiced: 'badge-neutral' };
import { computeFreeTime, riskLabel } from '@/modules/freight/freetime';
import { CARRIERS } from '@/modules/freight/tracking';
import { TrackLinks } from '@/modules/freight/TrackLinks';

const RISK_BADGE: Record<string, string> = { overdue: 'badge-danger', watch: 'badge-warning', none: 'badge-neutral' };
const TRACK_OPTIONS = CARRIERS.filter((c) => c.track).map((c) => ({ key: c.key, name: c.name, track: c.track as string }));

const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'master_bl', label: 'Master B/L (internal)' },
  { value: 'house_bl', label: 'House B/L (client)' },
  { value: 'commercial_invoice', label: 'Commercial Invoice' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'booking_confirmation', label: 'Booking Confirmation' },
  { value: 'arrival_notice', label: 'Arrival Notice' },
  { value: 'delivery_order', label: 'Delivery Order' },
  { value: 'proof_of_delivery', label: 'Proof of Delivery' },
  { value: 'air_waybill', label: 'Air Waybill' },
  { value: 'cargo_receipt', label: 'Cargo Receipt' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'photo', label: 'Photo' },
  { value: 'scan', label: 'Scan' },
  { value: 'other', label: 'Other' },
];

const MILESTONE_LABELS: Record<string, string> = {
  booked: 'Booked', collected: 'Collected', export_cleared: 'Export cleared', loaded: 'Loaded',
  departed: 'Departed', arrived: 'Arrived', customs_cleared: 'Customs cleared', released: 'Released',
  delivered: 'Delivered', completed: 'Completed',
};
const PARTY_ROLES = ['customer', 'shipper', 'consignee', 'notify', 'carrier', 'origin_agent', 'dest_agent', 'customs_broker', 'trucker', 'warehouse', 'other'];

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ marginTop: 2 }}>{value ?? <span className="muted">—</span>}</div>
    </div>
  );
}

export default async function ShipmentWorkspace({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  await requireModule('freight', 'freight.shipments.manage');
  const s = await getShipment(params.id);
  if (!s) notFound();

  const [parties, milestones, tasks, comms, charges, containers, contacts, quotes, documents, billing, payments] = await Promise.all([
    getShipmentParties(s.id), getShipmentMilestones(s.id), getShipmentTasks(s.id),
    getShipmentCommunications(s.id), getShipmentCharges(s.id), getShipmentContainers(s.id), listContacts(),
    getShipmentQuotes(s.id), getShipmentDocuments(s.id), getShipmentBilling(s.id), getShipmentPayments(s.id),
  ]);
  const payStat = paymentStatus(billing);
  const balanceDue = Math.max(0, billing.invoice_total - billing.amount_paid);

  const ccy = s.currency_code ?? 'USD';
  const error = searchParams?.error;
  const suggested = nextStage(s.stage);
  const milestoneByKey = new Map(milestones.map((m) => [m.key, m]));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/shipments">Shipments</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>
            {s.reference ?? 'Shipment'} <span style={{ marginLeft: 8 }}><StageBadge stage={s.stage} /></span>{' '}
            <ShipmentStatusBadge status={s.status} />
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {s.customerName ?? 'No customer'} · {[s.origin_name, s.destination_name].filter(Boolean).join(' → ') || 'lane TBC'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <form action={setShipmentStatus}>
            <input type="hidden" name="id" value={s.id} />
            <select name="status" className="input btn-sm" defaultValue={s.status} style={{ width: 'auto' }}>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="cancelled">Cancelled</option>
            </select>{' '}
            <button className="btn btn-ghost btn-sm" type="submit">Set status</button>
          </form>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16 }}>{error}</div>
      ) : null}

      {/* Stage advance */}
      <div className="card" style={{ padding: 16 }}>
        <form action={setShipmentStage} className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="id" value={s.id} />
          <div className="field" style={{ minWidth: 240 }}>
            <label className="label" htmlFor="stage">Lifecycle stage</label>
            <select id="stage" name="stage" className="input" defaultValue={s.stage}>
              {STAGE_ORDER.map((st) => <option key={st} value={st}>{STAGE_LABELS[st]}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Update stage</button>
          {suggested ? <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>Next: {STAGE_LABELS[suggested]} — advancing auto-raises its tasks &amp; milestones.</span> : null}
        </form>
      </div>

      {/* Overview */}
      <Section title="Overview">
        <div className="card" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
          <Detail label="Mode" value={s.mode ? MODE_LABELS[s.mode] : null} />
          <Detail label="Direction" value={s.direction ? DIRECTION_LABELS[s.direction] : null} />
          <Detail label="Incoterm" value={s.incoterm} />
          <Detail label="Commodity" value={s.commodity} />
          <Detail label="Weight (kg)" value={s.weight_kg} />
          <Detail label="Volume (m³)" value={s.volume_m3} />
          <Detail label="ETD" value={formatDate(s.etd)} />
          <Detail label="ETA" value={formatDate(s.eta)} />
          <Detail label="Vessel / Voyage" value={[s.vessel, s.voyage].filter(Boolean).join(' / ') || null} />
          <Detail label="Booking ref" value={s.booking_ref} />
          <Detail label="B/L number" value={s.bl_number} />
          <Detail label="Dangerous goods" value={s.is_dangerous_goods ? 'Yes' : 'No'} />
        </div>
      </Section>

      {/* Financial summary */}
      <Section title="Financial summary">
        <div className="card" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
          <Detail label="Customer charges" value={<span className="num">{formatMoney(s.total_charge, ccy)}</span>} />
          <Detail label="Supplier costs" value={<span className="num">{formatMoney(s.total_cost, ccy)}</span>} />
          <Detail label="Expected profit" value={<span className="num" style={{ fontWeight: 650 }}>{formatMoney(s.expected_profit, ccy)}</span>} />
        </div>
      </Section>

      {/* Quotes */}
      <Section
        title="Quotes"
        action={
          <div className="row" style={{ gap: 8 }}>
            <Link href={`/freight/quotes/rfq/new?shipment=${s.id}`} className="btn btn-ghost btn-sm">New RFQ</Link>
            <Link href={`/freight/quotes/customer/new?shipment=${s.id}`} className="btn btn-ghost btn-sm">New quotation</Link>
          </div>
        }
      >
        {quotes.rfqs.length === 0 && quotes.customerQuotes.length === 0 ? (
          <p className="muted">No RFQs or quotations yet. Raise an RFQ to gather carrier rates, then issue a customer quotation.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {quotes.rfqs.length > 0 ? (
              <div>
                <div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginBottom: 4 }}>RFQs</div>
                {quotes.rfqs.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
                    <Link href={`/freight/quotes/rfq/${r.id}`}>{r.reference ?? 'RFQ'}</Link>
                    <QuoteStatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            ) : null}
            {quotes.customerQuotes.length > 0 ? (
              <div>
                <div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginBottom: 4 }}>Customer quotations</div>
                {quotes.customerQuotes.map((cq) => (
                  <div key={cq.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
                    <Link href={`/freight/quotes/customer/${cq.id}`}>{cq.reference ?? 'Quotation'} <span className="muted">rev {cq.revision}</span></Link>
                    <span><span className="num" style={{ marginRight: 10 }}>{formatMoney(cq.total_amount, cq.currency_code ?? ccy)}</span><QuoteStatusBadge status={cq.status} /></span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Section>

      {/* Parties */}
      <Section title="Parties">
        {parties.length > 0 ? (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table">
              <thead><tr><th style={{ width: 180 }}>Role</th><th>Contact</th></tr></thead>
              <tbody>
                {parties.map((p) => (
                  <tr key={p.id}>
                    <td>{CONTACT_ROLE_LABELS[p.role] ?? p.role}</td>
                    <td><Link href={`/freight/contacts/${p.contact_id}`}>{p.contactName ?? '—'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No parties linked yet.</p>}
        <form action={addShipmentParty} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="shipment_id" value={s.id} />
          <div className="field"><label className="label">Contact</label>
            <select name="contact_id" className="input" required defaultValue="" style={{ minWidth: 200 }}>
              <option value="" disabled>Choose…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field"><label className="label">Role</label>
            <select name="role" className="input" defaultValue="shipper">
              {PARTY_ROLES.map((r) => <option key={r} value={r}>{CONTACT_ROLE_LABELS[r] ?? r}</option>)}
            </select>
          </div>
          <button className="btn btn-ghost" type="submit">Add party</button>
        </form>
      </Section>

      {/* Milestones */}
      <Section title="Milestones">
        <div className="card" style={{ padding: 8 }}>
          {Object.keys(MILESTONE_LABELS).map((k) => {
            const m = milestoneByKey.get(k);
            const done = m?.actual_at;
            return (
              <div key={k} className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                <span>{done ? '✓ ' : '○ '}{MILESTONE_LABELS[k]}</span>
                <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>{done ? formatDate(m!.actual_at) : (m ? 'pending' : '—')}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Tasks */}
      <Section title="Tasks">
        {tasks.length > 0 ? (
          <div className="card" style={{ padding: 8, marginBottom: 12 }}>
            {tasks.map((t) => (
              <div key={t.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
                  {t.auto_generated ? <span className="badge badge-neutral" style={{ marginLeft: 8 }}>auto</span> : null}
                  {t.due_at ? <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--text-sm)' }}>due {formatDate(t.due_at)}</span> : null}
                </div>
                {t.status !== 'done' ? (
                  <form action={setTaskStatus}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="status" value="done" />
                    <input type="hidden" name="return_to" value={`/freight/shipments/${s.id}`} />
                    <button className="btn btn-ghost btn-sm" type="submit">Mark done</button>
                  </form>
                ) : <span className="badge badge-success">Done</span>}
              </div>
            ))}
          </div>
        ) : <p className="muted">No tasks yet.</p>}
        <form action={createTask} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="shipment_id" value={s.id} />
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label className="label">New task</label>
            <input name="title" className="input" placeholder="e.g. Chase carrier for sailing schedule" required />
          </div>
          <div className="field"><label className="label">Priority</label>
            <select name="priority" className="input" defaultValue="normal">
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="field"><label className="label">Due</label><input name="due_at" type="date" className="input" /></div>
          <button className="btn btn-ghost" type="submit">Add task</button>
        </form>
      </Section>

      {/* Communications */}
      <Section title="Communication centre">
        {comms.length > 0 ? (
          <div style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
            {comms.map((c) => (
              <div key={c.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="badge badge-neutral" style={{ marginRight: 8 }}>{c.channel}</span>
                    {c.subject ?? `${c.direction} ${c.channel}`}
                    {c.ai_generated ? <span className="badge badge-brand" style={{ marginLeft: 8 }}>AI</span> : null}
                  </strong>
                  <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>{formatDate(c.occurred_at)}</span>
                </div>
                {c.body ? <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)' }}>{c.body}</p> : null}
              </div>
            ))}
          </div>
        ) : <p className="muted">No communications logged. Outlook email will thread in here once connected.</p>}
        <form action={addCommunication} className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <input type="hidden" name="shipment_id" value={s.id} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="field"><label className="label">Channel</label>
              <select name="channel" className="input" defaultValue="note">
                <option value="note">Note</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="meeting">Meeting</option><option value="email">Email</option>
              </select>
            </div>
            <div className="field"><label className="label">Direction</label>
              <select name="direction" className="input" defaultValue="internal">
                <option value="internal">Internal</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}><label className="label">Subject (optional)</label><input name="subject" className="input" /></div>
          </div>
          <div className="field"><label className="label">Note</label><textarea name="body" className="input" rows={2} placeholder="What happened / what was said" required /></div>
          <div><button className="btn btn-ghost" type="submit">Log communication</button></div>
        </form>
      </Section>

      {/* Containers + free-time / tracking */}
      <Section title="Containers & tracking">
        {containers.length > 0 ? (
          <div style={{ display: 'grid', gap: 12, marginBottom: 12 }}>
            {containers.map((c) => {
              const ft = computeFreeTime(c);
              return (
                <div key={c.id} className="card" style={{ padding: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <strong>{c.container_no ?? 'Container'} <span className="muted" style={{ fontWeight: 400 }}>{[c.iso_type, c.size].filter(Boolean).join(' · ')}</span></strong>
                    <span className="row" style={{ gap: 8 }}>
                      {ft.estPenalty > 0 ? <span className="num" style={{ fontWeight: 650, color: 'var(--danger)' }}>{formatMoney(ft.estPenalty, ft.rateCurrency ?? ccy)}</span> : null}
                      <span className={`badge ${RISK_BADGE[ft.risk]}`}>{riskLabel(ft)}</span>
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--text-sm)', margin: '4px 0 10px' }}>
                    {c.current_location ?? 'location unknown'} · {c.status.replace(/_/g, ' ')}
                  </div>

                  {/* Update dates → auto free-time recompute */}
                  <form action={updateContainer} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="shipment_id" value={s.id} />
                    <div className="field"><label className="label">Free days</label><input name="free_time_days" type="number" className="input" defaultValue={c.free_time_days ?? ''} style={{ width: 80 }} /></div>
                    <div className="field"><label className="label">Discharged</label><input name="discharge_date" type="date" className="input" defaultValue={c.discharge_date ?? ''} /></div>
                    <div className="field"><label className="label">Gated out</label><input name="gate_out_date" type="date" className="input" defaultValue={c.gate_out_date ?? ''} /></div>
                    <div className="field"><label className="label">Returned</label><input name="returned_date" type="date" className="input" defaultValue={c.returned_date ?? ''} /></div>
                    <div className="field"><label className="label">Status</label>
                      <select name="status" className="input" defaultValue={c.status}>
                        {['planned', 'allocated', 'loaded', 'in_transit', 'discharged', 'gated_out', 'returned'].map((st) => <option key={st} value={st}>{st.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div className="field"><label className="label">Demurrage/day</label><input name="demurrage_rate" type="number" step="0.01" className="input" defaultValue={c.demurrage_rate ?? ''} style={{ width: 110 }} /></div>
                    <div className="field"><label className="label">Detention/day</label><input name="detention_rate" type="number" step="0.01" className="input" defaultValue={c.detention_rate ?? ''} style={{ width: 110 }} /></div>
                    <div className="field"><label className="label">Storage/day</label><input name="storage_rate" type="number" step="0.01" className="input" defaultValue={c.storage_rate ?? ''} style={{ width: 100 }} /></div>
                    <div className="field"><label className="label">Ccy</label><input name="rate_currency" className="input" defaultValue={c.rate_currency ?? ccy} maxLength={3} style={{ width: 64 }} /></div>
                    <button className="btn btn-ghost btn-sm" type="submit">Save</button>
                  </form>

                  {/* Tracking: open carrier site (manual) + API refresh + manual record */}
                  <div className="row" style={{ gap: 16, alignItems: 'end', flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <TrackLinks containerNo={c.container_no} options={TRACK_OPTIONS} />
                    <form action={refreshContainerTracking} className="row" style={{ gap: 6, alignItems: 'end' }}>
                      <input type="hidden" name="container_id" value={c.id} />
                      <input type="hidden" name="shipment_id" value={s.id} />
                      <input type="hidden" name="container_no" value={c.container_no ?? ''} />
                      <div className="field"><label className="label">Line</label>
                        <select name="carrier_key" className="input" defaultValue="manual">
                          {CARRIERS.map((cr) => <option key={cr.key} value={cr.key}>{cr.name}{cr.hasApi ? '' : ' (manual)'}</option>)}
                        </select>
                      </div>
                      <button className="btn btn-ghost btn-sm" type="submit">Refresh ETA</button>
                    </form>
                    <form action={recordManualTracking} className="row" style={{ gap: 6, alignItems: 'end', flexWrap: 'wrap' }}>
                      <input type="hidden" name="container_id" value={c.id} />
                      <input type="hidden" name="shipment_id" value={s.id} />
                      <div className="field"><label className="label">Event</label><input name="event_type" className="input" placeholder="e.g. discharged" style={{ width: 130 }} /></div>
                      <div className="field"><label className="label">Location</label><input name="location" className="input" placeholder="port" style={{ width: 120 }} /></div>
                      <div className="field"><label className="label">ETA</label><input name="eta" type="date" className="input" /></div>
                      <button className="btn btn-ghost btn-sm" type="submit">Record</button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <p className="muted">No containers yet.</p>}

        <form action={addContainer} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="shipment_id" value={s.id} />
          <div className="field"><label className="label">Add container no.</label><input name="container_no" className="input" placeholder="MSKU1234567" style={{ width: 160 }} /></div>
          <div className="field"><label className="label">ISO type</label><input name="iso_type" className="input" placeholder="40HC" style={{ width: 90 }} /></div>
          <div className="field"><label className="label">Size</label><input name="size" className="input" placeholder="40ft" style={{ width: 80 }} /></div>
          <div className="field"><label className="label">Owner</label>
            <select name="ownership" className="input" defaultValue="coc"><option value="coc">Carrier (COC)</option><option value="soc">Shipper (SOC)</option></select>
          </div>
          <div className="field"><label className="label">Free days</label><input name="free_time_days" type="number" className="input" style={{ width: 80 }} /></div>
          <button className="btn btn-ghost" type="submit">Add container</button>
        </form>
      </Section>

      {/* Documents */}
      <Section title="Documents">
        {documents.length > 0 ? (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table">
              <thead><tr><th>File</th><th style={{ width: 170 }}>Type</th><th style={{ width: 140 }}>Visibility</th><th style={{ width: 150 }} /></tr></thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title ?? d.filename}</a> : (d.title ?? d.filename)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{d.doc_type.replace(/_/g, ' ')}</td>
                    <td><DocVisibilityBadge visibility={d.visibility} /></td>
                    <td>
                      <form action={deleteShipmentDocument}>
                        <input type="hidden" name="shipment_id" value={s.id} />
                        <input type="hidden" name="document_id" value={d.document_id} />
                        <button className="btn btn-ghost btn-sm" type="submit">Delete</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No documents yet. Master B/Ls default to <strong>Internal only</strong>; House B/Ls to <strong>Client-visible</strong>.</p>}
        <form action={uploadShipmentDocument} className="card" style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="shipment_id" value={s.id} />
          <div className="field"><label className="label">File</label><input name="file" type="file" className="input" required /></div>
          <div className="field"><label className="label">Type</label>
            <select name="doc_type" className="input" defaultValue="house_bl">
              {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field"><label className="label">Visibility</label>
            <select name="visibility" className="input" defaultValue="auto">
              <option value="auto">Auto (by type)</option>
              <option value="internal">Internal only</option>
              <option value="client_visible">Client-visible</option>
              <option value="client_on_request">On request</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}><label className="label">Title (optional)</label><input name="title" className="input" /></div>
          <button className="btn btn-ghost" type="submit">Upload</button>
        </form>
      </Section>

      {/* Financials detail */}
      <Section title="Costs & charges">
        {charges.length > 0 ? (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table">
              <thead><tr><th style={{ width: 90 }}>Kind</th><th>Description</th><th className="num" style={{ width: 160 }}>Amount</th><th style={{ width: 90 }}>Invoiced</th></tr></thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id}>
                    <td><span className={`badge ${c.kind === 'charge' ? 'badge-success' : 'badge-warning'}`}>{c.kind === 'charge' ? 'Charge' : 'Cost'}</span></td>
                    <td>{c.description}{c.charge_code ? <span className="muted"> · {c.charge_code}</span> : null}</td>
                    <td className="num">{formatMoney(c.amount, c.currency_code ?? ccy)}</td>
                    <td>{c.invoiced ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No costs or charges recorded yet.</p>}
        <form action={addCharge} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="shipment_id" value={s.id} />
          <div className="field"><label className="label">Kind</label>
            <select name="kind" className="input" defaultValue="charge"><option value="charge">Customer charge</option><option value="cost">Supplier cost</option></select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}><label className="label">Description</label><input name="description" className="input" placeholder="e.g. Ocean freight" required /></div>
          <div className="field"><label className="label">Code</label><input name="charge_code" className="input" placeholder="OFR" style={{ width: 90 }} /></div>
          <div className="field"><label className="label">Amount</label><input name="amount" type="number" step="0.01" className="input" style={{ width: 120 }} required /></div>
          <div className="field"><label className="label">Ccy</label><input name="currency_code" className="input" defaultValue={ccy} maxLength={3} style={{ width: 70 }} /></div>
          <button className="btn btn-ghost" type="submit">Add line</button>
        </form>
      </Section>

      {/* Payment & release */}
      <Section title="Payment & release">
        <div className="card" style={{ padding: 18, display: 'grid', gap: 16 }}>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <Detail label="Invoiced" value={<span className="num">{formatMoney(billing.invoice_total, ccy)}</span>} />
            <Detail label="Paid" value={<span className="num">{formatMoney(billing.amount_paid, ccy)}</span>} />
            <Detail label="Balance due" value={<span className="num" style={{ fontWeight: 650, color: balanceDue > 0 ? 'var(--danger)' : undefined }}>{formatMoney(balanceDue, ccy)}</span>} />
            <Detail label="Status" value={<span className={`badge ${PAY_BADGE[payStat]}`} style={{ textTransform: 'capitalize' }}>{payStat}</span>} />
            <Detail label="Cargo release" value={billing.released
              ? <span className="badge badge-success">Released</span>
              : <span className="badge badge-warning">Held</span>} />
          </div>

          {/* Set what we billed + terms */}
          <form action={setShipmentBilling} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <input type="hidden" name="shipment_id" value={s.id} />
            <div className="field"><label className="label">Invoice total</label><input name="invoice_total" type="number" step="0.01" className="input" defaultValue={billing.invoice_total || ''} style={{ width: 140 }} /></div>
            <div className="field"><label className="label">Terms</label>
              <select name="payment_terms" className="input" defaultValue={billing.payment_terms}>
                <option value="prepaid">Prepaid (pay before release)</option>
                <option value="open_account">Open account (credit)</option>
              </select>
            </div>
            <button className="btn btn-ghost btn-sm" type="submit">Save billing</button>
          </form>

          {/* Record a payment */}
          <form action={recordShipmentPayment} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <input type="hidden" name="shipment_id" value={s.id} />
            <div className="field"><label className="label">Payment received</label><input name="amount" type="number" step="0.01" className="input" style={{ width: 130 }} required /></div>
            <div className="field"><label className="label">Ccy</label><input name="currency_code" className="input" defaultValue={ccy} maxLength={3} style={{ width: 64 }} /></div>
            <div className="field"><label className="label">Method</label><input name="method" className="input" placeholder="wire" style={{ width: 100 }} /></div>
            <div className="field"><label className="label">Ref</label><input name="reference" className="input" style={{ width: 110 }} /></div>
            <div className="field"><label className="label">Date</label><input name="paid_at" type="date" className="input" /></div>
            <button className="btn btn-ghost btn-sm" type="submit">Record payment</button>
          </form>

          {payments.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th className="date" style={{ width: 120 }}>Date</th><th className="num" style={{ width: 140 }}>Amount</th><th>Method</th><th>Ref</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}><td className="muted date">{formatDate(p.paid_at)}</td><td className="num">{formatMoney(p.amount, p.currency_code ?? ccy)}</td><td>{p.method ?? '—'}</td><td className="muted">{p.reference ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Release gate */}
          {billing.released ? (
            <p className="muted" style={{ margin: 0 }}>✓ Cargo released{billing.released_at ? ` on ${formatDate(billing.released_at)}` : ''}. The delivery order can be issued.</p>
          ) : (
            <form action={releaseShipment} className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <input type="hidden" name="shipment_id" value={s.id} />
              <button className="btn btn-primary" type="submit" disabled={false}>Release cargo / issue delivery order</button>
              {payStat !== 'paid' && billing.payment_terms !== 'open_account' ? (
                <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)' }}>
                  <input type="checkbox" name="override" /> Override (release on credit — balance {formatMoney(balanceDue, ccy)} outstanding)
                </label>
              ) : null}
              <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                {billing.payment_terms === 'open_account' ? 'Open-account terms — release allowed.' : payStat === 'paid' ? 'Paid in full — safe to release.' : 'Held until paid in full (or override).'}
              </span>
            </form>
          )}
        </div>
      </Section>
    </div>
  );
}
