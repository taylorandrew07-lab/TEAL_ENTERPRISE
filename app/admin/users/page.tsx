import { redirect } from 'next/navigation';
import { getPlatformContext } from '@/core/session/context';
import { can } from '@/core/session/types';
import { allPermissions, allPermissionKeys, SYSTEM_ROLES } from '@/core/rbac/catalog';
import { listCompanyMembers } from '@/modules/admin/users';
import { UserManagement } from '@/modules/admin/UserManagement';

export const metadata = { title: 'Users & Access — TEAL Administration' };

const CATEGORY_LABELS: Record<string, string> = {
  admin: 'Administration',
  core: 'Core',
  accounting: 'Accounting',
  sales: 'Sales',
  purchases: 'Purchases',
  banking: 'Banking',
  data: 'Data',
  reporting: 'Reporting',
  cargo: 'Cargo Assurance',
};
const CATEGORY_ORDER = ['admin', 'core', 'accounting', 'sales', 'purchases', 'banking', 'data', 'reporting', 'cargo'];

export default async function UsersPage() {
  const ctx = await getPlatformContext();
  if (!ctx.user) redirect('/sign-in');
  if (!ctx.isSuperAdmin && !can(ctx, 'users.manage')) redirect('/admin');

  const company = ctx.companies.find((c) => c.id === ctx.activeCompanyId);
  const members = await listCompanyMembers();

  // Permission catalogue grouped by category (data-driven).
  const byCat = new Map<string, { key: string; name: string; description: string }[]>();
  for (const p of allPermissions()) {
    if (p.external) continue; // external/portal perms aren't part of staff access
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category)!.push({ key: p.key, name: p.name, description: p.description });
  }
  const groups = [...byCat.keys()]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
    .map((cat) => ({ category: cat, label: CATEGORY_LABELS[cat] ?? cat, perms: byCat.get(cat)! }));

  // Assignable role templates (exclude super-admin and external client roles).
  const allKeys = allPermissionKeys();
  const templates = SYSTEM_ROLES.filter((r) => r.key !== 'super_admin' && !r.key.includes('client')).map((r) => ({
    key: r.key,
    name: r.name,
    keys: r.grants === 'all' ? allKeys : r.grants,
  }));

  return (
    <UserManagement
      companyName={company?.name ?? 'this company'}
      members={members}
      groups={groups}
      templates={templates}
    />
  );
}
