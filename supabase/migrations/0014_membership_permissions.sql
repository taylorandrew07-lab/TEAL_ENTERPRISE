-- =============================================================================
-- TEAL Enterprise — Migration 0014: Per-user permission model (Phase 1)
-- -----------------------------------------------------------------------------
-- The owner wants each user granted SPECIFIC permissions (checkboxes), with roles
-- as one-click templates — and the ability to TRIM individual permissions later.
-- Today authorization is role-only (has_permission reads role_permissions). This
-- makes the per-membership grant the source of truth:
--   * core.membership_permissions(membership_id, permission_id) — the checkboxes.
--   * core.has_permission() now reads these grants (not role_permissions), so RLS
--     and the UI honour exactly what is ticked (removal works, not just addition).
--   * Existing memberships are backfilled from their role's grants → no access change.
--   * Roles remain templates (apply = copy the role's permission set onto a member).
--   * H4 escalation guard: an end user cannot edit their OWN grants, and cannot grant
--     a permission they do not themselves hold (subset rule). Super admins bypass.
-- =============================================================================

-- 1. The grant table (the "checkboxes").
create table core.membership_permissions (
  membership_id uuid not null references core.company_memberships(id) on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  granted_by    uuid references core.users(id) on delete set null,
  granted_at    timestamptz not null default now(),
  primary key (membership_id, permission_id)
);
create index on core.membership_permissions (membership_id);
comment on table core.membership_permissions is
  'Per-membership permission grants — the authoritative source for core.has_permission(). Roles are templates that seed these.';

-- 2. Backfill existing memberships from their role grants (preserve current access).
insert into core.membership_permissions (membership_id, permission_id)
select m.id, rp.permission_id
from core.company_memberships m
join core.role_permissions rp on rp.role_id = m.role_id
on conflict do nothing;

-- 3. Repoint has_permission() at membership grants. Same signature → all existing
--    RLS policies keep working, now reading the per-user grants.
create or replace function core.has_permission(p_company uuid, p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select core.is_super_admin() or exists (
    select 1
    from core.company_memberships m
    join core.membership_permissions mp on mp.membership_id = m.id
    join core.permissions p on p.id = mp.permission_id
    where m.user_id = auth.uid()
      and m.company_id = p_company
      and m.status = 'active'
      and p.key = p_key
  );
$$;

-- 4. RLS: read your own grants or (with users.manage) any member's in your company;
--    write requires users.manage in that company. Super admins bypass.
alter table core.membership_permissions enable row level security;
grant select, insert, update, delete on core.membership_permissions to authenticated;

create policy membership_perms_sel on core.membership_permissions for select using (
  core.is_super_admin() or exists (
    select 1 from core.company_memberships m
    where m.id = membership_id
      and (m.user_id = auth.uid() or core.has_permission(m.company_id, 'users.manage'))
  )
);
create policy membership_perms_ins on core.membership_permissions for insert with check (
  core.is_super_admin() or exists (
    select 1 from core.company_memberships m
    where m.id = membership_id and core.has_permission(m.company_id, 'users.manage')
  )
);
create policy membership_perms_del on core.membership_permissions for delete using (
  core.is_super_admin() or exists (
    select 1 from core.company_memberships m
    where m.id = membership_id and core.has_permission(m.company_id, 'users.manage')
  )
);

-- 5. H4 escalation guard: end users can't grant to themselves or grant a permission
--    they don't hold. Trusted backend (auth.uid() null) and super admins bypass.
create or replace function core.guard_membership_grant()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company     uuid;
  v_target_user uuid;
  v_perm_key    text;
begin
  if auth.uid() is null then return new; end if;
  if core.is_super_admin() then return new; end if;

  select m.company_id, m.user_id into v_company, v_target_user
  from core.company_memberships m where m.id = new.membership_id;

  if v_target_user = auth.uid() then
    raise exception 'You cannot change your own permissions';
  end if;

  select p.key into v_perm_key from core.permissions p where p.id = new.permission_id;
  if not core.has_permission(v_company, v_perm_key) then
    raise exception 'You cannot grant a permission you do not hold';
  end if;

  return new;
end;
$$;

create trigger trg_guard_membership_grant
  before insert on core.membership_permissions
  for each row execute function core.guard_membership_grant();
