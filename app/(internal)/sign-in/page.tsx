import { signIn } from '@/core/session/auth-actions';

export const metadata = { title: 'Sign in — TEAL Enterprise' };

export default function SignInPage({ searchParams }: { searchParams: { error?: string } }) {
  const error = searchParams?.error;
  return (
    <main
      style={{
        minHeight: 'calc(100dvh - var(--header-h))',
        display: 'grid',
        placeItems: 'center',
        padding: '6vh 20px',
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: 28 }}>
        <div className="row" style={{ gap: 10, marginBottom: 18 }}>
          <span className="brand-mark" style={{ width: 30, height: 30, fontSize: 15 }}>
            T
          </span>
          <strong style={{ letterSpacing: '0.02em' }}>TEAL Enterprise</strong>
        </div>
        <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 4 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20, fontSize: 'var(--text-sm)' }}>
          Welcome back. Sign in to continue.
        </p>

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

        <form action={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" className="input" type="email" name="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ marginTop: 4 }}>
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
