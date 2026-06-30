// Admin actions for AI configuration: per-task model/mode settings, prompt editing,
// installing default prompts, and a provider connection test. All gated on
// freight.ai.manage (RLS is the backstop). Writes go through the user session.
'use server';

import { revalidatePath } from 'next/cache';
import { freightDb } from '../context';
import { can } from '@/core/session/types';
import { DEFAULT_PROMPTS } from './prompts.defaults';
import { testProvider } from './runner';

type Result = { ok: true } | { ok: false; error: string };

async function requireAiAdmin() {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) throw new Error('No active company.');
  if (!ctx.isSuperAdmin && !can(ctx, 'freight.ai.manage')) throw new Error('You do not have permission to manage AI.');
  return { freight, companyId };
}

export async function upsertTaskSetting(formData: FormData): Promise<Result> {
  try {
    const { freight, companyId } = await requireAiAdmin();
    const job_type = String(formData.get('job_type') ?? '');
    const mode = String(formData.get('mode') ?? 'off');
    const tier = (String(formData.get('tier') ?? '') || null) as string | null;
    const provider = (String(formData.get('provider') ?? '').trim() || null) as string | null;
    const model = (String(formData.get('model') ?? '').trim() || null) as string | null;
    if (!job_type) return { ok: false, error: 'Missing task.' };

    const { data: existing } = await freight.from('ai_task_settings').select('id').eq('job_type', job_type).maybeSingle();
    const row = { company_id: companyId, job_type, mode, tier, provider, model };
    const { error } = existing
      ? await freight.from('ai_task_settings').update(row).eq('id', (existing as { id: string }).id)
      : await freight.from('ai_task_settings').insert(row);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/freight/settings/ai');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Failed.' }; }
}

export async function installDefaultPrompts(): Promise<Result> {
  try {
    const { freight, companyId } = await requireAiAdmin();
    for (const [key, p] of Object.entries(DEFAULT_PROMPTS)) {
      const { data: existing } = await freight.from('prompts').select('id').eq('key', key).limit(1).maybeSingle();
      if (existing) continue; // don't clobber edited prompts
      const { error } = await freight.from('prompts').insert({
        company_id: companyId, key, name: p.name, template: p.template, variables: p.variables, version: 1, is_active: true,
      });
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath('/freight/settings/ai');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Failed.' }; }
}

export async function savePrompt(formData: FormData): Promise<Result> {
  try {
    const { freight, companyId } = await requireAiAdmin();
    const key = String(formData.get('key') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const template = String(formData.get('template') ?? '');
    if (!key || !template) return { ok: false, error: 'Key and template are required.' };
    // New version; keep history. The runner reads the highest active version.
    const { data: latest } = await freight.from('prompts').select('version').eq('key', key).order('version', { ascending: false }).limit(1).maybeSingle();
    const version = ((latest as { version: number } | null)?.version ?? 0) + 1;
    const { error } = await freight.from('prompts').insert({ company_id: companyId, key, name: name || key, template, variables: [], version, is_active: true });
    if (error) return { ok: false, error: error.message };
    revalidatePath('/freight/settings/ai');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Failed.' }; }
}

export async function testProviderConnection(formData: FormData): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    await requireAiAdmin();
    const provider = String(formData.get('provider') ?? '');
    const model = String(formData.get('model') ?? '');
    if (!provider || !model) return { ok: false, error: 'Pick a provider and model.' };
    return await testProvider(provider, model);
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Failed.' }; }
}
