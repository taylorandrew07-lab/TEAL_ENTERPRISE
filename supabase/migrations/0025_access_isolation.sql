-- =============================================================================
-- TEAL Enterprise — Migration 0025: Per-account module isolation (security P0)
-- -----------------------------------------------------------------------------
-- Closes the dominant security finding (DI-1): module SELECT policies were
-- MEMBERSHIP-only, so any active company member could READ every module's data in
-- that company regardless of what they were granted. This makes READ access
-- per-ACCOUNT, per-MODULE: a user only sees a module's data if they hold an explicit
-- grant in core.user_module_access (super admins still bypass). Writes were already
-- permission-gated. Also blocks a user from changing their own membership role.
--
-- SAFE TO SHIP NOW: only the super-admin owner exists; super admin bypasses these
-- checks, so nothing is locked out. Until the access-request/approval UI (next phase)
-- populates user_module_access, non-super-admins are denied by default (fail closed) —
-- which is the desired state before onboarding anyone. See docs/security report.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Per-account, per-module access grant (the read/isolation boundary).
-- -----------------------------------------------------------------------------
create table core.user_module_access (
  user_id    uuid not null references core.users(id) on delete cascade,
  company_id uuid not null references core.companies(id) on delete cascade,
  module_key text not null,                         -- 'accounting' | 'cargo' | 'freight'
  granted_by uuid references core.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, company_id, module_key)
);
alter table core.user_module_access enable row level security;
grant select, insert, update, delete on core.user_module_access to authenticated;

-- Manage by super admin only for now (module admins added with the approval flow).
-- Users may read their own grants (so the app can resolve what they can open).
create policy uma_sel on core.user_module_access for select
  using ((select core.is_super_admin()) or user_id = auth.uid());
create policy uma_ins on core.user_module_access for insert
  with check ((select core.is_super_admin()));
create policy uma_upd on core.user_module_access for update
  using ((select core.is_super_admin())) with check ((select core.is_super_admin()));
create policy uma_del on core.user_module_access for delete
  using ((select core.is_super_admin()));

-- -----------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER, empty search_path — matches 0003 helpers).
-- -----------------------------------------------------------------------------
create or replace function core.user_has_module(p_company uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.user_module_access uma
    where uma.user_id = auth.uid() and uma.company_id = p_company and uma.module_key = p_module
  );
$$;

-- Canonical READ gate for module-scoped tables: super admin, OR an active member of
-- the company who ALSO holds an explicit grant for that module.
create or replace function core.can_read(p_company uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select core.is_super_admin()
    or (p_company in (select core.user_companies()) and core.user_has_module(p_company, p_module));
$$;

grant execute on function core.user_has_module(uuid, text) to authenticated;
grant execute on function core.can_read(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Rewrite the standard tenant SELECT policies (the loop-generated "<table>_sel")
-- across the three module schemas to require module access. Data-driven so it
-- covers every such table without re-listing 60+. EXCLUDES:
--   * client-portal additive policies (…client_sel) — external read paths, untouched
--   * accounting.exchange_rates_sel — handled separately (shared null-company rows)
--   * tables without a company_id column (reference data) — left as-is
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in ('accounting', 'cargo', 'freight')
      and cmd = 'SELECT'
      and policyname ~ '_sel$'
      and policyname !~ 'client_sel$'
      and policyname <> 'exchange_rates_sel'
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = r.schemaname and table_name = r.tablename and column_name = 'company_id'
    ) then
      execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      -- schema name == module key for accounting/cargo/freight
      execute format(
        'create policy %I on %I.%I for select using ((select core.can_read(company_id, %L)))',
        r.policyname, r.schemaname, r.tablename, r.schemaname);
    end if;
  end loop;
end $$;

-- exchange_rates: keep shared (company_id is null) rows readable to all members;
-- company-specific rows now require accounting module access.
drop policy if exists exchange_rates_sel on accounting.exchange_rates;
create policy exchange_rates_sel on accounting.exchange_rates for select
  using (
    (select core.is_super_admin())
    or company_id is null
    or (select core.can_read(company_id, 'accounting'))
  );

-- -----------------------------------------------------------------------------
-- Block self role-change on memberships (self-escalation finding SELF-ESC-1).
-- A user cannot change their OWN company_memberships.role_id; super admin and the
-- trusted backend (auth.uid() null) are exempt. Privileged-role assignment by
-- others is further governed by the membership_permissions guard (0014).
-- -----------------------------------------------------------------------------
create or replace function core.guard_membership_self_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or core.is_super_admin() then
    return new;
  end if;
  if new.user_id = auth.uid() and new.role_id is distinct from old.role_id then
    raise exception 'You cannot change your own role';
  end if;
  return new;
end;
$$;

create trigger trg_guard_membership_self_role
  before update on core.company_memberships
  for each row execute function core.guard_membership_self_role();
