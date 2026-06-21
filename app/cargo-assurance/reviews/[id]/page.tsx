import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireModule } from '@/core/session/guard';
import { getReview } from '@/modules/cargo-assurance/queries';
import { setReviewStatus } from '@/modules/cargo-assurance/actions';
import { ReviewStatusBadge, nextReviewStep } from '@/modules/cargo-assurance/status';

export default async function ReviewDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  await requireModule('cargo_assurance', 'cargo.reviews.manage');
  const review = await getReview(params.id);
  if (!review) notFound();

  const step = nextReviewStep(review.status);
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/cargo-assurance/reviews">Assurance Reviews</Link>
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>{review.title}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {review.clientName ?? '—'} · {review.start_date} → {review.end_date} · {review.quantity_basis}
            {review.cargo_type?.name ? ` · ${review.cargo_type.name}` : ''}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <ReviewStatusBadge status={review.status} />
          {step ? (
            <form action={setReviewStatus}>
              <input type="hidden" name="id" value={review.id} />
              <input type="hidden" name="status" value={step.next} />
              <button type="submit" className="btn btn-primary btn-sm">
                {step.verb}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 720 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, maxWidth: 920 }}>
        <Section
          title="Source documents"
          stat="0 uploaded"
          body="Bulk-upload the period's certificates, meter reports, tank soundings and FuelTrax exports. The system classifies and extracts each one, keeping the original and tracing every value to its source."
          soon="Bulk upload & extraction"
        />
        <Section
          title="Loadouts"
          stat="0 reconstructed"
          body="Related documents are grouped into loadouts automatically, then reconciled three ways — raw evidence, the client procedure, and Taylor's corrected mass-balance — and aggregated across the whole period."
          soon="Reconstruction & reconciliation"
        />
        <Section
          title="Findings"
          stat="0 findings"
          body="Procedural drift, recurring directional variance and meter bias are summarised in neutral, defensible language with the supporting records and sample sizes."
          soon="Analytics & findings"
        />
      </div>

      <p className="muted" style={{ marginTop: 22, fontSize: 'var(--text-sm)', maxWidth: 720 }}>
        The review record, lifecycle and scope are live now. The document-ingestion, extraction and
        reconciliation pipeline is the next major build — the calculation engine that powers it is already
        written and unit-tested.
      </p>
    </div>
  );
}

function Section({ title, stat, body, soon }: { title: string; stat: string; body: string; soon: string }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>{title}</strong>
        <span className="badge badge-neutral">{stat}</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>{body}</p>
      <div style={{ marginTop: 12 }}>
        <span className="badge badge-brand">Soon · {soon}</span>
      </div>
    </div>
  );
}
