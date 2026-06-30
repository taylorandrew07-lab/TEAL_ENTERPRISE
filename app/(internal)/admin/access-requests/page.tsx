import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/core/session/guard';
import { can } from '@/core/session/types';
import { formatDate } from '@/lib/format';
import { listPendingAccessRequests, approveAccessRequest, rejectAccessRequest } from '@/modules/admin/access';

export const metadata = { title: 'Access requests — TEAL Enterprise' };

export default async function AccessRequestsPage({ searchParams }: { searchParams: { msg?: string } }) {
  const ctx = await requireAuth();
  if (!ctx.isSuperAdmin && !can(ctx, 'users.manage')) redirect('/');
  const requests = await listPendingAccessRequests();
  const msg = searchParams?.msg;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/admin">Administration</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Access requests</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Approve grants the module to that account (full access; you can fine-tune their permissions afterward in Users &amp; Access).
          </p>
        </div>
      </div>

      {msg ? (
        <div className="card" style={{ background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary-border)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 720 }}>
          {msg}
        </div>
      ) : null}

      {requests.length === 0 ? (
        <div className="card" style={{ padding: 24, maxWidth: 620 }}>
          <p className="muted" style={{ margin: 0 }}>No pending access requests.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ maxWidth: 900 }}>
          <table className="table">
            <thead>
              <tr><th>Person</th><th>Module</th><th>Reason</th><th className="date" style={{ width: 120 }}>Requested</th><th style={{ width: 200 }} /></tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td><div style={{ fontWeight: 600 }}>{r.userName ?? '—'}</div><div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{r.userEmail}</div></td>
                  <td>{r.moduleName}</td>
                  <td className="muted">{r.note ?? '—'}</td>
                  <td className="muted date">{formatDate(r.requestedAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <form action={approveAccessRequest}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn btn-primary btn-sm" type="submit">Approve</button>
                      </form>
                      <form action={rejectAccessRequest}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn btn-ghost btn-sm" type="submit">Reject</button>
                      </form>
                    </div>
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
