// Customer-portal session context (server-only). Completely separate from the
// internal getPlatformContext: a portal user is NOT a company member and holds no
// modules or platform permissions. They are an external customer whose access is a
// freight.client_access row linking them to one (or more) customer contacts.
// Memoized per request.
import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export interface PortalCustomer {
  contactId: string;
  contactName: string;
  companyId: string;
}

export interface PortalContext {
  status: 'unauthenticated' | 'no_access' | 'ready';
  user: { id: string; email: string; fullName: string | null } | null;
  customers: PortalCustomer[];
  activeCustomerId: string | null;
}

export const getPortalContext = cache(async (): Promise<PortalContext> => {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { status: 'unauthenticated', user: null, customers: [], activeCustomerId: null };

  // Identity straight from the auth session (no dependency on core.users RLS).
  const user = {
    id: authUser.id,
    email: authUser.email ?? '',
    fullName: (authUser.user_metadata?.full_name as string | undefined) ?? null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const freight = supabase.schema('freight' as any);

  // Active portal-access rows (the client_access self-select RLS allows the user
  // to read only their own rows).
  const { data: access } = await freight
    .from('client_access')
    .select('customer_contact_id, company_id')
    .eq('user_id', authUser.id)
    .eq('status', 'active');
  const rows = (access as { customer_contact_id: string; company_id: string }[] | null) ?? [];
  if (rows.length === 0) return { status: 'no_access', user, customers: [], activeCustomerId: null };

  // Display names via the client-safe portal_customer view.
  const { data: names } = await freight.from('portal_customer').select('id, name');
  const nameById = new Map(((names as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]));

  const customers: PortalCustomer[] = rows.map((r) => ({
    contactId: r.customer_contact_id,
    contactName: nameById.get(r.customer_contact_id) ?? 'Your account',
    companyId: r.company_id,
  }));

  return { status: 'ready', user, customers, activeCustomerId: customers[0].contactId };
});
