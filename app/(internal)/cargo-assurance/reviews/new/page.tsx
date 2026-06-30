import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { listClients, listCargoTypes } from '@/modules/cargo-assurance/queries';
import { createReview } from '@/modules/cargo-assurance/actions';

export const metadata = { title: 'New review — TEAL Cargo Assurance' };

export default async function NewReviewPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('cargo_assurance', 'cargo.reviews.manage');
  const [clients, cargoTypes] = await Promise.all([listClients(), listCargoTypes()]);
  const error = searchParams?.error;
  const year = new Date().getUTCFullYear();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/cargo-assurance/reviews">Assurance Reviews</Link>
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New assurance review</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Define the client and period; you can refine scope later.</p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 620 }}>
          {error}
        </div>
      ) : null}

      {clients.length === 0 ? (
        <div className="card" style={{ padding: 24, maxWidth: 620 }}>
          <p style={{ marginTop: 0 }}>
            You need a client first. <Link href="/cargo-assurance/clients">Add a client</Link>, then create the review.
          </p>
        </div>
      ) : (
        <form action={createReview} className="card" style={{ padding: 20, maxWidth: 620, display: 'grid', gap: 16 }}>
          <div className="field">
            <label className="label" htmlFor="title">Review title</label>
            <input id="title" name="title" className="input" placeholder={`e.g. Fuel Assurance Review — Jan–Dec ${year}`} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="client_id">Client</label>
            <select id="client_id" name="client_id" className="input" required defaultValue="">
              <option value="" disabled>Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="start_date">Period start</label>
              <input id="start_date" name="start_date" className="input" type="date" defaultValue={`${year}-01-01`} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="end_date">Period end</label>
              <input id="end_date" name="end_date" className="input" type="date" defaultValue={`${year}-12-31`} required />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="quantity_basis">Quantity basis</label>
              <select id="quantity_basis" name="quantity_basis" className="input" defaultValue="volume">
                <option value="volume">Volume</option>
                <option value="mass">Mass (metric tonnes)</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="default_cargo_type_id">Primary cargo type (optional)</label>
              <select id="default_cargo_type_id" name="default_cargo_type_id" className="input" defaultValue="">
                <option value="">—</option>
                {cargoTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-primary">Create review</button>
          </div>
        </form>
      )}
    </div>
  );
}
