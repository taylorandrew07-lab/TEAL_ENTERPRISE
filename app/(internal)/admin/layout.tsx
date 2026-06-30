// Administration shell. Platform-level area (not a module), so it gets its own shell
// rather than a ModuleShell — same sidebar + padded main as the modules, for a
// consistent layout. Guards once here; the nav is filtered to what the user may access.
import { redirect } from 'next/navigation';
import { requireAuth } from '@/core/session/guard';
import { can } from '@/core/session/types';
import { AdminNav, type AdminNavItem } from '@/core/ui/AdminNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  const canCompanies = ctx.isSuperAdmin || can(ctx, 'company.manage');
  const canUsers = ctx.isSuperAdmin || can(ctx, 'users.manage');
  if (!canCompanies && !canUsers) redirect('/');

  const items: AdminNavItem[] = [{ href: '/admin', label: 'Overview', exact: true }];
  if (canCompanies) items.push({ href: '/admin/companies', label: 'Companies' });
  if (canUsers) items.push({ href: '/admin/users', label: 'Users & Access' });

  return (
    <div className="module-shell">
      <aside className="module-aside">
        <div className="module-title">Administration</div>
        <AdminNav items={items} />
      </aside>
      <main className="module-main">{children}</main>
    </div>
  );
}
