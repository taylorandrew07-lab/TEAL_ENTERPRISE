// Drains the freight.outbound_emails queue through the configured EmailSender.
// Enforces that only client_visible documents are ever attached to a customer email.
// With the default NoopSender (no provider configured) nothing sends and rows stay
// 'queued'. Exposed as a server action to run manually or from a scheduler once the
// Microsoft 365 connector lands. Gated on freight.comms.manage.
'use server';

import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';
import { can } from '@/core/session/types';
import { getEmailSender, type OutboundEmail } from './sender';

export async function dispatchOutboundEmails(): Promise<{ ok: boolean; processed: number; sent: number; error?: string }> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) return { ok: false, processed: 0, sent: 0, error: 'Not signed in.' };
  if (!ctx.isSuperAdmin && !can(ctx, 'freight.comms.manage')) return { ok: false, processed: 0, sent: 0, error: 'Not permitted.' };

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const freight = supabase.schema('freight' as any);
  const sender = getEmailSender();

  const { data: queued } = await freight
    .from('outbound_emails')
    .select('id, shipment_id, to_addresses, subject, body, attachment_document_ids')
    .eq('company_id', ctx.activeCompanyId)
    .eq('status', 'queued')
    .limit(50);
  const rows = (queued as (OutboundEmail & { attachment_document_ids: string[] })[] | null) ?? [];

  let sent = 0;
  for (const row of rows) {
    // Defence-in-depth: only client_visible documents may ever be attached.
    let safeAttachments: string[] = [];
    if (row.attachment_document_ids?.length) {
      const { data: docs } = await freight
        .from('shipment_documents')
        .select('document_id')
        .in('document_id', row.attachment_document_ids)
        .eq('visibility', 'client_visible');
      safeAttachments = ((docs as { document_id: string }[] | null) ?? []).map((d) => d.document_id);
    }
    const result = await sender.send({ ...row, attachment_document_ids: safeAttachments });
    if (result.ok) {
      await freight.from('outbound_emails').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id);
      sent += 1;
    }
    // No provider -> leave 'queued' (not a real failure); it sends once M365 lands.
  }

  return { ok: true, processed: rows.length, sent };
}
