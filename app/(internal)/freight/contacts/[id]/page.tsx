import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireModule } from '@/core/session/guard';
import { getContact } from '@/modules/freight/queries';
import { CONTACT_ROLE_LABELS } from '@/modules/freight/lifecycle';

export const metadata = { title: 'Contact — Jupiter Logistics' };

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  await requireModule('freight', 'freight.contacts.manage');
  const c = await getContact(params.id);
  if (!c) notFound();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/contacts">Contacts</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>{c.name}</h1>
          <p className="muted" style={{ margin: '4px 0 0', textTransform: 'capitalize' }}>{c.kind}</p>
        </div>
      </div>

      <div className="card" style={{ padding: 18, display: 'grid', gap: 14, maxWidth: 640 }}>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>Roles</div>
          <div>{(c.roles ?? []).map((r) => CONTACT_ROLE_LABELS[r] ?? r).join(', ') || '—'}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>Emails</div>
          <div>{(c.emails ?? []).map((e) => e.address).filter(Boolean).join(', ') || '—'}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>Phones</div>
          <div>{(c.phones ?? []).map((p) => p.number).filter(Boolean).join(', ') || '—'}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>Country</div>
          <div>{c.country_code ?? '—'}</div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 16 }}>
        Multiple named people, credit limits, certificates, document store and full communication history per
        contact arrive in a later build — the schema already holds them.
      </p>
    </div>
  );
}
