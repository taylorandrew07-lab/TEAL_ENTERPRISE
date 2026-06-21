// =============================================================================
// TEAL Enterprise — platform context resolver (server-only)
// -----------------------------------------------------------------------------
// Resolves the PlatformContext from Supabase Auth + core tables for the current
// request. Real, forward-working queries; degrades to a safe 'unconfigured' /
// 'unauthenticated' state when the database is not connected yet (pre-Supabase),
// so the shell renders honestly instead of crashing. Memoized per request.
//
// Permission keys come from the single-source RBAC catalogue (src/core/rbac/catalog),
// never re-listed here. Independent reads are parallelized; the membership query
// already carries role_id, so the active role is not re-fetched.
// =============================================================================
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { allPermissionKeys } from '@/core/rbac/catalog';
import { readActiveCompanyId } from './active-company';
import { EMPTY_CONTEXT, type PlatformContext, type SessionCompany } from './types';

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Resolve the platform context for the current request. Cached so multiple
 * layouts/components in one render share a single resolution.
 */
export const getPlatformContext = cache(async (): Promise<PlatformContext> => {
  if (!isConfigured()) return { ...EMPTY_CONTEXT, status: 'unconfigured' };

  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return { ...EMPTY_CONTEXT, status: 'unauthenticated' };

    const core = supabase.schema('core');

    // Profile (super-admin flag).
    const { data: profile } = await core
      .from('users')
      .select('id, email, full_name, is_super_admin')
      .eq('id', authUser.id)
      .maybeSingle();

    const isSuperAdmin = Boolean(profile?.is_super_admin);
    const user = {
      id: authUser.id,
      email: profile?.email ?? authUser.email ?? '',
      fullName: profile?.full_name ?? null,
      isSuperAdmin,
    };

    // Companies the user can act in, plus (for regular users) the role per company —
    // captured here so the active role is never re-queried.
    let companies: SessionCompany[] = [];
    const roleByCompany = new Map<string, string>();
    const roleNameByCompany = new Map<string, string>();

    if (isSuperAdmin) {
      const { data } = await core.from('companies').select('id, name').order('name');
      companies = data ?? [];
    } else {
      const { data } = await core
        .from('company_memberships')
        .select('role_id, role:roles(name), company:companies(id, name)')
        .eq('user_id', authUser.id)
        .eq('status', 'active');
      for (const m of data ?? []) {
        const c = (m as any).company;
        if (c?.id) {
          companies.push({ id: c.id, name: c.name });
          if ((m as any).role_id) roleByCompany.set(c.id, (m as any).role_id);
          const roleName = (m as any).role?.name;
          if (roleName) roleNameByCompany.set(c.id, roleName);
        }
      }
    }

    if (companies.length === 0) {
      return { ...EMPTY_CONTEXT, status: 'no_company', user, isSuperAdmin };
    }

    // Active company: cookie if still valid, else the first available.
    const cookieCompany = await readActiveCompanyId();
    const activeCompanyId =
      cookieCompany && companies.some((c) => c.id === cookieCompany)
        ? cookieCompany
        : companies[0].id;

    // Independent reads run in parallel: enabled modules, and (regular users) the
    // active role's permissions. Super admins hold every catalogue permission.
    const activeRoleId = roleByCompany.get(activeCompanyId) ?? null;
    const [enabledRowsRes, permsRes] = await Promise.all([
      core
        .from('company_modules')
        .select('enabled, module:modules(key)')
        .eq('company_id', activeCompanyId)
        .eq('enabled', true),
      !isSuperAdmin && activeRoleId
        ? core.from('role_permissions').select('permission:permissions(key)').eq('role_id', activeRoleId)
        : Promise.resolve({ data: null } as { data: null }),
    ]);

    const enabledModuleKeys = (enabledRowsRes.data ?? [])
      .map((r: any) => r.module?.key)
      .filter(Boolean);

    const permissions = isSuperAdmin
      ? allPermissionKeys()
      : ((permsRes.data ?? []) as any[]).map((p) => p.permission?.key).filter(Boolean);

    const roleLabel = isSuperAdmin ? 'Super Admin' : (roleNameByCompany.get(activeCompanyId) ?? null);

    return {
      status: 'ready',
      user,
      companies,
      activeCompanyId,
      enabledModuleKeys,
      permissions,
      isSuperAdmin,
      roleLabel,
    };
  } catch {
    // Any failure resolving context (e.g. DB not reachable) degrades safely.
    return { ...EMPTY_CONTEXT, status: 'unconfigured' };
  }
});
