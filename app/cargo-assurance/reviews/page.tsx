import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate } from '@/lib/format';
import { listReviews } from '@/modules/cargo-assurance/queries';
import { ReviewStatusBadge } from '@/modules/cargo-assurance/status';

export const metadata = { title: 'Assurance Reviews — TEAL Cargo Assurance' };

export default async function ReviewsPage() {
  await requireModule('cargo_assurance', 'cargo.reviews.manage');
  const reviews = await listReviews();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Cargo Assurance</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Assurance Reviews</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Each review covers a 6- or 12-month period for one client — the top-level record that everything
            else (documents, loadouts, findings) lives beneath.
          </p>
        </div>
        <Link href="/cargo-assurance/reviews/new" className="btn btn-primary">
          New review
        </Link>
      </div>

      {reviews.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No assurance reviews yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Create your first review — pick a client and the period (e.g. <em>ExxonMobil — Jan–Dec 2025</em>).
            You&apos;ll then bulk-upload the period&apos;s certificates for extraction and reconciliation.
          </p>
          <Link href="/cargo-assurance/reviews/new" className="btn btn-primary">
            New review
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Review</th>
                <th style={{ width: 180 }}>Client</th>
                <th className="date" style={{ width: 200 }}>Period</th>
                <th style={{ width: 90 }}>Basis</th>
                <th style={{ width: 120 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/cargo-assurance/reviews/${r.id}`}>{r.title}</Link>
                  </td>
                  <td>{r.clientName ?? <span className="muted">—</span>}</td>
                  <td className="muted date">
                    {formatDate(r.start_date)} → {formatDate(r.end_date)}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{r.quantity_basis}</td>
                  <td>
                    <ReviewStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
