import type { CookieOptions } from '@supabase/ssr';

// Persistent + hardened auth cookies.
// - maxAge ~400 days (Chrome's cap): the session survives closing the app/browser,
//   so mobile/PWA users log in ONCE and the installed app opens straight in. The
//   Supabase refresh token is long-lived and middleware.ts refreshes it each visit.
// - secure (prod) + sameSite 'lax' + explicit path harden the cookie (security
//   finding SEC-008). httpOnly is intentionally NOT set: @supabase/ssr's browser
//   client must read the session from document.cookie; XSS is mitigated via CSP
//   (added in the PWA/hardening phase) rather than httpOnly here.
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  maxAge: 60 * 60 * 24 * 400,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
