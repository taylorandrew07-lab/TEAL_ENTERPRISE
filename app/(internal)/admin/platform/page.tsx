import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/core/session/guard';
import { getPlatformAdminInfo, transferOwner, promoteSuperAdmin, demoteSuperAdmin } from '@/modules/admin/platform';

export const metadata = { title: 'Platform & owner — TEAL Enterprise' };

export default async function PlatformAdminPage({ searchParams }: { searchParams: { msg?: string } }) {
  const ctx = await requireAuth();
  if (!ctx.isSuperAdmin) redirect('/');
  const { admins } = await getPlatformAdminInfo();
  const msg = searchParams?.msg;
  const others = admins.filter((a) => !a.isOwner);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/admin">Administration</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Platform &amp; owner</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            The owner account is protected — it can&apos;t be deleted or demoted, and the last super admin can never be removed.
          </p>
        </div>
      </div>

      {msg ? (
        <div className="card" style={{ background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary-border)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 720 }}>{msg}</div>
      ) : null}

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Super admins <span className="muted num" style={{ fontWeight: 400, fontSize: 'var(--text-sm)' }}>· {admins.length}</span></h2>
        <div className="table-wrap" style={{ maxWidth: 820 }}>
          <table className="table">
            <thead><tr><th>Account</th><th style={{ width: 120 }}>Role</th><th style={{ width: 220 }} /></tr></thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td><div style={{ fontWeight: 600 }}>{a.name ?? '—'}{a.isSelf ? <span className="muted"> (you)</span> : null}</div><div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{a.email}</div></td>
                  <td>{a.isOwner ? <span className="badge badge-brand">Owner</span> : <span className="badge badge-neutral">Super admin</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {!a.isOwner ? (
                        <form action={transferOwner}>
                          <input type="hidden" name="user_id" value={a.id} />
                          <button className="btn btn-ghost btn-sm" type="submit">Make owner</button>
                        </form>
                      ) : null}
                      {!a.isOwner ? (
                        <form action={demoteSuperAdmin}>
                          <input type="hidden" name="user_id" value={a.id} />
                          <button className="btn btn-ghost btn-sm" type="submit">Remove</button>
                        </form>
                      ) : <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>protected</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {others.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 10 }}>You are the only super admin. Add another below before you can transfer ownership.</p>
        ) : null}
      </section>

      <section style={{ maxWidth: 560 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Add a super admin</h2>
        <form action={promoteSuperAdmin} className="card" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label className="label" htmlFor="email">Account email</label>
            <input id="email" name="email" type="email" className="input" placeholder="person@company.com" required />
          </div>
          <button className="btn btn-primary" type="submit">Make super admin</button>
        </form>
        <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 8 }}>
          They must have signed in at least once. Super admins can access every module and approve access requests.
        </p>
      </section>
    </div>
  );
}
