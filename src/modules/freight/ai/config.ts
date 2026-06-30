// Resolves the effective AI configuration for a task: a freight.ai_task_settings row
// (if any) overrides the code defaults in tiers.ts. Read via the user session (RLS).
import 'server-only';
import { freightDb } from '../context';
import { AI_JOB_TYPES, JOB_TYPE_BY_KEY, TIER_MODEL, type AIMode, type AITier } from './tiers';

export interface EffectiveTaskConfig {
  jobType: string;
  mode: AIMode;
  tier: AITier;
  provider: string;
  model: string;
  overridden: boolean;
}

interface SettingRow { job_type: string; mode: AIMode; tier: AITier | null; provider: string | null; model: string | null }

function resolve(jobType: string, row: SettingRow | undefined): EffectiveTaskConfig {
  const tier: AITier = row?.tier ?? JOB_TYPE_BY_KEY.get(jobType)?.defaultTier ?? 'standard';
  return {
    jobType,
    mode: row?.mode ?? 'off',
    tier,
    provider: row?.provider ?? TIER_MODEL[tier].provider,
    model: row?.model ?? TIER_MODEL[tier].model,
    overridden: Boolean(row),
  };
}

/** Effective config for one task. */
export async function getTaskConfig(jobType: string): Promise<EffectiveTaskConfig> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return resolve(jobType, undefined);
  const { data } = await freight.from('ai_task_settings').select('job_type, mode, tier, provider, model')
    .eq('company_id', companyId).eq('job_type', jobType).maybeSingle();
  return resolve(jobType, (data as SettingRow | null) ?? undefined);
}

/** Effective config for every catalogued task — for the settings screen. */
export async function listTaskConfigs(): Promise<EffectiveTaskConfig[]> {
  const { freight, companyId } = await freightDb();
  const rows = companyId
    ? (((await freight.from('ai_task_settings').select('job_type, mode, tier, provider, model').eq('company_id', companyId)).data) as SettingRow[] | null) ?? []
    : [];
  const byType = new Map(rows.map((r) => [r.job_type, r]));
  return AI_JOB_TYPES.map((t) => resolve(t.key, byType.get(t.key)));
}
