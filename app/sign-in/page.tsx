import { signIn } from '@/core/session/auth-actions';

export const metadata = { title: 'Sign in — TEAL Enterprise' };

export default function SignInPage({ searchParams }: { searchParams: { error?: string } }) {
  const error = searchParams?.error;
  return (
    <main style={{ maxWidth: 400, margin: '8vh auto', padding: '0 1.5rem' }}>
      <p style={{ color: 'var(--teal)', fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>
        TEAL ENTERPRISE
      </p>
      <h1 style={{ fontSize: '1.4rem', margin: '0.5rem 0 1.25rem' }}>Sign in</h1>

      {error ? (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      <form action={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            style={inputStyle}
          />
        </label>
        <button
          type="submit"
          style={{
            marginTop: 4,
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--teal)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign in
        </button>
      </form>

      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 20 }}>
        Don&apos;t have an account yet? The first person to sign up becomes the platform administrator.
        User self-signup is configured in your Supabase project&apos;s Auth settings.
      </p>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  fontSize: 15,
  color: 'var(--ink)',
};
