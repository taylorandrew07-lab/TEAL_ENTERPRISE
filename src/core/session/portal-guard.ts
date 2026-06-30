// Route guard for the customer portal. Mirrors guard.ts:requireAuth but for the
// portal context. Server-side; redirects unauthenticated/no-access users.
import { redirect } from 'next/navigation';
import { getPortalContext, type PortalContext } from './portal-context';

export async function requirePortal(): Promise<PortalContext> {
  const ctx = await getPortalContext();
  if (ctx.status === 'unauthenticated') redirect('/portal/sign-in');
  if (ctx.status === 'no_access') redirect('/portal/no-access');
  return ctx;
}
