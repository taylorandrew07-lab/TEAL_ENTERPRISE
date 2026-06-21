// Cargo Assurance module shell. Navigation comes from the cargo-assurance manifest
// via the registry, filtered by the user's permissions. RLS is authoritative.
import { getPlatformContext } from '@/core/session/context';
import { ModuleShell } from '@/core/ui';

export default async function CargoAssuranceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformContext();
  return (
    <ModuleShell moduleKey="cargo_assurance" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
