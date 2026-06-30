import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { listContacts } from '@/modules/freight/queries';
import { CONTACT_ROLE_LABELS } from '@/modules/freight/lifecycle';

export const metadata = { title: 'Contacts — Jupiter Logistics' };

export default async function ContactsPage({ searchParams }: { searchParams: { imported?: string; failed?: string } }) {
  await requireModule('freight', 'freight.contacts.manage');
  const contacts = await listContacts();
  const imported = searchParams?.imported;
  const failed = searchParams?.failed;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Contacts</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            One directory for clients, consignees, shippers, carriers, agents, brokers, truckers and authorities.
            A contact can hold several roles.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/freight/contacts/import" className="btn btn-ghost">Import CSV</Link>
          <Link href="/freight/contacts/new" className="btn btn-primary">New contact</Link>
        </div>
      </div>

      {imported ? (
        <div className="card" style={{ background: 'var(--success-weak)', color: 'var(--success)', borderColor: 'var(--success)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 620 }}>
          Imported {imported} contact{imported === '1' ? '' : 's'}{failed && failed !== '0' ? ` · ${failed} row(s) skipped` : ''}.
        </div>
      ) : null}

      {contacts.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No contacts yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>Add your first client, carrier or agent to start building shipments around them.</p>
          <Link href="/freight/contacts/new" className="btn btn-primary">New contact</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 110 }}>Type</th>
                <th>Roles</th>
                <th style={{ width: 80 }}>Country</th>
                <th style={{ width: 90 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}><Link href={`/freight/contacts/${c.id}`}>{c.name}</Link></td>
                  <td style={{ textTransform: 'capitalize' }}>{c.kind}</td>
                  <td className="muted">{(c.roles ?? []).map((r) => CONTACT_ROLE_LABELS[r] ?? r).join(', ') || '—'}</td>
                  <td>{c.country_code ?? <span className="muted">—</span>}</td>
                  <td>{c.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
