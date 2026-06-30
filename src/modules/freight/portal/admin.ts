// Admin actions for customer-portal access (invite-only). Modeled on
// admin/users.ts:inviteUser BUT membership-free: a portal user gets a
// freight.client_access row and NEVER a core.company_memberships row, so they can
// only ever read the portal_* views for their customer — never the internal app.
// Gated on freight.comms.manage (or super admin).
'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPlatformContext } from '@/core/session/context';
import { can } from '@/core/session/types';

type Result = { ok: true } | { ok: false; error: string };
type GrantResult = { ok: true; email: string; tempPassword: string | null } | { ok: false; error: string };

async function requirePortalAdmin(): Promise<{ companyId: string; userId: string }> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) throw new Error('Not signed in.');
  if (!ctx.isSuperAdmin && !can(ctx, 'freight.comms.manage')) {
    throw new Error('You do not have permission to manage portal access.');
  }
  return { companyId: ctx.activeCompanyId, userId: ctx.user.id };
}

/** Grant a customer contact's email read-only portal access. Creates (or reuses)
 *  the auth account and links it via freight.client_access — NO company membership. */
export async function grantPortalAccess(input: { customerContactId: string; email: string; fullName: string }): Promise<GrantResult> {
  try {
    const { companyId, userId } = await requirePortalAdmin();
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'A valid email is required.' };
    if (!input.customerContactId) return { ok: false, error: 'Choose a customer.' };

    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freight = supabase.schema('freight' as any);

    // The contact must belong to the active company.
    const { data: contact } = await freight
      .from('contacts').select('id').eq('company_id', companyId).eq('id', input.customerContactId).maybeSingle();
    if (!contact) return { ok: false, error: 'That customer was not found in this company.' };

    // Create or reuse the auth account (service role).
    const admin = createAdminClient();
    let tempPassword: string | null = randomBytes(12).toString('base64url');
    let portalUserId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
      user_metadata: { full_name: fullName || undefined },
    });
    if (createErr) {
      // Likely already registered — reuse the existing profile, keep their password.
      const { data: existing } = await admin.schema('core').from('users').select('id').eq('email', email).maybeSingle();
      if (!existing) return { ok: false, error: createErr.message };
      portalUserId = (existing as { id: string }).id;
      tempPassword = null;
    } else {
      portalUserId = created.user?.id ?? null;
    }
    if (!portalUserId) return { ok: false, error: 'Could not resolve the portal user.' };

    // Upsert the access row (unique on customer_contact_id + user_id). NEVER a membership.
    const { data: existingAccess } = await freight
      .from('client_access').select('id').eq('customer_contact_id', input.customerContactId).eq('user_id', portalUserId).maybeSingle();
    if (existingAccess) {
      const { error } = await freight.from('client_access').update({ status: 'active' }).eq('id', (existingAccess as { id: string }).id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await freight.from('client_access').insert({
        company_id: companyId, customer_contact_id: input.customerContactId, user_id: portalUserId,
        role: 'freight_client_viewer', status: 'active', created_by: userId,
      });
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath('/freight/settings/portal');
    return { ok: true, email, tempPassword };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to grant portal access.' };
  }
}

/** Revoke portal access (keeps the row for audit; the helper only returns 'active'). */
export async function revokePortalAccess(input: { clientAccessId: string }): Promise<Result> {
  try {
    await requirePortalAdmin();
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freight = supabase.schema('freight' as any);
    const { error } = await freight.from('client_access').update({ status: 'revoked' }).eq('id', input.clientAccessId);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/freight/settings/portal');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to revoke access.' };
  }
}

/** Reset a portal user's password and re-activate their access. Returns the new
 *  temporary password to hand over once. */
export async function resendPortalInvite(input: { clientAccessId: string }): Promise<GrantResult> {
  try {
    await requirePortalAdmin();
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freight = supabase.schema('freight' as any);
    const { data: row } = await freight.from('client_access').select('user_id').eq('id', input.clientAccessId).maybeSingle();
    if (!row) return { ok: false, error: 'Access not found.' };
    const portalUserId = (row as { user_id: string }).user_id;

    const admin = createAdminClient();
    const tempPassword = randomBytes(12).toString('base64url');
    const { error } = await admin.auth.admin.updateUserById(portalUserId, { password: tempPassword });
    if (error) return { ok: false, error: error.message };
    await freight.from('client_access').update({ status: 'active' }).eq('id', input.clientAccessId);

    const { data: u } = await admin.schema('core').from('users').select('email').eq('id', portalUserId).maybeSingle();
    revalidatePath('/freight/settings/portal');
    return { ok: true, email: (u as { email: string } | null)?.email ?? '', tempPassword };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to reset the invite.' };
  }
}
