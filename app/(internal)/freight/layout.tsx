// Freight Forwarding (Jupiter Logistics) module shell. Server-side guard runs
// before render; navigation comes from the manifest via the registry.
import { requireModule } from '@/core/session/guard';
import { ModuleShell } from '@/core/ui';

export default async function FreightLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModule('freight');
  return (
    <ModuleShell moduleKey="freight" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
