import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { globalSearch } from '@/modules/freight/queries';
import { CONTACT_ROLE_LABELS } from '@/modules/freight/lifecycle';
import { StageBadge, QuoteStatusBadge } from '@/modules/freight/status';

export const metadata = { title: 'Search — Jupiter Logistics' };

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: '0 0 8px' }}>
        {title} <span className="num">({count})</span>
      </h2>
      <div className="card" style={{ padding: 6 }}>{children}</div>
    </section>
  );
}

function Hit({ href, primary, secondary, badge }: { href: string; primary: React.ReactNode; secondary?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <Link href={href as never} className="account-item" style={{ justifyContent: 'space-between' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{primary}</span>
        {secondary ? <span className="muted" style={{ marginLeft: 8 }}>{secondary}</span> : null}
      </span>
      {badge}
    </Link>
  );
}

export default async function FreightSearchPage({ searchParams }: { searchParams: { q?: string } }) {
  await requireModule('freight');
  const q = (searchParams?.q ?? '').trim();
  const r = await globalSearch(q);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Search</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Find shipments, contacts, containers, quotes and RFQs in one place.</p>
        </div>
      </div>

      <form action="/freight/search" method="get" style={{ maxWidth: 620, marginBottom: 24 }}>
        <input
          name="q"
          className="input"
          defaultValue={q}
          autoFocus
          placeholder="Reference, B/L, booking, container no., customer, commodity, vessel…"
          aria-label="Search"
        />
      </form>

      {q.length < 2 ? (
        <p className="muted">Type at least two characters to search.</p>
      ) : r.total === 0 ? (
        <div className="card" style={{ padding: 24, maxWidth: 620 }}>
          <p style={{ margin: 0 }}>No matches for <strong>{q}</strong>.</p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
            Try a shipment reference (JL-…), a container number, a customer name, a B/L or booking reference.
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--text-sm)' }}>{r.total} result{r.total === 1 ? '' : 's'} for &ldquo;{q}&rdquo;</p>

          <Group title="Shipments" count={r.shipments.length}>
            {r.shipments.map((s) => (
              <Hit key={s.id} href={`/freight/shipments/${s.id}`}
                primary={s.reference ?? 'Shipment'}
                secondary={[s.customerName, s.lane, s.commodity].filter(Boolean).join(' · ') || undefined}
                badge={<StageBadge stage={s.stage as never} />} />
            ))}
          </Group>

          <Group title="Contacts" count={r.contacts.length}>
            {r.contacts.map((c) => (
              <Hit key={c.id} href={`/freight/contacts/${c.id}`}
                primary={c.name}
                secondary={(c.roles ?? []).map((x) => CONTACT_ROLE_LABELS[x] ?? x).join(', ') || undefined} />
            ))}
          </Group>

          <Group title="Containers" count={r.containers.length}>
            {r.containers.map((c) => (
              <Hit key={c.id} href={c.shipment_id ? `/freight/shipments/${c.shipment_id}` : '/freight/containers'}
                primary={c.container_no ?? 'Container'}
                secondary={c.shipmentRef ?? undefined}
                badge={<span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>{c.status.replace(/_/g, ' ')}</span>} />
            ))}
          </Group>

          <Group title="Customer quotations" count={r.customerQuotes.length}>
            {r.customerQuotes.map((cq) => (
              <Hit key={cq.id} href={`/freight/quotes/customer/${cq.id}`}
                primary={cq.reference ?? 'Quotation'}
                badge={<QuoteStatusBadge status={cq.status} />} />
            ))}
          </Group>

          <Group title="RFQs" count={r.rfqs.length}>
            {r.rfqs.map((rfq) => (
              <Hit key={rfq.id} href={`/freight/quotes/rfq/${rfq.id}`}
                primary={rfq.reference ?? 'RFQ'}
                badge={<QuoteStatusBadge status={rfq.status} />} />
            ))}
          </Group>
        </>
      )}
    </div>
  );
}
