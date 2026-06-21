import type { ReviewStatus } from './queries';

const MAP: Record<ReviewStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'badge-neutral' },
  in_review: { label: 'In review', cls: 'badge-warning' },
  reviewed: { label: 'Reviewed', cls: 'badge-brand' },
  approved: { label: 'Approved', cls: 'badge-success' },
  published: { label: 'Published', cls: 'badge-success' },
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const m = MAP[status] ?? MAP.draft;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

/** The next status in the review lifecycle, and a verb for the action button. */
export function nextReviewStep(status: ReviewStatus): { next: ReviewStatus; verb: string } | null {
  const flow: Record<ReviewStatus, { next: ReviewStatus; verb: string } | null> = {
    draft: { next: 'in_review', verb: 'Start review' },
    in_review: { next: 'reviewed', verb: 'Mark reviewed' },
    reviewed: { next: 'approved', verb: 'Approve' },
    approved: { next: 'published', verb: 'Publish' },
    published: null,
  };
  return flow[status];
}
