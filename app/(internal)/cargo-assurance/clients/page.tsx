import { requireModule } from '@/core/session/guard';
import { listClients } from '@/modules/cargo-assurance/queries';
import { addClient } from '@/modules/cargo-assurance/actions';

export const metadata = { title: 'Clients — TEAL Cargo Assurance' };

export default async function ClientsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('cargo_assurance', 'cargo.config.manage');
  const clients = await listClients();
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Cargo Assurance</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Clients</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            The charterers and cargo owners you run assurance reviews for. Shared across the platform.
          </p>
        </div>
      </div>

      {error ? <Err message={error} /> : null}

      <details open={clients.length === 0} className="card" style={{ padding: 0, maxWidth: 560, marginBottom: 20 }}>
        <summary style={{ padding: '14px 18px', cursor: 'pointer', fontWeight: 600, listStyle: 'none' }}>+ Add a client</summary>
        <form action={addClient} style={{ padding: '4px 18px 18px', display: 'grid', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" placeholder="e.g. ExxonMobil" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="type">Type</label>
              <select id="type" name="type" className="input" defaultValue="customer">
                <option value="customer">Customer</option>
                <option value="charterer">Charterer</option>
                <option value="cargo_owner">Cargo owner</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="email">Email (optional)</label>
              <input id="email" name="email" className="input" type="email" />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-primary">Add client</button>
          </div>
        </form>
      </details>

      {clients.length === 0 ? (
        <p className="muted">No clients yet. Add one above to start an assurance review.</p>
      ) : (
        <div className="table-wrap" style={{ maxWidth: 720 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th style={{ width: 140 }}>Type</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{(c.type ?? '').replace('_', ' ') || '—'}</td>
                  <td className="muted">{c.email ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Err({ message }: { message: string }) {
  return (
    <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 560 }}>
      {message}
    </div>
  );
}
