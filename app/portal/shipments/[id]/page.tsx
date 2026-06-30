import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { requirePortal } from '@/core/session/portal-guard';
import {
  getPortalShipmentDetail, getPortalMilestones, getPortalContainers,
  getPortalQuote, getPortalBilling,
} from '@/modules/freight/portal/queries';
import { StageBadge, RiskBadge, QuoteStatusBadge } from '@/modules/freight/status';
import { formatDate, formatMoney } from '@/lib/format';

export const metadata = { title: 'Shipment — Jupiter Logistics' };

const PAY: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'badge-success' },
  partial: { label: 'Part-paid', cls: 'badge-warning' },
  unpaid: { label: 'Unpaid', cls: 'badge-danger' },
  uninvoiced: { label: 'Not yet invoiced', cls: 'badge-neutral' },
};

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{label}</div>
      <div style={{ marginTop: 2 }}>{children}</div>
    </div>
  );
}

export default async function PortalShipmentDetail({ params }: { params: { id: string } }) {
  await requirePortal();
  const ship = await getPortalShipmentDetail(params.id);
  if (!ship) notFound();

  const [milestones, containers, quote, billing] = await Promise.all([
    getPortalMilestones(ship.id),
    getPortalContainers(ship.id),
    getPortalQuote(ship.id),
    getPortalBilling(ship.id),
  ]);
  const orderedMs = [...milestones].sort((a, b) => (a.actual_at ?? a.planned_at ?? '').localeCompare(b.actual_at ?? b.planned_at ?? ''));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href={'/portal' as Route}>My shipments</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>{ship.reference ?? 'Shipment'}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{[ship.origin_name, ship.destination_name].filter(Boolean).join(' → ')}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <StageBadge stage={ship.stage as never} />
          <Link href={`/portal/shipments/${ship.id}/documents` as Route} className="btn btn-ghost btn-sm">Documents</Link>
        </div>
      </div>

      {/* Overview */}
      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
          <Field label="Mode">{ship.mode ? pretty(ship.mode) : '—'}</Field>
          <Field label="Commodity">{ship.commodity ?? '—'}</Field>
          <Field label="Vessel / Voyage">{[ship.vessel, ship.voyage].filter(Boolean).join(' / ') || '—'}</Field>
          <Field label="B/L">{ship.bl_number ?? '—'}</Field>
          <Field label="ETD">{formatDate(ship.etd)}</Field>
          <Field label="ETA">{formatDate(ship.eta)}</Field>
          <Field label="Arrived">{formatDate(ship.ata)}</Field>
          <Field label="Packages">{ship.packages != null ? `${ship.packages}${ship.package_type ? ' ' + ship.package_type : ''}` : '—'}</Field>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, alignItems: 'start' }}>
        {/* Milestones */}
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Progress</h2>
          <div className="card" style={{ padding: 16 }}>
            {orderedMs.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>No milestones recorded yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {orderedMs.map((m) => (
                  <div key={m.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: m.actual_at ? 'var(--success)' : 'var(--border)', display: 'inline-block' }} />
                      <span style={{ color: m.actual_at ? 'var(--ink)' : 'var(--muted)' }}>{pretty(m.key)}</span>
                    </span>
                    <span className="muted num" style={{ fontSize: 'var(--text-sm)' }}>{formatDate(m.actual_at ?? m.planned_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Containers + free-time */}
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Containers</h2>
          <div className="card" style={{ padding: 16 }}>
            {containers.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>No containers on this shipment.</p>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {containers.map(({ row, ft }) => (
                  <div key={row.id} className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span>
                      <strong>{row.container_no ?? 'Container'}</strong>{' '}
                      <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>{[row.iso_type, row.size].filter(Boolean).join(' · ')}</span>
                      <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{row.current_location ?? pretty(row.status)}</div>
                    </span>
                    <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                      {ft.estPenalty > 0 ? <span className="num" style={{ fontWeight: 650, color: 'var(--danger)' }}>{formatMoney(ft.estPenalty, row.rate_currency ?? 'USD')}</span> : null}
                      <RiskBadge status={ft} />
                    </span>
                  </div>
                ))}
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)' }}>
                  Demurrage/detention shown is an estimate of charges that accrue if a container is not collected/returned within its free time.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Quotation + invoice */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, alignItems: 'start', marginTop: 20 }}>
        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Quotation</h2>
          <div className="card" style={{ padding: 16 }}>
            {!quote ? (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>No quotation issued yet.</p>
            ) : (
              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <span><strong>{quote.quote.reference ?? 'Quotation'}</strong> <span className="muted">rev {quote.quote.revision}</span></span>
                  <QuoteStatusBadge status={quote.quote.status} />
                </div>
                <table className="table">
                  <tbody>
                    {quote.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{formatMoney(l.amount, l.currency_code ?? quote.quote.currency_code ?? 'USD')}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>Total</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(quote.quote.total_amount, quote.quote.currency_code ?? 'USD')}</td>
                    </tr>
                  </tbody>
                </table>
                {quote.quote.valid_until ? <p className="muted" style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)' }}>Valid until {formatDate(quote.quote.valid_until)}</p> : null}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Invoice &amp; payment</h2>
          <div className="card" style={{ padding: 16 }}>
            {!billing || billing.status === 'uninvoiced' ? (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>No invoice issued yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Invoice total</span>
                  <span className="num">{formatMoney(billing.billing.invoice_total, 'USD')}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Paid</span>
                  <span className="num">{formatMoney(billing.billing.amount_paid, 'USD')}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="muted">Status</span>
                  <span className={`badge ${PAY[billing.status].cls}`}>{PAY[billing.status].label}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
