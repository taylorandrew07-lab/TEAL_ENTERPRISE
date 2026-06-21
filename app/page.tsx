// Platform home = the module launcher, driven by the module registry and the
// user's active company + permissions. No business data is rendered here.
import { getPlatformContext } from '@/core/session/context';
import { ModuleLauncher } from '@/core/ui';

export default async function Home() {
  const ctx = await getPlatformContext();
  return <ModuleLauncher ctx={ctx} />;
}
