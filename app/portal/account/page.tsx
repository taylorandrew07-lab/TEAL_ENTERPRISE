import { requirePortal } from '@/core/session/portal-guard';
import { getNotificationPreferences, updateNotificationPreferences } from '@/modules/freight/portal/notifications';

export const metadata = { title: 'Account — Jupiter Logistics' };

export default async function PortalAccount() {
  const ctx = await requirePortal();
  const customerNames = ctx.customers.map((c) => c.contactName).join(', ');
  const prefs = await getNotificationPreferences();

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
          To update your details, contact your Jupiter Logistics representative.
        </p>
      </div>

      <section style={{ marginTop: 24, maxWidth: 520 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Notifications</h2>
        <form action={updateNotificationPreferences} className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
          <label className="row" style={{ gap: 10, alignItems: 'center' }}>
            <input type="checkbox" name="in_app" defaultChecked={prefs.in_app} />
            <span>Show notifications in this portal</span>
          </label>
          <label className="row" style={{ gap: 10, alignItems: 'center' }}>
            <input type="checkbox" name="email" defaultChecked={prefs.email} />
            <span>Also email me notifications</span>
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
            Notifications cover ETA changes, arrival, delivery, and free-time/demurrage warnings. Email delivery
            begins once Jupiter Logistics enables it.
          </p>
          <div><button type="submit" className="btn btn-primary btn-sm">Save preferences</button></div>
        </form>
      </section>
    </div>
  );
}
