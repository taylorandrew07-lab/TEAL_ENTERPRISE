import { redirect } from 'next/navigation';
import { getPortalContext } from '@/core/session/portal-context';
import { signInPortal } from '@/modules/freight/portal/actions';

export const metadata = { title: 'Sign in — Jupiter Logistics Portal' };

export default async function PortalSignInPage({ searchParams }: { searchParams: { error?: string } }) {
  const ctx = await getPortalContext();
  if (ctx.status === 'ready') redirect('/portal');
  const error = searchParams?.error;

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ padding: 28, width: '100%', maxWidth: 380 }}>
        <div className="brand" style={{ marginBottom: 6 }}>
          <span className="brand-mark">J</span>
          <span>Jupiter<span className="brand-sub"> Logistics</span></span>
        </div>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: '8px 0 4px' }}>Customer portal</h1>
        <p className="muted" style={{ margin: '0 0 18px', fontSize: 'var(--text-sm)' }}>
          Track your shipments, documents and invoices. Sign in with the details we sent you.
        </p>
        {error ? (
          <div role="alert" style={{ background: 'var(--danger-weak)', color: 'var(--danger)', border: '1px solid oklch(0.85 0.06 25)', padding: '9px 12px', borderRadius: 'var(--r)', fontSize: 'var(--text-sm)', marginBottom: 14 }}>
            {error}
          </div>
        ) : null}
        <form action={signInPortal} style={{ display: 'grid', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" className="input" required autoComplete="email" />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="input" required autoComplete="current-password" />
          </div>
          <button type="submit" className="btn btn-primary" style={{ marginTop: 4 }}>Sign in</button>
        </form>
      </div>
    </div>
  );
}
