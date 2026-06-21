-- =============================================================================
-- TEAL Enterprise — Migration 0013: Security hardening (Phase 0)
-- -----------------------------------------------------------------------------
-- Closes three gaps found in the security audit, BEFORE any scoped (non-super-admin)
-- user is onboarded:
--   C1  Privilege escalation — the users_upd RLS policy (0003) lets a user update
--       their own row including is_super_admin. Add a DB trigger so only an existing
--       super admin (or a trusted backend context) can change privileged fields.
--   H3  The super admin is not protected — add a designated, undeletable/undemotable
--       owner and forbid removing the last super admin.
--   H2  Signup bootstrap auto-elevated the first user. Stop auto-elevation; super
--       admins are provisioned out-of-band (scripts/setup-admin.mjs).
--
-- Trust model: an end-user API request always carries a JWT, so auth.uid() is non-null;
-- migrations, admin scripts (postgres), and the auth service run with auth.uid() null.
-- The guards therefore trust auth.uid() IS NULL and gate only real end-user calls.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- C1 — privileged-field guard on core.users (insert + update)
-- -----------------------------------------------------------------------------
create or replace function core.guard_user_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Trusted backend (no JWT): migrations, admin scripts, auth-service sync.
  if auth.uid() is null then
    return new;
  end if;
  -- An existing super admin may change privileged fields (e.g. promote a teammate).
  if core.is_super_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.is_super_admin then
      raise exception 'Not authorized to create a super-admin account';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_super_admin is distinct from old.is_super_admin then
      raise exception 'Not authorized to change super-admin status';
    end if;
    if new.id is distinct from old.id then
      raise exception 'Not authorized to change a user id';
    end if;
    if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
      raise exception 'Email is managed by authentication and cannot be changed here';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_user_privileged_fields on core.users;
create trigger trg_guard_user_privileged_fields
  before insert or update on core.users
  for each row execute function core.guard_user_privileged_fields();

-- -----------------------------------------------------------------------------
-- H2 — stop the first-signup auto-super-admin bootstrap
-- -----------------------------------------------------------------------------
create or replace function core.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into core.users (id, email, full_name, is_super_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    false  -- never auto-elevate; super admins are provisioned out-of-band
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- H3 — protected owner super admin + never-zero-super-admins
-- -----------------------------------------------------------------------------
create table if not exists core.platform_settings (
  id                       int primary key default 1 check (id = 1),
  protected_super_admin_id uuid references core.users(id) on delete set null,
  updated_at               timestamptz not null default now()
);
alter table core.platform_settings enable row level security;
grant select on core.platform_settings to authenticated;
drop policy if exists platform_settings_sel on core.platform_settings;
create policy platform_settings_sel on core.platform_settings for select
  using (auth.uid() is not null);
drop policy if exists platform_settings_write on core.platform_settings;
create policy platform_settings_write on core.platform_settings for all
  using (core.is_super_admin()) with check (core.is_super_admin());

-- Designate the owner = the earliest super admin. Idempotent: keep an existing value.
insert into core.platform_settings (id, protected_super_admin_id)
values (1, (select u.id from core.users u where u.is_super_admin order by u.created_at limit 1))
on conflict (id) do update
  set protected_super_admin_id = coalesce(core.platform_settings.protected_super_admin_id, excluded.protected_super_admin_id);

create or replace function core.protect_super_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_protected uuid;
  v_other_supers int;
begin
  -- Trusted backend (no JWT) may perform maintenance; the API can never demote/delete the owner.
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  select protected_super_admin_id into v_protected from core.platform_settings where id = 1;

  if tg_op = 'DELETE' then
    if old.id = v_protected then
      raise exception 'The protected owner account cannot be deleted';
    end if;
    if old.is_super_admin then
      select count(*) into v_other_supers from core.users where is_super_admin and id <> old.id;
      if v_other_supers = 0 then
        raise exception 'Cannot delete the last super-admin';
      end if;
    end if;
    return old;
  end if;

  -- UPDATE: block demoting the protected owner or the last super admin.
  if old.id = v_protected and old.is_super_admin and not new.is_super_admin then
    raise exception 'The protected owner cannot be demoted';
  end if;
  if old.is_super_admin and not new.is_super_admin then
    select count(*) into v_other_supers from core.users where is_super_admin and id <> old.id;
    if v_other_supers = 0 then
      raise exception 'Cannot demote the last super-admin';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_super_admin on core.users;
create trigger trg_protect_super_admin
  before update or delete on core.users
  for each row execute function core.protect_super_admin();
