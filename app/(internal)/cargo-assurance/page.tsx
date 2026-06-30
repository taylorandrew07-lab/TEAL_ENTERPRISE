import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate } from '@/lib/format';
import { listReviews } from '@/modules/cargo-assurance/queries';
import { ReviewStatusBadge } from '@/modules/cargo-assurance/status';

export const metadata = { title: 'Cargo Assurance — TEAL Enterprise' };

export default async function CargoPortfolio() {
  const ctx = await requireModule('cargo_assurance', 'cargo.reports.view');
  const company = ctx.companies.find((c) => c.id === ctx.activeCompanyId);
  const reviews = await listReviews();

  const inProgress = reviews.filter((r) => ['draft', 'in_review', 'reviewed'].includes(r.status)).length;
  const published = reviews.filter((r) => r.status === 'published').length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Cargo Assurance</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Portfolio Overview</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{company?.name} · periodic liquid-cargo assurance</p>
        </div>
        <Link href="/cargo-assurance/reviews/new" className="btn btn-primary">
          New review
        </Link>
      </div>

      {reviews.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No reviews yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Add a client, then create an Assurance Review for a 6- or 12-month period. The review is the home
            for that period&apos;s documents, reconstructed loadouts and findings.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/cargo-assurance/reviews/new" className="btn btn-primary">New review</Link>
            <Link href="/cargo-assurance/clients" className="btn btn-ghost">Add a client</Link>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 24, maxWidth: 720 }}>
            <Stat label="Reviews" value={String(reviews.length)} />
            <Stat label="In progress" value={String(inProgress)} />
            <Stat label="Published" value={String(published)} />
          </div>

          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 10 }}>Recent reviews</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Review</th>
                  <th style={{ width: 170 }}>Client</th>
                  <th className="date" style={{ width: 190 }}>Period</th>
                  <th style={{ width: 120 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {reviews.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>
                      <Link href={`/cargo-assurance/reviews/${r.id}`}>{r.title}</Link>
                    </td>
                    <td>{r.clientName ?? <span className="muted">—</span>}</td>
                    <td className="muted date">{formatDate(r.start_date)} → {formatDate(r.end_date)}</td>
                    <td><ReviewStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{label}</div>
      <div className="num" style={{ fontSize: 'var(--text-xl)', fontWeight: 650, marginTop: 4 }}>{value}</div>
    </div>
  );
}
