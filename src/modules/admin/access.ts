// =============================================================================
// TEAL Enterprise — Administration: Module access requests & approvals
// -----------------------------------------------------------------------------
// The request -> approve flow that governs per-account module access (the read gate
// in core.user_module_access from 0025). A user requests a module; an approver
// (super admin or users.manage) grants it, which writes user_module_access AND seeds
// the module's full permission set onto their membership. No access until approved;
// self-approval is blocked at the DB. RLS + the 0026 trigger are the backstop.
// =============================================================================
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';
import { can } from '@/core/session/types';
import { MODULES, getModule } from '@/core/modules/registry';

// "Full access" template granted on approval (owner: access to a module = full access).
const MODULE_FULL_ROLE: Record<string, string> = {
  freight: 'freight_admin',
  cargo: 'ca_admin',
  accounting: 'accountant',
};

export interface ModuleAccessRow { key: string; name: string; status: 'granted' | 'pending' | 'none' }
export interface AccessRequestRow {
  id: string; userId: string; userName: string | null; userEmail: string | null;
  moduleKey: string; moduleName: string; note: string | null; requestedAt: string;
}

function back(path: string, msg?: string): never {
  redirect(msg ? `${path}?msg=${encodeURIComponent(msg)}` : path);
}

// ----------------------------------------------------------------------------- read
/** Modules enabled for the active company, tagged with this user's access status. */
export async function getModuleAccessOverview(): Promise<ModuleAccessRow[]> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) return [];
  const core = (await createClient()).schema('core');
  const companyId = ctx.activeCompanyId;

  const [{ data: enabled }, { data: granted }, { data: pending }] = await Promise.all([
    core.from('company_modules').select('module:modules(key)').eq('company_id', companyId).eq('enabled', true),
    core.from('user_module_access').select('module_key').eq('user_id', ctx.user.id).eq('company_id', companyId),
    core.from('access_requests').select('module_key').eq('user_id', ctx.user.id).eq('company_id', companyId).eq('status', 'pending'),
  ]);

  const grantedSet = new Set(((granted as any[] | null) ?? []).map((r) => r.module_key));
  const pendingSet = new Set(((pending as any[] | null) ?? []).map((r) => r.module_key));
  return ((enabled as any[] | null) ?? [])
    .map((r) => r.module?.key)
    .filter(Boolean)
    .map((key: string) => ({
      key,
      name: getModule(key)?.name ?? key,
      status: grantedSet.has(key) ? 'granted' : pendingSet.has(key) ? 'pending' : 'none',
    }));
}

/** Pending access requests in the active company (approver view). */
export async function listPendingAccessRequests(): Promise<AccessRequestRow[]> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) return [];
  if (!ctx.isSuperAdmin && !can(ctx, 'users.manage')) return [];
  const core = (await createClient()).schema('core');
  const { data } = await core
    .from('access_requests')
    .select('id, user_id, module_key, note, requested_at')
    .eq('company_id', ctx.activeCompanyId).eq('status', 'pending')
    .order('requested_at', { ascending: true });
  const rows = (data as any[] | null) ?? [];
  if (!rows.length) return [];
  const { data: dir } = await core.from('user_directory').select('id, full_name, email').in('id', rows.map((r) => r.user_id));
  const byId = new Map(((dir as any[] | null) ?? []).map((u) => [u.id, u]));
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, userName: byId.get(r.user_id)?.full_name ?? null,
    userEmail: byId.get(r.user_id)?.email ?? null, moduleKey: r.module_key,
    moduleName: getModule(r.module_key)?.name ?? r.module_key, note: r.note, requestedAt: r.requested_at,
  }));
}

