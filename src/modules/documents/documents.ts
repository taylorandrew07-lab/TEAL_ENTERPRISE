// Documents — upload, list, download and delete files attached to the active company.
// Files live in the private 'documents' Storage bucket at <company_id>/<doc_id>/<name>;
// metadata is mirrored in core.documents. All access runs under the user's session, so
// the company-scoped Storage RLS (0017) and core.documents RLS (documents.manage) are
// the authority — this layer never bypasses them.
'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';
import { can } from '@/core/session/types';

const MAX_BYTES = 25 * 1024 * 1024;

export interface DocumentRow {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
  url: string | null;
}

function back(error?: string): never {
  redirect(error ? `/accounting/documents?error=${encodeURIComponent(error)}` : '/accounting/documents');
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const ctx = await getPlatformContext();
  if (!ctx.activeCompanyId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .schema('core')
    .from('documents')
    .select('id, filename, mime_type, created_at, storage_path')
    .eq('company_id', ctx.activeCompanyId)
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = (data as any[] | null) ?? [];
  if (rows.length === 0) return [];

  // Batch signed URLs (1h) so the list renders working download links.
  const { data: signed } = await supabase.storage.from('documents').createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const urlByPath = new Map(((signed as any[] | null) ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime_type: r.mime_type,
    created_at: r.created_at,
    url: urlByPath.get(r.storage_path) ?? null,
  }));
}

export async function uploadDocument(formData: FormData): Promise<void> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) back('No active company.');
  if (!ctx.isSuperAdmin && !can(ctx, 'documents.manage')) back('You do not have permission to upload documents.');

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) back('Choose a file to upload.');
  if (file.size > MAX_BYTES) back('File exceeds the 25 MB limit.');

  const supabase = await createClient();
  const docId = randomUUID();
  const safeName = (file.name || 'file').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 180) || 'file';
  const path = `${ctx.activeCompanyId}/${docId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (upErr) back(upErr.message);

  const { error: dbErr } = await supabase.schema('core').from('documents').insert({
    company_id: ctx.activeCompanyId,
    owner_module: 'accounting',
    storage_path: path,
    filename: file.name || safeName,
    mime_type: file.type || null,
    uploaded_by: ctx.user.id,
  });
  if (dbErr) {
    // Roll back the orphaned object so storage and metadata stay consistent.
    await supabase.storage.from('documents').remove([path]);
    back(dbErr.message);
  }

  revalidatePath('/accounting/documents');
  back();
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await getPlatformContext();
  if (!ctx.user || !ctx.activeCompanyId) back('No active company.');
  if (!ctx.isSuperAdmin && !can(ctx, 'documents.manage')) back('You do not have permission to delete documents.');

  const id = String(formData.get('id') ?? '');
  if (!id) back('Missing document.');

  const supabase = await createClient();
  const { data: doc } = await supabase
    .schema('core')
    .from('documents')
    .select('storage_path')
    .eq('id', id)
    .eq('company_id', ctx.activeCompanyId)
    .maybeSingle();
  if (doc?.storage_path) await supabase.storage.from('documents').remove([doc.storage_path]);
  await supabase.schema('core').from('documents').delete().eq('id', id).eq('company_id', ctx.activeCompanyId);

  revalidatePath('/accounting/documents');
  back();
}
