// Freight documents + CSV import — server actions that touch Storage and bulk data.
// Files live in the private 'documents' bucket (<company_id>/<doc_id>/<name>) with
// metadata in core.documents; freight.shipment_documents adds the freight doc_type
// and the VISIBILITY classification (internal vs client-visible) so confidential
// docs (e.g. Master B/L with our fees) never reach customers. RLS/Storage policies
// remain the authority — this layer never bypasses them.
'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';
import { can } from '@/core/session/types';

const MAX_BYTES = 25 * 1024 * 1024;

// Default confidentiality by document type (the Master vs House B/L logic).
function deriveVisibility(docType: string): 'internal' | 'client_visible' | 'client_on_request' {
  switch (docType) {
    case 'house_bl':
    case 'arrival_notice':
    case 'delivery_order':
    case 'proof_of_delivery':
    case 'cargo_receipt':
    case 'packing_list':
    case 'quotation':
      return 'client_visible';
    case 'master_bl':
    case 'commercial_invoice':
      return 'internal';
    default:
      return 'internal';
  }
}

export async function uploadShipmentDocument(formData: FormData): Promise<void> {
  const ctx = await getPlatformContext();
  const shipmentId = String(formData.get('shipment_id') ?? '');
  const dest = `/freight/shipments/${shipmentId}`;
  if (!ctx.user || !ctx.activeCompanyId) redirect(`${dest}?error=No active company`);
  if (!can(ctx, 'documents.manage') || !can(ctx, 'freight.documents.manage')) {
    redirect(`${dest}?error=${encodeURIComponent('You do not have permission to upload documents')}`);
  }

  const file = formData.get('file') as File | null;
  const docType = String(formData.get('doc_type') ?? 'other');
  const visInput = String(formData.get('visibility') ?? 'auto');
  const title = String(formData.get('title') ?? '').trim() || null;
  const visibility = visInput === 'auto' ? deriveVisibility(docType) : visInput;

  if (!shipmentId) redirect('/freight/shipments?error=Missing shipment');
  if (!file || file.size === 0) redirect(`${dest}?error=Choose a file to upload`);
  if (file.size > MAX_BYTES) redirect(`${dest}?error=File exceeds the 25 MB limit`);

  const supabase = await createClient();
  const companyId = ctx.activeCompanyId;
  const docId = randomUUID();
  const safeName = (file.name || 'file').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 180) || 'file';
  const path = `${companyId}/${docId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (upErr) redirect(`${dest}?error=${encodeURIComponent(upErr.message)}`);

  const { data: doc, error: dbErr } = await supabase.schema('core').from('documents').insert({
    company_id: companyId, owner_module: 'freight', storage_path: path,
    filename: file.name || safeName, mime_type: file.type || null, uploaded_by: ctx.user.id,
  }).select('id').single();
  if (dbErr || !doc) {
    await supabase.storage.from('documents').remove([path]);
    redirect(`${dest}?error=${encodeURIComponent(dbErr?.message ?? 'Could not save document')}`);
  }

  const { error: linkErr } = await supabase.schema('freight' as any).from('shipment_documents').insert({
    company_id: companyId, shipment_id: shipmentId, document_id: doc.id,
    doc_type: docType, visibility, title, uploaded_by: ctx.user.id,
  });
  if (linkErr) {
    await supabase.schema('core').from('documents').delete().eq('id', doc.id).eq('company_id', companyId);
    await supabase.storage.from('documents').remove([path]);
    redirect(`${dest}?error=${encodeURIComponent(linkErr.message)}`);
  }

  revalidatePath(dest);
  redirect(dest);
}

export async function deleteShipmentDocument(formData: FormData): Promise<void> {
  const ctx = await getPlatformContext();
  const shipmentId = String(formData.get('shipment_id') ?? '');
  const documentId = String(formData.get('document_id') ?? '');
  const dest = `/freight/shipments/${shipmentId}`;
  if (!ctx.user || !ctx.activeCompanyId) redirect(`${dest}?error=No active company`);
  if (!documentId) redirect(`${dest}?error=Missing document`);

  const supabase = await createClient();
  const companyId = ctx.activeCompanyId;
  const { data: d } = await supabase.schema('core').from('documents')
    .select('storage_path').eq('id', documentId).eq('company_id', companyId).maybeSingle();
  if (d?.storage_path) await supabase.storage.from('documents').remove([d.storage_path]);
  // FK shipment_documents.document_id -> core.documents(id) on delete cascade clears the link row.
  await supabase.schema('core').from('documents').delete().eq('id', documentId).eq('company_id', companyId);

  revalidatePath(dest);
  redirect(dest);
}

// ----------------------------------------------------------------------------- CSV import (contacts)
// Header-mapped CSV: name,kind,roles,email,phone,country_code,payment_terms,notes
// (roles separated by ';'). Pasted text or a .csv file are both accepted.
export async function importContactsCsv(formData: FormData): Promise<void> {
  const ctx = await getPlatformContext();
  const dest = '/freight/contacts';
  if (!ctx.user || !ctx.activeCompanyId) redirect(`${dest}/import?error=No active company`);
  if (!can(ctx, 'freight.contacts.manage')) redirect(`${dest}/import?error=${encodeURIComponent('No permission')}`);

  let text = String(formData.get('csv') ?? '').trim();
  let filename = 'pasted.csv';
  const file = formData.get('file') as File | null;
  if ((!text) && file && file.size > 0) {
    text = (await file.text()).trim();
    filename = file.name || filename;
  }
  if (!text) redirect(`${dest}/import?error=${encodeURIComponent('Paste CSV or choose a file')}`);

  const rows = parseCsv(text);
  if (rows.length < 2) redirect(`${dest}/import?error=${encodeURIComponent('Need a header row plus at least one data row')}`);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col('name');
  if (iName < 0) redirect(`${dest}/import?error=${encodeURIComponent('CSV must include a "name" column')}`);
  const iKind = col('kind'), iRoles = col('roles'), iEmail = col('email'), iPhone = col('phone');
  const iCountry = col('country_code'), iTerms = col('payment_terms'), iNotes = col('notes');

  const supabase = await createClient();
  const companyId = ctx.activeCompanyId;
  const errors: { row: number; message: string }[] = [];
  let success = 0;
  const dataRows = rows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const name = (r[iName] ?? '').trim();
    if (!name) { errors.push({ row: i + 2, message: 'Missing name' }); continue; }
    const kind = iKind >= 0 && (r[iKind] ?? '').trim().toLowerCase() === 'person' ? 'person' : 'organization';
    const roles = iRoles >= 0 ? (r[iRoles] ?? '').split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [];
    const email = iEmail >= 0 ? (r[iEmail] ?? '').trim() : '';
    const phone = iPhone >= 0 ? (r[iPhone] ?? '').trim() : '';
    const { error } = await supabase.schema('freight' as any).from('contacts').insert({
      company_id: companyId, name, kind, roles,
      emails: email ? [{ label: 'main', address: email }] : [],
      phones: phone ? [{ label: 'main', number: phone }] : [],
      country_code: iCountry >= 0 ? ((r[iCountry] ?? '').trim().toUpperCase() || null) : null,
      payment_terms: iTerms >= 0 ? ((r[iTerms] ?? '').trim() || null) : null,
      notes: iNotes >= 0 ? ((r[iNotes] ?? '').trim() || null) : null,
      created_by: ctx.user.id,
    });
    if (error) errors.push({ row: i + 2, message: error.message }); else success++;
  }

  await supabase.schema('freight' as any).from('import_batches').insert({
    company_id: companyId, entity_type: 'contacts', filename, row_count: dataRows.length,
    success_count: success, error_count: errors.length,
    errors: errors.slice(0, 100),
    status: errors.length === 0 ? 'completed' : (success > 0 ? 'partial' : 'failed'),
    created_by: ctx.user.id,
  });

  revalidatePath(dest);
  redirect(`${dest}?imported=${success}&failed=${errors.length}`);
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields, embedded commas/newlines, "" escapes).
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); out.push(row); }
  return out.filter((r) => r.some((f) => f.trim() !== ''));
}
