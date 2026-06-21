-- =============================================================================
-- TEAL Enterprise — Migration 0008: Auth → core.users sync + first-user bootstrap
-- -----------------------------------------------------------------------------
-- When someone signs up via Supabase Auth, mirror them into core.users so the
-- app's RBAC/profile resolves. The VERY FIRST user to sign up is bootstrapped as
-- the platform super admin (so the platform can be administered); every later user
-- starts with no elevated rights and must be invited to a company with a role.
-- SECURITY DEFINER so the trigger can write core.users (which is RLS-protected).
-- =============================================================================

create or replace function core.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_is_first boolean;
begin
  select count(*) = 0 into v_is_first from core.users;

  insert into core.users (id, email, full_name, is_super_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    v_is_first
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Keep the profile email in sync if it changes in auth.
create or replace function core.handle_auth_user_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update core.users set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_auth_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email on auth.users
  for each row execute function core.handle_auth_user_update();
