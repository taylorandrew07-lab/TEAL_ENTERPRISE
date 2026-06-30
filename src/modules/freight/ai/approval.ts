// AI approval queue actions. A human reviews AI-proposed jobs before anything commits.
// Gated on freight.ai.manage; the underlying write (when a task wires real tool calls)
// is additionally re-checked by RLS under the approver's session — exactly the spec's
// "the AI calls the same permission-checked action a human would".
//
// INFRASTRUCTURE NOTE: concrete task executors (mapping a stored tool_call to a real
// freight server action) are NOT wired yet — that happens per task when AI is switched
// on. Until then, approving a job with proposed tool calls records the decision and
// marks it done WITHOUT executing (text-only jobs complete as 'done' at run time and
// never reach this queue). The executor registry is the single seam to fill: replace
// the marked TODO below with a lookup of `tool_calls[].name` → action core function.
'use server';

import { revalidatePath } from 'next/cache';
import { freightDb } from '../context';
import { can } from '@/core/session/types';

type Result = { ok: true } | { ok: false; error: string };

async function requireAiAdmin() {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) throw new Error('No active company.');
  if (!ctx.isSuperAdmin && !can(ctx, 'freight.ai.manage')) throw new Error('You do not have permission to approve AI actions.');
  return { freight, companyId, userId: ctx.user?.id ?? null };
}

export async function approveAiJob(formData: FormData): Promise<Result> {
  try {
    const { freight, userId } = await requireAiAdmin();
    const id = String(formData.get('id') ?? '');
    if (!id) return { ok: false, error: 'Missing job id.' };

    // TODO (per-task, when AI is switched on): load tool_calls and execute each via the
    // executor registry (tool name → action core function), under this session's RLS.
    // For pure infrastructure we record the approval and complete the job.
    const { error } = await freight.from('ai_jobs')
      .update({ status: 'done', approved_by: userId, completed_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'awaiting_approval');
    if (error) return { ok: false, error: error.message };
    revalidatePath('/freight/ai');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Failed.' }; }
}

export async function rejectAiJob(formData: FormData): Promise<Result> {
  try {
    const { freight, userId } = await requireAiAdmin();
    const id = String(formData.get('id') ?? '');
    if (!id) return { ok: false, error: 'Missing job id.' };
    const { error } = await freight.from('ai_jobs')
      .update({ status: 'skipped', approved_by: userId, completed_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'awaiting_approval');
    if (error) return { ok: false, error: error.message };
    revalidatePath('/freight/ai');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Failed.' }; }
}
