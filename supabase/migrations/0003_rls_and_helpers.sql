-- =============================================================================
-- TEAL Enterprise — Migration 0003: RLS helper functions, grants, and policies
-- -----------------------------------------------------------------------------
-- Implements tenant isolation. A row is readable when the current user is an
-- active member of its company (or a super admin); writable when their role
-- additionally grants the relevant permission. Conforms to docs/security-and-permissions.md.
-- All helpers are SECURITY DEFINER with an empty search_path and fully-qualified names.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------
create or replace function core.is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select u.is_super_admin from core.users u where u.id = auth.uid()), false);
$$;

create or replace function core.user_companies()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.company_id
  from core.company_memberships m
  where m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function core.has_permission(p_company uuid, p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select core.is_super_admin() or exists (
    select 1
    from core.company_memberships m
    join core.role_permissions rp on rp.role_id = m.role_id
    join core.permissions p on p.id = rp.permission_id
    where m.user_id = auth.uid()
      and m.company_id = p_company
      and m.status = 'active'
      and p.key = p_key
  );
$$;

create or replace function core.user_in_my_company(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select core.is_super_admin() or exists (
    select 1
    from core.company_memberships me
    join core.company_memberships them on them.company_id = me.company_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = p_user and them.status = 'active'
  );
$$;

-- -----------------------------------------------------------------------------
-- Schema + object grants. RLS does the gating; these grants merely allow the
-- authenticated role to attempt access. anon gets nothing. service_role bypasses RLS.
-- -----------------------------------------------------------------------------
grant usage on schema core, accounting to authenticated;
grant select, insert, update, delete on all tables in schema core to authenticated;
grant select, insert, update, delete on all tables in schema accounting to authenticated;
grant select on accounting.general_ledger to authenticated;
grant execute on function core.is_super_admin(), core.user_companies(),
  core.has_permission(uuid, text), core.user_in_my_company(uuid) to authenticated;

-- The GL view must run with the invoker's privileges so the underlying tables'
-- RLS applies (Postgres 15+). Without this, the view owner would bypass RLS.
alter view accounting.general_ledger set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- Standard tenant tables: read = active membership; write = relevant permission.
-- Every table below carries a company_id column.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- core
      ('core','clients','clients.manage'),
      ('core','documents','documents.manage'),
      ('core','company_modules','company.manage'),
      ('core','company_memberships','users.manage'),
      -- accounting (exchange_rates, dashboard_configs, report_exports have custom
      -- SELECT policies below and are intentionally excluded here).
      ('accounting','accounts','accounts.manage'),
      ('accounting','accounting_periods','periods.manage'),
      ('accounting','tax_codes','tax.manage'),
      ('accounting','journal_entries','journals.manage'),
      ('accounting','journal_lines','journals.manage'),
      ('accounting','customers','customers.manage'),
      ('accounting','suppliers','suppliers.manage'),
      ('accounting','bank_accounts','banking.manage'),
      ('accounting','invoices','invoices.manage'),
      ('accounting','invoice_lines','invoices.manage'),
      ('accounting','bills','bills.manage'),
      ('accounting','bill_lines','bills.manage'),
      ('accounting','import_batches','imports.manage'),
      ('accounting','import_staging_rows','imports.manage')
    ) as t(sch, tbl, perm)
  loop
    execute format('alter table %I.%I enable row level security', r.sch, r.tbl);

    -- Both core.user_companies() and core.has_permission() are wrapped in a scalar
    -- sub-select so the planner evaluates them once per statement (per distinct
    -- company_id), not once per row — important for set-based / bulk writes at scale.
    execute format(
      'create policy %I on %I.%I for select using ((select core.is_super_admin()) or company_id in (select core.user_companies()))',
      r.tbl || '_sel', r.sch, r.tbl);

    execute format(
      'create policy %I on %I.%I for insert with check ((select core.has_permission(company_id, %L)))',
      r.tbl || '_ins', r.sch, r.tbl, r.perm);

    execute format(
      'create policy %I on %I.%I for update using ((select core.has_permission(company_id, %L))) with check ((select core.has_permission(company_id, %L)))',
      r.tbl || '_upd', r.sch, r.tbl, r.perm, r.perm);

    execute format(
      'create policy %I on %I.%I for delete using ((select core.has_permission(company_id, %L)))',
      r.tbl || '_del', r.sch, r.tbl, r.perm);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- exchange_rates: company rows visible to members; PLATFORM rows (company_id null)
-- visible to every authenticated user (the "null = platform-wide" design). Only
-- super admins can write platform rows (has_permission(null, ...) is false).
-- -----------------------------------------------------------------------------
alter table accounting.exchange_rates enable row level security;
create policy exchange_rates_sel on accounting.exchange_rates for select
  using ((select core.is_super_admin()) or company_id is null or company_id in (select core.user_companies()));
create policy exchange_rates_ins on accounting.exchange_rates for insert
  with check ((select core.has_permission(company_id, 'currency.manage')));
create policy exchange_rates_upd on accounting.exchange_rates for update
  using ((select core.has_permission(company_id, 'currency.manage')))
  with check ((select core.has_permission(company_id, 'currency.manage')));
create policy exchange_rates_del on accounting.exchange_rates for delete
  using ((select core.has_permission(company_id, 'currency.manage')));

-- -----------------------------------------------------------------------------
-- dashboard_configs: a user sees company-default layouts (user_id null) and their
-- own; not other users' personal dashboards.
-- -----------------------------------------------------------------------------
alter table accounting.dashboard_configs enable row level security;
create policy dashboard_configs_sel on accounting.dashboard_configs for select
  using (
    (select core.is_super_admin())
    or (company_id in (select core.user_companies()) and (user_id is null or user_id = auth.uid()))
  );
create policy dashboard_configs_ins on accounting.dashboard_configs for insert
  with check ((select core.has_permission(company_id, 'dashboards.manage')));
create policy dashboard_configs_upd on accounting.dashboard_configs for update
  using ((select core.has_permission(company_id, 'dashboards.manage')))
  with check ((select core.has_permission(company_id, 'dashboards.manage')));
create policy dashboard_configs_del on accounting.dashboard_configs for delete
  using ((select core.has_permission(company_id, 'dashboards.manage')));

-- -----------------------------------------------------------------------------
-- report_exports: params/file paths are only readable by users who can view
-- reports (or who generated the export) — not every company member.
-- -----------------------------------------------------------------------------
alter table accounting.report_exports enable row level security;
create policy report_exports_sel on accounting.report_exports for select
  using (
    (select core.is_super_admin())
    or generated_by = auth.uid()
    or (select core.has_permission(company_id, 'reports.view'))
  );
create policy report_exports_ins on accounting.report_exports for insert
  with check ((select core.has_permission(company_id, 'reports.export')));
create policy report_exports_upd on accounting.report_exports for update
  using ((select core.has_permission(company_id, 'reports.export')))
  with check ((select core.has_permission(company_id, 'reports.export')));
create policy report_exports_del on accounting.report_exports for delete
  using ((select core.has_permission(company_id, 'reports.export')));

-- -----------------------------------------------------------------------------
-- Special-case tables
-- -----------------------------------------------------------------------------

-- core.companies: members read; super admin creates/deletes; company.manage updates.
alter table core.companies enable row level security;
create policy companies_sel on core.companies for select
  using (core.is_super_admin() or id in (select core.user_companies()));
create policy companies_ins on core.companies for insert
  with check (core.is_super_admin());
create policy companies_upd on core.companies for update
  using (core.is_super_admin() or core.has_permission(id, 'company.manage'))
  with check (core.is_super_admin() or core.has_permission(id, 'company.manage'));
create policy companies_del on core.companies for delete
  using (core.is_super_admin());

-- core.users: a user reads only their OWN full row (which carries is_super_admin);
-- co-member name/email lookups go through core.user_directory below, which never
-- exposes is_super_admin. This stops broadcasting super-admin status for recon.
alter table core.users enable row level security;
create policy users_sel on core.users for select
  using (id = auth.uid() or core.is_super_admin());
create policy users_ins on core.users for insert
  with check (core.is_super_admin() or id = auth.uid());
create policy users_upd on core.users for update
  using (id = auth.uid() or core.is_super_admin())
  with check (id = auth.uid() or core.is_super_admin());
create policy users_del on core.users for delete
  using (core.is_super_admin());

-- Co-member directory: exposes ONLY id/full_name/email for the current user and the
-- members of companies they belong to. Runs with owner privileges (NOT security_invoker)
-- so it can read across the strict users policy, but the WHERE clause and column list
-- keep it to safe fields for co-members only.
create view core.user_directory as
  select u.id, u.full_name, u.email
  from core.users u
  where u.id = auth.uid() or core.user_in_my_company(u.id);
grant select on core.user_directory to authenticated;

-- core.roles: system roles (company_id null) readable by all; company roles by members.
alter table core.roles enable row level security;
create policy roles_sel on core.roles for select
  using (company_id is null or core.is_super_admin() or company_id in (select core.user_companies()));
create policy roles_ins on core.roles for insert
  with check (core.is_super_admin() or (company_id is not null and core.has_permission(company_id, 'users.manage')));
create policy roles_upd on core.roles for update
  using (core.is_super_admin() or (company_id is not null and core.has_permission(company_id, 'users.manage')))
  with check (core.is_super_admin() or (company_id is not null and core.has_permission(company_id, 'users.manage')));
create policy roles_del on core.roles for delete
  using (core.is_super_admin() or (company_id is not null and core.has_permission(company_id, 'users.manage')));

-- core.role_permissions: gated via the parent role.
alter table core.role_permissions enable row level security;
create policy role_perms_sel on core.role_permissions for select
  using (exists (
    select 1 from core.roles r where r.id = role_id
      and (r.company_id is null or core.is_super_admin() or r.company_id in (select core.user_companies()))));
create policy role_perms_ins on core.role_permissions for insert
  with check (exists (
    select 1 from core.roles r where r.id = role_id
      and (core.is_super_admin() or (r.company_id is not null and core.has_permission(r.company_id, 'users.manage')))));
create policy role_perms_del on core.role_permissions for delete
  using (exists (
    select 1 from core.roles r where r.id = role_id
      and (core.is_super_admin() or (r.company_id is not null and core.has_permission(r.company_id, 'users.manage')))));

-- core.audit_logs: read with audit.view; writes only via the SECURITY DEFINER trigger (0004).
alter table core.audit_logs enable row level security;
create policy audit_sel on core.audit_logs for select
  using (core.is_super_admin() or core.has_permission(company_id, 'audit.view'));

-- Reference catalogues: any authenticated user may read; only super admins write.
alter table core.permissions enable row level security;
create policy permissions_sel on core.permissions for select using (auth.uid() is not null);
create policy permissions_write on core.permissions for all
  using (core.is_super_admin()) with check (core.is_super_admin());

alter table core.modules enable row level security;
create policy modules_sel on core.modules for select using (auth.uid() is not null);
create policy modules_write on core.modules for all
  using (core.is_super_admin()) with check (core.is_super_admin());

alter table accounting.currencies enable row level security;
create policy currencies_sel on accounting.currencies for select using (auth.uid() is not null);
create policy currencies_write on accounting.currencies for all
  using (core.is_super_admin()) with check (core.is_super_admin());

alter table accounting.account_types enable row level security;
create policy account_types_sel on accounting.account_types for select using (auth.uid() is not null);
create policy account_types_write on accounting.account_types for all
  using (core.is_super_admin()) with check (core.is_super_admin());
