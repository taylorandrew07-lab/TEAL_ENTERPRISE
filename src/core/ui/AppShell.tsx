// AppShell — the global platform chrome (header) rendered around every page.
// Shows the brand, the active module link home, the company switcher, and the
// signed-in user. Also surfaces an honest banner when Supabase is not connected
// yet, so the foundation renders truthfully before provisioning.
import Link from 'next/link';
import { CompanySwitcher } from './CompanySwitcher';
import { signOut } from '@/core/session/auth-actions';
import type { PlatformContext } from '@/core/session/types';

export function AppShell({ ctx, children }: { ctx: PlatformContext; children: React.ReactNode }) {
  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '10px 20px',
          borderBottom: '1px solid #e2e8f0',
          background: '#fff',
          height: 57,
        }}
      >
        <Link
          href="/"
          style={{ textDecoration: 'none', color: 'var(--teal)', fontWeight: 700, letterSpacing: '0.06em' }}
        >
          TEAL ENTERPRISE
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {ctx.status === 'ready' ? (
            <CompanySwitcher companies={ctx.companies} activeCompanyId={ctx.activeCompanyId} />
          ) : null}
          {ctx.user ? (
            <>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {ctx.user.fullName ?? ctx.user.email}
                {ctx.isSuperAdmin ? ' · Super Admin' : ''}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    color: 'var(--ink)',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/sign-in"
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                background: 'var(--teal)',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
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
      'sign-in, companies, and module data activate once the database is provisioned.',
    unauthenticated: 'You are not signed in. Sign in to access your companies and modules.',
    no_company:
      'Your account is not a member of any company yet. A company administrator must invite you.',
    ready: '',
  };
  const msg = messages[status];
  if (!msg) return null;
  return (
    <div
      style={{
        background: '#fffbeb',
        borderBottom: '1px solid #fde68a',
        color: '#92400e',
        padding: '8px 20px',
        fontSize: 13,
      }}
    >
      {msg}
    </div>
  );
}
