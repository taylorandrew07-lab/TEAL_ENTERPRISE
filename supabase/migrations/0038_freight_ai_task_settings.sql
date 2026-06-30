-- =============================================================================
-- TEAL Enterprise — Migration 0038: Freight AI per-task settings (provider-agnostic)
-- -----------------------------------------------------------------------------
-- Per-company, per-task AI configuration so non-technical staff can pick the model
-- (and turn AI on/off) per task in a settings screen — no redeploy. Code holds the
-- defaults (src/modules/freight/ai/tiers.ts: tier per task, model per tier); a row
-- here overrides them. `mode` drives the rollout: off (humans only) -> suggest (AI
-- drafts, human approves) -> auto (AI acts). Every task defaults to 'off'. Gated on
-- freight.ai.manage; mirrors the 0020 RLS pattern.
-- =============================================================================
create table freight.ai_task_settings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  job_type    text not null,
  mode        text not null default 'off' check (mode in ('off', 'suggest', 'auto')),
  tier        text check (tier in ('cheap', 'standard', 'premium')),  -- optional override of the code default
  provider    text,   -- optional explicit provider id (anthropic/openai/deepseek/gemini/glm/…)
  model       text,   -- optional explicit model id
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, job_type)
);
create index on freight.ai_task_settings (company_id);

create trigger trg_ai_task_settings_updated_at
  before update on freight.ai_task_settings
  for each row execute function core.set_updated_at();

grant select, insert, update, delete on freight.ai_task_settings to authenticated;
grant select, insert, update, delete on freight.ai_task_settings to service_role;

alter table freight.ai_task_settings enable row level security;
create policy ai_task_settings_sel on freight.ai_task_settings for select
  using ((select core.is_super_admin()) or company_id in (select core.user_companies()));
create policy ai_task_settings_ins on freight.ai_task_settings for insert
  with check ((select core.has_permission(company_id, 'freight.ai.manage')));
create policy ai_task_settings_upd on freight.ai_task_settings for update
  using ((select core.has_permission(company_id, 'freight.ai.manage')))
  with check ((select core.has_permission(company_id, 'freight.ai.manage')));
create policy ai_task_settings_del on freight.ai_task_settings for delete
  using ((select core.has_permission(company_id, 'freight.ai.manage')));

create trigger trg_audit after insert or update or delete on freight.ai_task_settings
  for each row execute function core.audit_trigger();
