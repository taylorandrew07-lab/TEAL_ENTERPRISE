// Server-side route guards. UI gating mirrors RLS, but routes must also refuse
// unauthenticated/unauthorized requests on the server — not just hide links.
import { redirect } from 'next/navigation';
import { getPlatformContext } from './context';
import { can, type PlatformContext } from './types';

/** Require a signed-in user with a resolved company. Redirects otherwise. */
export async function requireAuth(): Promise<PlatformContext> {
  const ctx = await getPlatformContext();
  if (ctx.status === 'unconfigured' || ctx.status === 'unauthenticated') {
    redirect('/sign-in');
  }
  return ctx;
}

/**
 * Require access to a module (signed in + the module enabled or super admin), and
 * optionally a specific permission. Redirects to the launcher when not permitted.
 */
export async function requireModule(moduleKey: string, permission?: string): Promise<PlatformContext> {
  const ctx = await requireAuth();
  const enabled = ctx.isSuperAdmin || ctx.enabledModuleKeys.includes(moduleKey);
  if (!enabled) redirect('/');
  if (permission && !can(ctx, permission)) redirect('/');
  return ctx;
}
