import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/core/session/guard';
import { can } from '@/core/session/types';

export const metadata = { title: 'Administration — TEAL Enterprise' };

export default async function AdminHome() {
  const ctx = await requireAuth();
  const canCompanies = ctx.isSuperAdmin || can(ctx, 'company.manage');
  const canUsers = ctx.isSuperAdmin || can(ctx, 'users.manage');
  if (!canCompanies && !canUsers) redirect('/');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administration</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Administration</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Platform-level setup: companies, access, and the things that sit above any one module.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
          maxWidth: 760,
        }}
      >
        {canCompanies ? (
          <AdminCard
            href={'/admin/companies' as Route}
            title="Companies"
            description="Create a new company, review the ones you can access, and switch the active company."
          />
        ) : null}
        {canUsers ? (
          <AdminCard
            href={'/admin/users' as Route}
            title="Users & Access"
            description="Invite people and grant each one exactly the permissions they need — individual checkboxes, with role templates as a starting point."
          />
        ) : null}
      </div>
    </div>
  );
}

function AdminCard({
  href,
  title,
  description,
}: {
  href: Route;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="card"
      style={{ padding: '18px 20px', textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 650 }}>{title}</div>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
        {description}
      </p>
    </Link>
  );
}
