// Minimal customer-portal chrome — deliberately NOT the internal AppShell. No
// module launcher, no company switcher, no admin link. Just the Jupiter Logistics
// brand, the customer's name, the portal nav, and sign-out.
import Link from 'next/link';
import type { Route } from 'next';
import { signOutPortal } from './actions';
import { getUnreadCount } from './notifications';
import type { PortalContext } from '@/core/session/portal-context';

export async function PortalShell({ ctx, children }: { ctx: PortalContext; children: React.ReactNode }) {
  const customerName = ctx.customers[0]?.contactName ?? '';
  const unread = await getUnreadCount();
  return (
    <div>
      <header className="app-header">
        <Link href={'/portal' as Route} className="brand">
          <span className="brand-mark">J</span>
          <span>Jupiter<span className="brand-sub"> Logistics</span></span>
        </Link>

        <nav className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href={'/portal' as Route} className="nav-link" style={{ padding: '6px 10px' }}>My shipments</Link>
          <Link href={'/portal/notifications' as Route} className="nav-link" style={{ padding: '6px 10px' }}>
            Notifications{unread > 0 ? <span className="badge badge-brand" style={{ marginLeft: 6 }}>{unread}</span> : null}
          </Link>
          <Link href={'/portal/account' as Route} className="nav-link" style={{ padding: '6px 10px' }}>Account</Link>
          {ctx.user ? (
            <span className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>{customerName || ctx.user.email}</span>
              <form action={signOutPortal}>
                <button type="submit" className="btn btn-ghost btn-sm">Sign out</button>
              </form>
            </span>
          ) : null}
        </nav>
      </header>
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 18px 48px' }}>{children}</main>
    </div>
  );
}
