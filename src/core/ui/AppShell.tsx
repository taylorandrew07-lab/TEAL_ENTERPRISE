// AppShell — the global platform chrome (sticky header) around every page. Brand
// mark + wordmark, company switcher, signed-in user / sign-out. Honest connection
// banner when Supabase isn't wired. Responsive: the header wraps on small screens.
import Link from 'next/link';
import { CompanySwitcher } from './CompanySwitcher';
import { signOut } from '@/core/session/auth-actions';
import { can, type PlatformContext } from '@/core/session/types';

export function AppShell({ ctx, children }: { ctx: PlatformContext; children: React.ReactNode }) {
  return (
    <div>
      <header className="app-header">
        <Link href="/" className="brand">
          <span className="brand-mark">T</span>
          <span>
            TEAL<span style={{ color: 'var(--muted)', fontWeight: 600 }}> Enterprise</span>
          </span>
        </Link>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {ctx.status === 'ready' ? (
            <CompanySwitcher companies={ctx.companies} activeCompanyId={ctx.activeCompanyId} />
          ) : null}

          {ctx.status === 'ready' && (ctx.isSuperAdmin || can(ctx, 'company.manage')) ? (
            <Link href="/admin" className="nav-link" style={{ padding: '6px 10px' }}>
              Admin
            </Link>
          ) : null}

          {ctx.user ? (
            <div className="row" style={{ gap: 10 }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }} className="hide-sm">
                {ctx.user.fullName ?? ctx.user.email}
                {ctx.isSuperAdmin ? (
                  <span className="badge badge-brand" style={{ marginLeft: 8 }}>
                    Super Admin
                  </span>
                ) : null}
              </span>
              <form action={signOut}>
                <button type="submit" className="btn btn-ghost btn-sm">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <Link href="/sign-in" className="btn btn-primary btn-sm">
              Sign in
            </Link>
          )}
        </div>
      </header>

      {ctx.status !== 'ready' ? <StatusBanner status={ctx.status} /> : null}

      {children}
    </div>
  );
}

function StatusBanner({ status }: { status: PlatformContext['status'] }) {
  const messages: Record<string, string> = {
    unconfigured:
      'Supabase is not connected yet. The platform shell is running on the local foundation; ' +
      'sign-in, companies, and module data activate once the database is connected.',
    unauthenticated: 'You are not signed in. Sign in to access your companies and modules.',
    no_company: 'Your account is not a member of any company yet. An administrator must invite you.',
    ready: '',
  };
  const msg = messages[status];
  if (!msg) return null;
  return (
    <div
      role="status"
      style={{
        background: 'var(--warning-weak)',
        borderBottom: '1px solid oklch(0.85 0.07 80)',
        color: 'oklch(0.42 0.09 65)',
        padding: '9px 18px',
        fontSize: 'var(--text-sm)',
      }}
    >
      {msg}
    </div>
  );
}
