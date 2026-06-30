// Cargo Assurance module shell. Server-side guard runs before render; navigation
// comes from the manifest via the registry.
import { requireModule } from '@/core/session/guard';
import { ModuleShell } from '@/core/ui';

export default async function CargoAssuranceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModule('cargo_assurance');
  return (
    <ModuleShell moduleKey="cargo_assurance" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
