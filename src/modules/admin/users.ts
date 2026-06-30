// =============================================================================
// TEAL Enterprise — Administration: Users & Access
// -----------------------------------------------------------------------------
// The data + action layer behind Administration → Users. Lists the members of the
// active company with their per-user permission grants, and provides the only
// supported write path for managing access: invite a user, apply a role template,
// toggle individual permission checkboxes, and remove access.
//
// Authorisation is enforced in depth: every action re-checks the caller holds
// users.manage (or is a super admin) in the ACTIVE company; the database RLS +
// the 0014 escalation guard are the backstop (a caller can't grant a permission
// they don't hold, or edit their own grants). Super-admin members are protected:
// the UI never lets you edit or remove them.
// =============================================================================
'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPlatformContext } from '@/core/session/context';
import { can } from '@/core/session/types';
import type { CompanyMember } from './users-types';

type Result = { ok: true } | { ok: false; error: string };
type InviteResult = { ok: true; email: string; tempPassword: string } | { ok: false; error: string };

/** Caller must manage users in the active company. Returns the active companyId + user id. */
async function requireUsersAdmin(): Promise<{ companyId: string; userId: string; isSuperAdmin: boolean }> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) throw new Error('Not signed in.');
  if (!ctx.isSuperAdmin && !can(ctx, 'users.manage')) throw new Error('You do not have permission to manage users.');
  return { companyId: ctx.activeCompanyId, userId: ctx.user.id, isSuperAdmin: ctx.isSuperAdmin };
}

/** Members of the active company with their grants. Read path (server component). */
export async function listCompanyMembers(): Promise<CompanyMember[]> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) return [];
  if (!ctx.isSuperAdmin && !can(ctx, 'users.manage')) return [];
  const companyId = ctx.activeCompanyId;
  const supabase = await createClient();
  const core = supabase.schema('core');

  const { data: memberships } = await core
    .from('company_memberships')
    .select('id, user_id, status')
    .eq('company_id', companyId)
    .eq('status', 'active');
  const rows = (memberships as any[] | null) ?? [];
  if (rows.length === 0) return [];

  const userIds = rows.map((m) => m.user_id);
  const membershipIds = rows.map((m) => m.id);

  const [{ data: dir }, { data: supers }, { data: grants }] = await Promise.all([
    core.from('user_directory').select('id, full_name, email').in('id', userIds),
    core.from('users').select('id, is_super_admin').in('id', userIds),
    core
      .from('membership_permissions')
      .select('membership_id, permission:permissions(key)')
      .in('membership_id', membershipIds),
  ]);

  const dirById = new Map((dir as any[] | null)?.map((u) => [u.id, u]) ?? []);
  const superById = new Map((supers as any[] | null)?.map((u) => [u.id, u.is_super_admin]) ?? []);
  const grantsByMembership = new Map<string, string[]>();
  for (const g of (grants as any[] | null) ?? []) {
    const k = g.permission?.key;
    if (!k) continue;
    const arr = grantsByMembership.get(g.membership_id) ?? [];
    arr.push(k);
    grantsByMembership.set(g.membership_id, arr);
  }

  return rows
    .map((m) => ({
      membershipId: m.id,
      userId: m.user_id,
      fullName: dirById.get(m.user_id)?.full_name ?? null,
      email: dirById.get(m.user_id)?.email ?? null,
      isSuperAdmin: Boolean(superById.get(m.user_id)),
      isSelf: m.user_id === ctx.user!.id,
      grantedKeys: grantsByMembership.get(m.id) ?? [],
    }))
    .sort((a, b) => (a.fullName ?? a.email ?? '').localeCompare(b.fullName ?? b.email ?? ''));
}

type EditableCheck =
  | { ok: false; error: string }
  | { ok: true; membership: { id: string; user_id: string; company_id: string } };

/** Membership belongs to the active company and is an editable (non-super, non-self) target. */
async function loadEditableMembership(
  core: any,
  membershipId: string,
  companyId: string,
  selfId: string,
): Promise<EditableCheck> {
  const { data: m } = await core
    .from('company_memberships')
    .select('id, user_id, company_id')
    .eq('id', membershipId)
    .maybeSingle();
  if (!m || m.company_id !== companyId) return { ok: false, error: 'Member not found in this company.' };
  if (m.user_id === selfId) return { ok: false, error: 'You cannot change your own access here.' };
  const { data: u } = await core.from('users').select('is_super_admin').eq('id', m.user_id).maybeSingle();
  if (u?.is_super_admin) return { ok: false, error: 'Super-admin accounts are protected and cannot be edited.' };
  return { ok: true, membership: m };
}

