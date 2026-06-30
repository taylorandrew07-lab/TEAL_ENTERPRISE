-- =============================================================================
-- TEAL Enterprise — Migration 0032: external audit round-2 fixes
-- -----------------------------------------------------------------------------
-- F-10  Restore the remaining special accounting SELECT policies that 0025's blanket
--       rewrite flattened: dashboard_configs (per-user) and report_exports
--       (own-export / reports.view), now combined with per-account module access.
-- F-03  Let delegated approvers (users.manage), not only super admins, write
--       user_module_access — so approving an access request actually grants access.
-- F-13  DB-level idempotency for quote->charge posting (unique quote_line_id).
-- F-06  DB-enforced stage gate: a shipment can't advance to delivery/POD/completed
--       while it has an unpaid invoice and cargo isn't released.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- F-10 — restore per-user / report-scoped reads (+ module isolation).
-- -----------------------------------------------------------------------------
drop policy if exists dashboard_configs_sel on accounting.dashboard_configs;
create policy dashboard_configs_sel on accounting.dashboard_configs for select using (
  (select core.is_super_admin())
  or ((select core.can_read(company_id, 'accounting')) and (user_id is null or user_id = auth.uid()))
);

drop policy if exists report_exports_sel on accounting.report_exports;
create policy report_exports_sel on accounting.report_exports for select using (
  (select core.is_super_admin())
  or ((select core.can_read(company_id, 'accounting')) and (generated_by = auth.uid() or (select core.has_permission(company_id, 'reports.view'))))
);

-- -----------------------------------------------------------------------------
-- F-03 — approvers with users.manage can grant/revoke module access.
-- -----------------------------------------------------------------------------
drop policy if exists uma_ins on core.user_module_access;
create policy uma_ins on core.user_module_access for insert with check (
  (select core.is_super_admin()) or (select core.has_permission(company_id, 'users.manage'))
);
drop policy if exists uma_upd on core.user_module_access;
create policy uma_upd on core.user_module_access for update
  using ((select core.is_super_admin()) or (select core.has_permission(company_id, 'users.manage')))
  with check ((select core.is_super_admin()) or (select core.has_permission(company_id, 'users.manage')));
drop policy if exists uma_del on core.user_module_access;
create policy uma_del on core.user_module_access for delete
  using ((select core.is_super_admin()) or (select core.has_permission(company_id, 'users.manage')));

-- -----------------------------------------------------------------------------
-- F-13 — quote->charge idempotency at the DB. Dedupe any existing dupes first.
-- -----------------------------------------------------------------------------
delete from freight.charges c
where c.quote_line_id is not null
  and c.id::text <> (select min(c2.id::text) from freight.charges c2 where c2.quote_line_id = c.quote_line_id);
create unique index if not exists charges_quote_line_uniq
  on freight.charges (quote_line_id) where quote_line_id is not null;

-- -----------------------------------------------------------------------------
-- F-06 — block stage advance to delivery/POD/completed when payment is outstanding
-- and cargo hasn't been released. (Release itself is gated by 0030.) Only bites when
-- billing is being tracked (an invoice_total > 0 exists); untracked shipments flow freely.
-- -----------------------------------------------------------------------------
create or replace function freight.guard_stage_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare b record;
begin
  if new.stage in ('delivery', 'proof_of_delivery', 'completed')
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage) then
    select invoice_total, amount_paid, payment_terms, released into b
    from freight.shipment_billing
    where company_id = new.company_id and shipment_id = new.id;
    if found and b.invoice_total > 0 and not b.released
       and b.payment_terms <> 'open_account'
       and b.amount_paid < b.invoice_total then
      raise exception 'Cannot advance to %: customer payment is outstanding and cargo is not released', new.stage;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_stage_release on freight.shipments;
create trigger trg_guard_stage_release
  before insert or update of stage on freight.shipments
  for each row execute function freight.guard_stage_release();
