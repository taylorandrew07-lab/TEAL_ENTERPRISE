import { requirePortal } from '@/core/session/portal-guard';

export const metadata = { title: 'Account — Jupiter Logistics' };

export default async function PortalAccount() {
  const ctx = await requirePortal();
  const customerNames = ctx.customers.map((c) => c.contactName).join(', ');

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>Account</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Your portal sign-in details.</p>
        </div>
      </div>

      <div className="card" style={{ padding: 18, maxWidth: 520, display: 'grid', gap: 14 }}>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>Name</div>
          <div style={{ marginTop: 2 }}>{ctx.user?.fullName ?? '—'}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>Email</div>
          <div style={{ marginTop: 2 }}>{ctx.user?.email}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>Customer</div>
          <div style={{ marginTop: 2 }}>{customerNames || '—'}</div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
          Notification preferences will appear here soon. To update your details, contact your
          Jupiter Logistics representative.
        </p>
      </div>
    </div>
  );
}
