// Portal notification reads + actions. Reads the client-safe portal_notifications
// view; mark-read goes through the SECURITY DEFINER functions (0035). Preferences
// are managed per (customer_contact_id, user_id) via the self RLS policies.
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getPortalContext } from '@/core/session/portal-context';

async function freightClient() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.schema('freight' as any);
}

export interface PortalNotification {
  id: string; shipment_id: string | null; kind: string; subject: string | null;
  body: string | null; status: string; created_at: string; read_at: string | null;
}

export async function getPortalNotifications(): Promise<PortalNotification[]> {
  const freight = await freightClient();
  const { data } = await freight.from('portal_notifications').select('*').order('created_at', { ascending: false }).limit(100);
  return (data as PortalNotification[] | null) ?? [];
}

export async function getUnreadCount(): Promise<number> {
  const freight = await freightClient();
  const { count } = await freight
    .from('portal_notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const freight = await freightClient();
  await freight.rpc('portal_mark_notification_read', { p_id: id });
  revalidatePath('/portal/notifications');
}

export async function markAllNotificationsRead(): Promise<void> {
  const freight = await freightClient();
  await freight.rpc('portal_mark_all_notifications_read');
  revalidatePath('/portal/notifications');
}

export interface NotificationPrefs { in_app: boolean; email: boolean }

export async function getNotificationPreferences(): Promise<NotificationPrefs> {
  const ctx = await getPortalContext();
  if (ctx.status !== 'ready' || !ctx.activeCustomerId) return { in_app: true, email: false };
  const freight = await freightClient();
  const { data } = await freight
    .from('notification_preferences').select('in_app, email')
    .eq('customer_contact_id', ctx.activeCustomerId).maybeSingle();
  const row = data as NotificationPrefs | null;
  return row ?? { in_app: true, email: false };
}

export async function updateNotificationPreferences(formData: FormData): Promise<void> {
  const ctx = await getPortalContext();
  if (ctx.status !== 'ready' || !ctx.activeCustomerId || !ctx.user) return;
  const customer = ctx.customers.find((c) => c.contactId === ctx.activeCustomerId);
  if (!customer) return;
  const in_app = formData.get('in_app') === 'on';
  const email = formData.get('email') === 'on';

  const freight = await freightClient();
  const { data: existing } = await freight
    .from('notification_preferences').select('id')
    .eq('customer_contact_id', ctx.activeCustomerId).eq('user_id', ctx.user.id).maybeSingle();
  if (existing) {
    await freight.from('notification_preferences').update({ in_app, email }).eq('id', (existing as { id: string }).id);
  } else {
    await freight.from('notification_preferences').insert({
      company_id: customer.companyId, customer_contact_id: ctx.activeCustomerId, user_id: ctx.user.id, in_app, email,
    });
  }
  revalidatePath('/portal/account');
}