// ----------------------------------------------------------------------------- grant helper
async function grantUserModule(core: any, userId: string, companyId: string, moduleKey: string, grantedBy: string): Promise<void> {
  // 1) the read gate
  await core.from('user_module_access')
    .upsert({ user_id: userId, company_id: companyId, module_key: moduleKey, granted_by: grantedBy },
      { onConflict: 'user_id,company_id,module_key', ignoreDuplicates: true });

  // 2) capabilities — seed the module's full role template onto the membership (additive)
  const roleKey = MODULE_FULL_ROLE[moduleKey];
  if (!roleKey) return;
  const { data: membership } = await core.from('company_memberships')
    .select('id').eq('company_id', companyId).eq('user_id', userId).maybeSingle();
  if (!membership) return;
  const { data: role } = await core.from('roles').select('id').eq('key', roleKey).is('company_id', null).maybeSingle();
  if (!role) return;
  const { data: rolePerms } = await core.from('role_permissions').select('permission_id').eq('role_id', (role as any).id);
  const wanted = ((rolePerms as any[] | null) ?? []).map((r) => r.permission_id);
  if (!wanted.length) return;
  const { data: existing } = await core.from('membership_permissions').select('permission_id').eq('membership_id', (membership as any).id);
  const have = new Set(((existing as any[] | null) ?? []).map((r) => r.permission_id));
  const toAdd = wanted.filter((id) => !have.has(id)).map((permission_id) => ({ membership_id: (membership as any).id, permission_id, granted_by: grantedBy }));
  if (toAdd.length) await core.from('membership_permissions').insert(toAdd);
}

// ----------------------------------------------------------------------------- actions (form-friendly)
export async function requestModuleAccess(formData: FormData): Promise<void> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) back('/request-access', 'Not signed in');
  const moduleKey = String(formData.get('module_key') ?? '');
  if (!MODULES.some((m) => m.key === moduleKey)) back('/request-access', 'Unknown module');
  const note = String(formData.get('note') ?? '').trim() || null;
  const core = (await createClient()).schema('core');
  const { error } = await core.from('access_requests').insert({
    user_id: ctx.user.id, company_id: ctx.activeCompanyId, module_key: moduleKey, note, status: 'pending',
  });
  if (error) back('/request-access', error.message.includes('duplicate') ? 'You already have a pending request for that module' : error.message);
  revalidatePath('/request-access');
  back('/request-access', 'Request submitted — an administrator will review it');
}

async function requireApprover(): Promise<{ companyId: string; userId: string }> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) throw new Error('Not signed in');
  if (!ctx.isSuperAdmin && !can(ctx, 'users.manage')) throw new Error('You cannot approve access requests');
  return { companyId: ctx.activeCompanyId, userId: ctx.user.id };
}

export async function approveAccessRequest(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  try {
    const { companyId, userId } = await requireApprover();
    const core = (await createClient()).schema('core');
    const { data: req } = await core.from('access_requests')
      .select('id, user_id, company_id, module_key, status').eq('id', id).maybeSingle();
    if (!req || (req as any).company_id !== companyId) back('/admin/access-requests', 'Request not found');
    if ((req as any).status !== 'pending') back('/admin/access-requests', 'Already decided');

    await grantUserModule(core, (req as any).user_id, companyId, (req as any).module_key, userId);
    await core.from('access_requests')
      .update({ status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq('id', id);
    revalidatePath('/admin/access-requests');
    back('/admin/access-requests', 'Access granted');
  } catch (e) {
    back('/admin/access-requests', e instanceof Error ? e.message : 'Failed to approve');
  }
}

export async function rejectAccessRequest(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const note = String(formData.get('decision_note') ?? '').trim() || null;
  try {
    const { companyId, userId } = await requireApprover();
    const core = (await createClient()).schema('core');
    const { error } = await core.from('access_requests')
      .update({ status: 'rejected', decision_note: note, reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .eq('id', id).eq('company_id', companyId).eq('status', 'pending');
    if (error) back('/admin/access-requests', error.message);
    revalidatePath('/admin/access-requests');
    back('/admin/access-requests', 'Request rejected');
  } catch (e) {
    back('/admin/access-requests', e instanceof Error ? e.message : 'Failed to reject');
  }
}
