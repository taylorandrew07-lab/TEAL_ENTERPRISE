// The generic AI job runner. Resolves the task's effective config + active prompt,
// calls the configured provider, and records a freight.ai_jobs row. Stays fully
// dormant: if the task is 'off' or no provider key is configured, it writes a
// 'skipped' job and calls no model — mirroring the email NoopSender discipline.
//
// This is INFRASTRUCTURE: it runs any job_type generically (renders the prompt, sends
// the input as context, stores the text output). Task-specific tool/structured-output
// wiring (proposing real actions for the approval queue) plugs in here per job_type
// when a task is switched on — the seam is `opts.tools` / `opts.schema` + the executor
// registry in approval.ts.
import 'server-only';
import { freightDb } from '../context';
import { getTaskConfig } from './config';
import { JOB_TYPE_BY_KEY } from './tiers';
import { DEFAULT_PROMPTS } from './prompts.defaults';
import { getAIProvider, type AIToolDef } from '@/core/ai';

export interface RunResult { jobId: string | null; status: string; text?: string | null; error?: string }

interface RunOpts { shipmentId?: string | null; tools?: AIToolDef[]; maxTokens?: number; temperature?: number }

function render(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = input[k];
    return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}

export async function runAiJob(jobType: string, input: Record<string, unknown>, opts: RunOpts = {}): Promise<RunResult> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) return { jobId: null, status: 'failed', error: 'No active company.' };

  const cfg = await getTaskConfig(jobType);
  const userId = ctx.user?.id ?? null;

  const writeJob = async (fields: Record<string, unknown>) => {
    const { data, error } = await freight.from('ai_jobs').insert({
      company_id: companyId, shipment_id: opts.shipmentId ?? null, job_type: jobType,
      performed_by: 'ai', prompt_key: jobType, model: cfg.model, created_by: userId, ...fields,
    }).select('id').single();
    return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null };
  };

  // Dormant paths — no model is called. The audit-row write is best-effort here.
  if (cfg.mode === 'off') {
    const { id } = await writeJob({ status: 'skipped', input, error: 'AI is off for this task.' });
    return { jobId: id, status: 'skipped', error: 'AI is off for this task.' };
  }
  const provider = getAIProvider(cfg.provider);
  if (!provider.configured) {
    const { id } = await writeJob({ status: 'skipped', input, error: `No API key configured for provider "${cfg.provider}".` });
    return { jobId: id, status: 'skipped', error: `No API key configured for provider "${cfg.provider}".` };
  }

  // Resolve the active prompt (DB override → code default).
  const { data: promptRow } = await freight.from('prompts')
    .select('template').eq('key', jobType).eq('is_active', true).order('version', { ascending: false }).limit(1).maybeSingle();
  const template = (promptRow as { template: string } | null)?.template ?? DEFAULT_PROMPTS[jobType]?.template
    ?? 'You are a freight operations assistant. Respond helpfully using the context.\n\n{{context}}';
  const system = render(template, input);

  try {
    const result = await provider.complete({
      model: cfg.model,
      system,
      messages: [{ role: 'user', content: typeof input.context === 'string' ? input.context : JSON.stringify(input) }],
      tools: opts.tools,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    });
    const readOnly = JOB_TYPE_BY_KEY.get(jobType)?.readOnly ?? result.toolCalls.length === 0;
    const status = readOnly || result.toolCalls.length === 0 ? 'done' : 'awaiting_approval';
    const { id, error } = await writeJob({
      status, input, output: { text: result.text }, tool_calls: result.toolCalls.length ? result.toolCalls : null,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    });
    // The model already ran; if the audit row couldn't be written, report failure
    // rather than a phantom success the approval queue can never act on.
    if (error) return { jobId: null, status: 'failed', error: `AI ran but the job could not be recorded: ${error}` };
    return { jobId: id, status, text: result.text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI call failed.';
    const { id } = await writeJob({ status: 'failed', input, error: msg });
    return { jobId: id, status: 'failed', error: msg };
  }
}

/** Settings "test connection": a trivial round-trip to prove a provider/model works.
 *  Does NOT write an ai_jobs row. */
export async function testProvider(providerId: string, model: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const provider = getAIProvider(providerId);
  if (!provider.configured) return { ok: false, error: `No API key configured for "${providerId}".` };
  try {
    const r = await provider.complete({ model, messages: [{ role: 'user', content: 'Reply with the single word: OK' }], maxTokens: 8 });
    return { ok: true, text: r.text ?? '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed.' };
  }
}
