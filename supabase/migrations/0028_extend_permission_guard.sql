-- =============================================================================
-- TEAL Enterprise — Migration 0028: Extend the permission guard to revoke/edit
-- -----------------------------------------------------------------------------
-- Findings PERM-1 / AC-4: the 0014 escalation guard fired on INSERT only, so the
-- revoke (DELETE) path had no subset/self check and a future UPDATE path was
-- unguarded. This adds matching guards: a non-super-admin cannot change their OWN
-- grants, and cannot revoke a permission they do not themselves hold. Super admins
-- and the trusted backend (auth.uid() null) bypass.
-- =============================================================================

create or replace function core.guard_membership_revoke()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company     uuid;
  v_target_user uuid;
  v_perm_key    text;
begin
  if auth.uid() is null then return old; end if;
  if core.is_super_admin() then return old; end if;

  select m.company_id, m.user_id into v_company, v_target_user
  from core.company_memberships m where m.id = old.membership_id;

  if v_target_user = auth.uid() then
    raise exception 'You cannot change your own permissions';
  end if;

  select p.key into v_perm_key from core.permissions p where p.id = old.permission_id;
  if not core.has_permission(v_company, v_perm_key) then
    raise exception 'You cannot revoke a permission you do not hold';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_guard_membership_revoke on core.membership_permissions;
create trigger trg_guard_membership_revoke
  before delete on core.membership_permissions
  for each row execute function core.guard_membership_revoke();

-- UPDATE is not part of normal use (the pair is the PK), but guard it for completeness
-- using the existing INSERT guard (operates on NEW).
drop trigger if exists trg_guard_membership_update on core.membership_permissions;
create trigger trg_guard_membership_update
  before update on core.membership_permissions
  for each row execute function core.guard_membership_grant();
