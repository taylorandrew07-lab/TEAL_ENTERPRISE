import { redirect } from 'next/navigation';
import { getPlatformContext } from '@/core/session/context';
import { updateDisplayName } from '@/core/session/account-actions';
import { signOut } from '@/core/session/auth-actions';

export const metadata = { title: 'Account — TEAL Enterprise' };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const ctx = await getPlatformContext();
  if (!ctx.user) redirect('/sign-in');

  const saved = searchParams?.saved === '1';
  const error = searchParams?.error;
  const roleClass = ctx.isSuperAdmin ? 'badge-brand' : 'badge-neutral';

  return (
    <main className="module-main" style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 620, marginInline: 'auto' }}>
        <div className="page-head" style={{ marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>Account settings</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Manage your profile and preferences.
            </p>
          </div>
        </div>

        {saved ? (
          <div
            role="status"
            style={{
              background: 'var(--success-weak)',
              border: '1px solid oklch(0.82 0.08 150)',
              color: 'var(--success, oklch(0.45 0.1 150))',
              padding: '9px 12px',
              borderRadius: 'var(--r)',
              fontSize: 'var(--text-sm)',
              marginBottom: 16,
            }}
          >
            Saved.
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            style={{
              background: 'var(--danger-weak)',
              border: '1px solid oklch(0.85 0.06 25)',
              color: 'var(--danger)',
              padding: '9px 12px',
              borderRadius: 'var(--r)',
              fontSize: 'var(--text-sm)',
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        ) : null}

        <div className="card" style={{ padding: 24 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Role
              </div>
              <div style={{ marginTop: 6 }}>
                {ctx.roleLabel ? <span className={`badge ${roleClass}`}>{ctx.roleLabel}</span> : <span className="muted">—</span>}
              </div>
            </div>
          </div>

          <form action={updateDisplayName} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
            <div className="field">
              <label className="label" htmlFor="fullName">
                Display name
              </label>
              <input
                id="fullName"
                className="input"
                name="fullName"
                type="text"
                defaultValue={ctx.user.fullName ?? ''}
                placeholder="Your name"
                required
                maxLength={120}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" className="input" type="email" value={ctx.user.email} readOnly disabled />
              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '6px 0 0' }}>
                Your sign-in email can&apos;t be changed here.
              </p>
            </div>
            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              <button type="submit" className="btn btn-primary">
                Save changes
              </button>
            </div>
          </form>
        </div>

        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Sign out</div>
              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '3px 0 0' }}>
                End your session on this device.
              </p>
            </div>
            <form action={signOut}>
              <button type="submit" className="btn btn-ghost btn-sm">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
