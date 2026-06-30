// Platform home = the module launcher, driven by the module registry and the
// user's active company + permissions. No business data is rendered here.
import { redirect } from 'next/navigation';
import { getPlatformContext } from '@/core/session/context';
import { ModuleLauncher } from '@/core/ui';

export default async function Home() {
  const ctx = await getPlatformContext();
  // Clean mobile/PWA launch: a signed-out user goes straight to sign-in, not a banner.
  // (Persistent cookies mean a signed-in user normally never sees this.)
  if (ctx.status === 'unauthenticated') redirect('/sign-in');
  return <ModuleLauncher ctx={ctx} />;
}
