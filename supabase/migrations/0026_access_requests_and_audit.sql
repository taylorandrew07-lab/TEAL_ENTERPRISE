-- =============================================================================
-- TEAL Enterprise — Migration 0026: Access-request/approval + privilege audit
-- -----------------------------------------------------------------------------
-- (1) Audit the privilege-management tables so every change to who-can-do-what is
--     tamper-evident (security findings SEC-001/SEC-002): core.users, roles,
--     role_permissions, membership_permissions, platform_settings, user_module_access.
-- (2) Access-request -> approval workflow (owner requirement #2): users request a
--     module; an approver (super admin / users.manage) grants it, which writes
--     core.user_module_access (the per-account read gate from 0025). Self-approval is
--     blocked. No access is granted until approved (fail closed).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) Audit triggers on privilege tables (reuse core.audit_trigger from 0004).
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users', 'roles', 'role_permissions', 'membership_permissions',
    'platform_settings', 'user_module_access'
  ] loop
    execute format('drop trigger if exists trg_audit on core.%I', t);
    execute format(
      'create trigger trg_audit after insert or update or delete on core.%I for each row execute function core.audit_trigger()',
      t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- (2) Access requests.
-- -----------------------------------------------------------------------------
create table core.access_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references core.users(id) on delete cascade,
  company_id    uuid not null references core.companies(id) on delete cascade,
  module_key    text not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note          text,                                  -- requester's reason
  decision_note text,                                  -- approver's note
  requested_at  timestamptz not null default now(),
  reviewed_by   uuid references core.users(id),
  reviewed_at   timestamptz
);
-- At most one OPEN request per user/company/module.
create unique index access_requests_one_pending
  on core.access_requests (user_id, company_id, module_key) where status = 'pending';
create index on core.access_requests (company_id, status);

alter table core.access_requests enable row level security;
grant select, insert, update, delete on core.access_requests to authenticated;

-- Read: super admin, an approver in the company (users.manage), or your own requests.
create policy access_requests_sel on core.access_requests for select using (
  (select core.is_super_admin())
  or user_id = auth.uid()
  or (select core.has_permission(company_id, 'users.manage'))
);
-- Create: only your own request, only in a company you belong to.
create policy access_requests_ins on core.access_requests for insert with check (
  user_id = auth.uid() and company_id in (select core.user_companies())
);
-- Decide: an approver (super admin or users.manage). Self-approval blocked by trigger below.
create policy access_requests_upd on core.access_requests for update using (
  (select core.is_super_admin()) or (select core.has_permission(company_id, 'users.manage'))
) with check (
  (select core.is_super_admin()) or (select core.has_permission(company_id, 'users.manage'))
);
create policy access_requests_del on core.access_requests for delete using ((select core.is_super_admin()));

-- No self-approval: the reviewer cannot be the requester (unless super admin / backend).
create or replace function core.guard_access_request_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or core.is_super_admin() then
    return new;
  end if;
  if new.status is distinct from old.status and new.user_id = auth.uid() then
    raise exception 'You cannot approve or reject your own access request';
  end if;
  return new;
end;
$$;
create trigger trg_guard_access_request_review
  before update on core.access_requests
  for each row execute function core.guard_access_request_review();

create trigger trg_audit_access_requests
  after insert or update or delete on core.access_requests
  for each row execute function core.audit_trigger();
