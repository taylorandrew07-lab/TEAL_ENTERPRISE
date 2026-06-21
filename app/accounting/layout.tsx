// Accounting module shell. Navigation comes from the accounting manifest via the
// registry, filtered by the user's permissions. RLS remains the authoritative gate.
import { getPlatformContext } from '@/core/session/context';
import { ModuleShell } from '@/core/ui';

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformContext();
  return (
    <ModuleShell moduleKey="accounting" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
