// Read-side access for the AI infrastructure (server components). RLS scopes to the
// active company; pages additionally gate on freight.ai.manage.
import 'server-only';
import { freightDb } from '../context';

export interface AiJobRow {
  id: string; shipment_id: string | null; job_type: string; status: string;
  performed_by: string; output: { text?: string | null } | null; tool_calls: unknown;
  model: string | null; error: string | null; created_at: string; completed_at: string | null;
}

const COLS = 'id, shipment_id, job_type, status, performed_by, output, tool_calls, model, error, created_at, completed_at';

export async function listAwaitingAiJobs(): Promise<AiJobRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('ai_jobs').select(COLS).eq('status', 'awaiting_approval').order('created_at', { ascending: false });
  return (data as AiJobRow[] | null) ?? [];
}

export async function listRecentAiJobs(limit = 25): Promise<AiJobRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('ai_jobs').select(COLS).order('created_at', { ascending: false }).limit(limit);
  return (data as AiJobRow[] | null) ?? [];
}

export interface PromptRow { id: string; key: string; name: string; template: string; version: number; is_active: boolean; updated_at: string }

export async function listPrompts(): Promise<PromptRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('prompts').select('id, key, name, template, version, is_active, updated_at').eq('is_active', true).order('key');
  return (data as PromptRow[] | null) ?? [];
}
