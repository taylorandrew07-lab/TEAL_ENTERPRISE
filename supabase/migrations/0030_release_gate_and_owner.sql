-- =============================================================================
-- TEAL Enterprise — Migration 0030: DB release gate + owner backfill
-- -----------------------------------------------------------------------------
-- F-04  Enforce the cargo-release gate in the DATABASE, not just app code: cargo
--       cannot be released unless paid in full, on open-account terms, or with an
--       explicit recorded override. (App still does the friendly check; this is the
--       backstop against direct API callers.)
-- F-03  Ensure the protected super-admin owner is set even if 0013 ran before any
--       super admin existed (fresh-install bootstrap gap).
-- =============================================================================

-- F-04 — explicit, audited override flag + release-gate trigger.
alter table freight.shipment_billing add column if not exists released_override boolean not null default false;

create or replace function freight.guard_cargo_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only gate the transition INTO released.
  if new.released and not coalesce(old.released, false) then
    if not (new.invoice_total > 0 and new.amount_paid >= new.invoice_total)
       and new.payment_terms <> 'open_account'
       and not new.released_override then
      raise exception 'Cannot release cargo: customer payment outstanding. Record payment, use open-account terms, or set an explicit override.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_cargo_release on freight.shipment_billing;
create trigger trg_guard_cargo_release
  before insert or update on freight.shipment_billing
  for each row execute function freight.guard_cargo_release();

-- F-03 — designate the owner if it was never set (earliest super admin).
update core.platform_settings
  set protected_super_admin_id = (select u.id from core.users u where u.is_super_admin order by u.created_at limit 1),
      updated_at = now()
  where protected_super_admin_id is null;
