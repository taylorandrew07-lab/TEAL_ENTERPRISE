import Link from 'next/link';
import type { Route } from 'next';
import { signOutPortal } from '@/modules/freight/portal/actions';

export const metadata = { title: 'No access — Jupiter Logistics Portal' };

export default function PortalNoAccessPage() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ padding: 28, width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 8px' }}>No portal access yet</h1>
        <p className="muted" style={{ margin: '0 0 18px' }}>
          Your account isn&apos;t linked to a customer yet. Please contact your Jupiter Logistics
          representative to enable portal access.
        </p>
        <form action={signOutPortal}>
          <button type="submit" className="btn btn-ghost">Sign out</button>
        </form>
        <p style={{ marginTop: 12 }}>
          <Link href={'/portal/sign-in' as Route} className="muted" style={{ fontSize: 'var(--text-sm)' }}>Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