async function permissionId(core: any, key: string): Promise<string | null> {
  const { data } = await core.from('permissions').select('id').eq('key', key).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Toggle one permission checkbox for a member. */
export async function setMemberGrant(input: { membershipId: string; permissionKey: string; granted: boolean }): Promise<Result> {
  try {
    const { companyId, userId } = await requireUsersAdmin();
    const supabase = await createClient();
    const core = supabase.schema('core');
    const chk = await loadEditableMembership(core, input.membershipId, companyId, userId);
    if (!chk.ok) return chk;

    const pid = await permissionId(core, input.permissionKey);
    if (!pid) return { ok: false, error: 'Unknown permission.' };

    if (input.granted) {
      const { error } = await core
        .from('membership_permissions')
        .insert({ membership_id: input.membershipId, permission_id: pid, granted_by: userId });
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await core
        .from('membership_permissions')
        .delete()
        .eq('membership_id', input.membershipId)
        .eq('permission_id', pid);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to update permission.' };
  }
}

/** Replace a member's grants with a role template's permission set. */
export async function applyTemplate(input: { membershipId: string; roleKey: string }): Promise<Result> {
  try {
    const { companyId, userId } = await requireUsersAdmin();
    const supabase = await createClient();
    const core = supabase.schema('core');
    const chk = await loadEditableMembership(core, input.membershipId, companyId, userId);
    if (!chk.ok) return chk;

    const { data: role } = await core
      .from('roles')
      .select('id')
      .eq('key', input.roleKey)
      .is('company_id', null)
      .maybeSingle();
    if (!role) return { ok: false, error: 'Template not found.' };

    const { data: rolePerms } = await core
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', (role as { id: string }).id);
    const ids = ((rolePerms as { permission_id: string }[] | null) ?? []).map((r) => r.permission_id);

    // Apply as a DIFF (add missing, then remove extra) rather than delete-all-then-insert,
    // so a failed insert never strips the member of all access (F-11). Add first, remove last.
    const { data: cur } = await core.from('membership_permissions').select('permission_id').eq('membership_id', input.membershipId);
    const have = new Set(((cur as { permission_id: string }[] | null) ?? []).map((r) => r.permission_id));
    const want = new Set(ids);
    const toAdd = [...want].filter((id) => !have.has(id));
    const toRemove = [...have].filter((id) => !want.has(id));
    if (toAdd.length > 0) {
      const { error } = await core
        .from('membership_permissions')
        .insert(toAdd.map((permission_id) => ({ membership_id: input.membershipId, permission_id, granted_by: userId })));
      if (error) return { ok: false, error: error.message };
    }
    if (toRemove.length > 0) {
      const { error } = await core
        .from('membership_permissions')
        .delete()
        .eq('membership_id', input.membershipId)
        .in('permission_id', toRemove);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to apply template.' };
  }
}

/** Remove a member's access to the active company (deletes the membership). */
export async function removeMember(input: { membershipId: string }): Promise<Result> {
  try {
    const { companyId, userId } = await requireUsersAdmin();
    const supabase = await createClient();
    const core = supabase.schema('core');
    const chk = await loadEditableMembership(core, input.membershipId, companyId, userId);
    if (!chk.ok) return chk;
    const { error } = await core.from('company_memberships').delete().eq('id', input.membershipId);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to remove member.' };
  }
}

/**
 * Invite a user to the active company. Creates (or reuses) their auth account with a
 * temporary password, adds the membership, and seeds grants from the chosen template.
 * Returns the temporary password to hand over once (not stored or emailed).
 */
export async function inviteUser(input: { email: string; fullName: string; roleKey: string }): Promise<InviteResult> {
  try {
    const { companyId, userId } = await requireUsersAdmin();
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'A valid email is required.' };

    const supabase = await createClient();
    const core = supabase.schema('core');
    const admin = createAdminClient();

    // Resolve the role template.
    const { data: role } = await core.from('roles').select('id').eq('key', input.roleKey).is('company_id', null).maybeSingle();
    if (!role) return { ok: false, error: 'Choose a valid role template.' };
    const roleId = (role as { id: string }).id;

    // Create the auth user (or reuse an existing account by email).
    const tempPassword = randomBytes(12).toString('base64url');
    let newUserId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName || undefined },
    });
    if (createErr) {
      // Likely already registered — find the existing profile and just add membership.
      const { data: existing } = await core.from('users').select('id').eq('email', email).maybeSingle();
      if (!existing) return { ok: false, error: createErr.message };
      newUserId = (existing as { id: string }).id;
    } else {
      newUserId = created.user?.id ?? null;
    }
    if (!newUserId) return { ok: false, error: 'Could not resolve the new user.' };

    // Set the display name on the profile if provided (super-admin caller can; full_name only).
    if (fullName) await core.from('users').update({ full_name: fullName }).eq('id', newUserId);

    // Membership (skip if they're already a member of this company).
    const { data: existingMembership } = await core
      .from('company_memberships')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', newUserId)
      .maybeSingle();
    let membershipId = (existingMembership as { id: string } | null)?.id ?? null;
    if (!membershipId) {
      const { data: m, error: mErr } = await core
        .from('company_memberships')
        .insert({ user_id: newUserId, company_id: companyId, role_id: roleId, status: 'active' })
        .select('id')
        .single();
      if (mErr || !m) return { ok: false, error: mErr?.message ?? 'Could not add the membership.' };
      membershipId = (m as { id: string }).id;
    }

    // Seed grants from the template.
    const { data: rolePerms } = await core.from('role_permissions').select('permission_id').eq('role_id', roleId);
    const ids = ((rolePerms as { permission_id: string }[] | null) ?? []).map((r) => r.permission_id);
    if (ids.length > 0) {
      const { error: grantErr } = await core
        .from('membership_permissions')
        .insert(ids.map((permission_id) => ({ membership_id: membershipId!, permission_id, granted_by: userId })));
      if (grantErr) return { ok: false, error: `User added, but seeding permissions failed: ${grantErr.message}` };
    }

    revalidatePath('/admin/users');
    return { ok: true, email, tempPassword };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to invite the user.' };
  }
}
