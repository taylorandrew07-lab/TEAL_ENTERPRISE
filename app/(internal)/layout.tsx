import { getPlatformContext } from '@/core/session/context';
import { AppShell } from '@/core/ui';

// Chrome for the internal staff app (everything except /portal). Resolves the
// platform context once and renders the global header + status banner. The
// customer portal deliberately does NOT use this layout.
export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformContext();
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
