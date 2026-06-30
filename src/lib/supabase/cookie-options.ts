import type { CookieOptions } from '@supabase/ssr';

// Persistent + hardened auth cookies.
// - maxAge ~400 days (Chrome's cap): the session survives closing the app/browser,
//   so mobile/PWA users log in ONCE and the installed app opens straight in. The
//   Supabase refresh token is long-lived and middleware.ts refreshes it each visit.
// - secure (prod) + sameSite 'lax' + explicit path.
// - httpOnly: TRUE — auth is fully server-side (the browser client in client.ts is
//   never used), so the session token is never read by JS. This closes the XSS
//   session-theft risk (audit F-15) far better than a CSP would for this case.
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  maxAge: 60 * 60 * 24 * 400,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
