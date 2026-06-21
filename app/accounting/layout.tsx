// Accounting module shell. Server-side guard (must be signed in + have the module)
// runs before render; navigation comes from the manifest via the registry.
import { requireModule } from '@/core/session/guard';
import { ModuleShell } from '@/core/ui';

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModule('accounting');
  return (
    <ModuleShell moduleKey="accounting" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
