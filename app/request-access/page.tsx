import Link from 'next/link';
import { requireAuth } from '@/core/session/guard';
import { getModuleAccessOverview, requestModuleAccess } from '@/modules/admin/access';

export const metadata = { title: 'Request access — TEAL Enterprise' };

export default async function RequestAccessPage({ searchParams }: { searchParams: { msg?: string } }) {
  const ctx = await requireAuth();
  const modules = await getModuleAccessOverview();
  const msg = searchParams?.msg;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">TEAL Enterprise</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Request access</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Request the modules you need. An administrator approves each request before access is granted.
          </p>
        </div>
        <Link href="/" className="btn btn-ghost">Back</Link>
      </div>

      {msg ? (
        <div className="card" style={{ background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary-border)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16 }}>
          {msg}
        </div>
      ) : null}

      {modules.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="muted" style={{ margin: 0 }}>
            No modules are available to request in {ctx.companies.find((c) => c.id === ctx.activeCompanyId)?.name ?? 'your company'} yet.
            An administrator must enable modules first.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 6 }}>
          {modules.map((m) => (
            <div key={m.key} className="row" style={{ justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {m.status === 'granted' ? 'You have access' : m.status === 'pending' ? 'Request pending approval' : 'No access yet'}
                </div>
              </div>
              {m.status === 'granted' ? (
                <span className="badge badge-success">Granted</span>
              ) : m.status === 'pending' ? (
                <span className="badge badge-warning">Pending</span>
              ) : (
                <form action={requestModuleAccess}>
                  <input type="hidden" name="module_key" value={m.key} />
                  <button className="btn btn-primary btn-sm" type="submit">Request access</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
