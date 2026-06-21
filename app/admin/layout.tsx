// Administration shell. Platform-level area (not a module), so it gets its own shell
// rather than a ModuleShell — same sidebar + padded main as the modules, for a
// consistent layout. Guards once here so child pages render only for the authorised.
import { redirect } from 'next/navigation';
import { requireAuth } from '@/core/session/guard';
import { can } from '@/core/session/types';
import { AdminNav } from '@/core/ui/AdminNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  if (!ctx.isSuperAdmin && !can(ctx, 'company.manage')) redirect('/');

  return (
    <div className="module-shell">
      <aside className="module-aside">
        <div className="module-title">Administration</div>
        <AdminNav />
      </aside>
      <main className="module-main">{children}</main>
    </div>
  );
}
