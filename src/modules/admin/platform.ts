// =============================================================================
// TEAL Enterprise — Administration: Platform owner & super admins
// -----------------------------------------------------------------------------
// Visibility + control over the most privileged accounts. The database is the real
// guard (0013): the protected owner can't be deleted/demoted, the last super admin
// can't be removed, and only a super admin can change is_super_admin. This screen
// surfaces that and provides the safe owner-transfer + promote/demote paths.
// Super-admin only.
// =============================================================================
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';

export interface SuperAdminRow { id: string; name: string | null; email: string | null; isOwner: boolean; isSelf: boolean }

function back(msg?: string): never {
  redirect(msg ? `/admin/platform?msg=${encodeURIComponent(msg)}` : '/admin/platform');
}

async function requireSuperAdmin(): Promise<{ userId: string }> {
  const ctx = await getPlatformContext();
  if (!ctx.user) throw new Error('Not signed in');
  if (!ctx.isSuperAdmin) throw new Error('Super-admin only');
  return { userId: ctx.user.id };
}

export async function getPlatformAdminInfo(): Promise<{ admins: SuperAdminRow[] }> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.isSuperAdmin) return { admins: [] };
  const core = (await createClient()).schema('core');
  const [{ data: supers }, { data: settings }] = await Promise.all([
    core.from('users').select('id, full_name, email').eq('is_super_admin', true),
    core.from('platform_settings').select('protected_super_admin_id').eq('id', 1).maybeSingle(),
  ]);
  const ownerId = (settings as any)?.protected_super_admin_id ?? null;
  const admins = ((supers as any[] | null) ?? [])
    .map((u) => ({ id: u.id, name: u.full_name, email: u.email, isOwner: u.id === ownerId, isSelf: u.id === ctx.user!.id }))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
  return { admins };
}

export async function transferOwner(formData: FormData): Promise<void> {
  try {
    await requireSuperAdmin();
    const newOwnerId = String(formData.get('user_id') ?? '');
    if (!newOwnerId) back('Choose an account');
    const core = (await createClient()).schema('core');
    const { data: u } = await core.from('users').select('is_super_admin').eq('id', newOwnerId).maybeSingle();
    if (!u || !(u as any).is_super_admin) back('The owner must be a super admin');
    const { error } = await core.from('platform_settings').update({ protected_super_admin_id: newOwnerId, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) back(error.message);
    revalidatePath('/admin/platform');
    back('Owner transferred');
  } catch (e) {
    back(e instanceof Error ? e.message : 'Failed');
  }
}

export async function promoteSuperAdmin(formData: FormData): Promise<void> {
  try {
    await requireSuperAdmin();
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    if (!email) back('Enter an email');
    const core = (await createClient()).schema('core');
    const { data: u } = await core.from('users').select('id').eq('email', email).maybeSingle();
    if (!u) back('No account with that email (they must sign in once first)');
    const { error } = await core.from('users').update({ is_super_admin: true }).eq('id', (u as any).id);
    if (error) back(error.message);
    revalidatePath('/admin/platform');
    back('Super admin added');
  } catch (e) {
    back(e instanceof Error ? e.message : 'Failed');
  }
}

export async function demoteSuperAdmin(formData: FormData): Promise<void> {
  try {
    await requireSuperAdmin();
    const userId = String(formData.get('user_id') ?? '');
    if (!userId) back('Invalid request');
    const core = (await createClient()).schema('core');
    // DB guards (0013) block demoting the protected owner or the last super admin.
    const { error } = await core.from('users').update({ is_super_admin: false }).eq('id', userId);
    if (error) back(error.message);
    revalidatePath('/admin/platform');
    back('Super admin removed');
  } catch (e) {
    back(e instanceof Error ? e.message : 'Failed');
  }
}
