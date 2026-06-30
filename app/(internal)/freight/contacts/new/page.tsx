import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { createContact } from '@/modules/freight/actions';
import { CONTACT_ROLE_LABELS } from '@/modules/freight/lifecycle';

export const metadata = { title: 'New contact — Jupiter Logistics' };

export default async function NewContactPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('freight', 'freight.contacts.manage');
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/contacts">Contacts</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New contact</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Add a company or person and the roles they play.</p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 640 }}>
          {error}
        </div>
      ) : null}

      <form action={createContact} className="card" style={{ padding: 20, maxWidth: 640, display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" placeholder="e.g. Maersk Line / John Smith" required />
          </div>
          <div className="field">
            <label className="label" htmlFor="kind">Type</label>
            <select id="kind" name="kind" className="input" defaultValue="organization">
              <option value="organization">Organization</option>
              <option value="person">Person</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="label">Roles</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '6px 14px' }}>
            {Object.entries(CONTACT_ROLE_LABELS).map(([k, v]) => (
              <label key={k} className="row" style={{ gap: 8, fontSize: 'var(--text-sm)', alignItems: 'center' }}>
                <input type="checkbox" name="roles" value={k} /> {v}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" className="input" type="email" placeholder="ops@example.com" />
          </div>
          <div className="field">
            <label className="label" htmlFor="phone">Phone</label>
            <input id="phone" name="phone" className="input" placeholder="+1 868 …" />
          </div>
          <div className="field">
            <label className="label" htmlFor="country_code">Country</label>
            <input id="country_code" name="country_code" className="input" placeholder="TT" maxLength={2} />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="payment_terms">Payment terms (optional)</label>
          <input id="payment_terms" name="payment_terms" className="input" placeholder="e.g. 30 days net" />
        </div>
        <div className="field">
          <label className="label" htmlFor="notes">Notes (optional)</label>
          <textarea id="notes" name="notes" className="input" rows={3} />
        </div>

        <div><button type="submit" className="btn btn-primary">Create contact</button></div>
      </form>
    </div>
  );
}
