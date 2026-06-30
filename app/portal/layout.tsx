import { getPortalContext } from '@/core/session/portal-context';
import { PortalShell } from '@/modules/freight/portal/PortalShell';

export const metadata = { title: 'Jupiter Logistics — Customer Portal' };

// Wraps authenticated portal pages in the minimal portal shell. Sign-in /
// no-access render bare (no nav/sign-out). Each page still calls requirePortal()
// to enforce the redirect server-side.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  if (ctx.status === 'ready') return <PortalShell ctx={ctx}>{children}</PortalShell>;
  return <>{children}</>;
}
