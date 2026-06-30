import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listContacts } from '@/modules/freight/queries';
import { PortalAccessManager, type AccessRow, type ContactOption } from '@/modules/freight/portal/PortalAccessManager';

export const metadata = { title: 'Customer portal access — Jupiter Logistics' };

export default async function FreightPortalSettings() {
  const ctx = await requireModule('freight', 'freight.comms.manage');
  const companyId = ctx.activeCompanyId;

  const contacts = await listContacts();
  const contactOptions: ContactOption[] = contacts.map((c) => ({ id: c.id, name: c.name }));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));

  // Access rows (staff read via client_access RLS) + portal-user emails (service role,
  // since portal users are not company co-members and aren't in user_directory).
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const freight = supabase.schema('freight' as any);
  const { data: access } = companyId
    ? await freight.from('client_access')
        .select('id, customer_contact_id, user_id, status, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
    : { data: [] };
  const raw = (access as { id: string; customer_contact_id: string; user_id: string; status: string; created_at: string }[] | null) ?? [];

  const emailById = new Map<string, string>();
  if (raw.length) {
    const admin = createAdminClient();
    const { data: users } = await admin.schema('core').from('users').select('id, email').in('id', raw.map((r) => r.user_id));
    ((users as { id: string; email: string }[] | null) ?? []).forEach((u) => emailById.set(u.id, u.email));
  }

  const rows: AccessRow[] = raw.map((r) => ({
    id: r.id,
    customerName: contactName.get(r.customer_contact_id) ?? 'Customer',
    email: emailById.get(r.user_id) ?? '—',
    status: r.status,
    createdAt: r.created_at,
  }));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/settings">Settings</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Customer portal access</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            Give a customer read-only access to their own shipments, documents and invoices at <code>/portal</code>.
            Portal users can only ever see the customer you link them to — never internal costs, other customers,
            or the rest of the platform.
          </p>
        </div>
      </div>
      <PortalAccessManager contacts={contactOptions} rows={rows} />
    </div>
  );
}
