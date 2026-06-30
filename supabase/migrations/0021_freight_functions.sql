-- =============================================================================
-- TEAL Enterprise — Migration 0021: Freight functions, automation & reference no.
-- -----------------------------------------------------------------------------
-- (1) Per-company, per-year human references (JL-YYYY-NNNNN) assigned on insert,
--     concurrency-safe via an upsert counter (row lock on conflict).
-- (2) Stage automation: advancing a shipment's stage idempotently seeds the
--     standard milestones and operational tasks for that stage (_FREIGHT-SPEC §5).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reference counters (touched only through the SECURITY DEFINER generator below).
-- RLS on, no policies → authenticated cannot read/write directly; the definer
-- function (owned by postgres) bypasses RLS to allocate numbers atomically.
-- -----------------------------------------------------------------------------
create table freight.reference_counters (
  company_id uuid not null references core.companies(id) on delete cascade,
  scope      text not null,
  year       integer not null,
  last_no    integer not null default 0,
  primary key (company_id, scope, year)
);
alter table freight.reference_counters enable row level security;

create or replace function freight.next_reference(p_company uuid, p_scope text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from now())::int;
  v_no   integer;
begin
  insert into freight.reference_counters (company_id, scope, year, last_no)
  values (p_company, p_scope, v_year, 1)
  on conflict (company_id, scope, year)
    do update set last_no = freight.reference_counters.last_no + 1
  returning last_no into v_no;

  return p_prefix || '-' || v_year::text || '-' || lpad(v_no::text, 5, '0');
end;
$$;

-- Assign shipments.reference on insert when not supplied. Prefix 'JL' (Jupiter
-- Logistics); can be made per-company-configurable later (see _FREIGHT-SPEC §11).
create or replace function freight.assign_shipment_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null or new.reference = '' then
    new.reference := freight.next_reference(new.company_id, 'shipment', 'JL');
  end if;
  return new;
end;
$$;

create trigger trg_shipment_reference
  before insert on freight.shipments
  for each row execute function freight.assign_shipment_reference();

-- -----------------------------------------------------------------------------
-- Stage automation. On stage entry, seed the standard milestone + tasks for that
-- stage. Idempotent: tasks de-dupe on (company_id, shipment_id, template_key) and
-- milestones on (company_id, shipment_id, key), so re-entering a stage is safe.
-- -----------------------------------------------------------------------------
create or replace function freight.seed_task(
  p_company uuid, p_shipment uuid, p_template text, p_title text, p_priority freight.task_priority
) returns void
language plpgsql
as $$
begin
  insert into freight.tasks (company_id, shipment_id, title, priority, auto_generated, template_key)
  values (p_company, p_shipment, p_title, p_priority, true, p_template)
  on conflict (company_id, shipment_id, template_key) do nothing;
end;
$$;

create or replace function freight.seed_milestone(
  p_company uuid, p_shipment uuid, p_key freight.milestone_key
) returns void
language plpgsql
as $$
begin
  insert into freight.milestones (company_id, shipment_id, key, source)
  values (p_company, p_shipment, p_key, 'auto')
  on conflict (company_id, shipment_id, key) do nothing;
end;
$$;

create or replace function freight.apply_stage_automation()
returns trigger
language plpgsql
as $$
declare
  c uuid := new.company_id;
  s uuid := new.id;
begin
  case new.stage
    when 'rfq' then
      perform freight.seed_task(c, s, 'obtain_supplier_quotes', 'Obtain supplier quotations', 'high');
    when 'customer_quote' then
      perform freight.seed_task(c, s, 'prepare_customer_quote', 'Prepare & send customer quotation', 'high');
    when 'booking_confirmed' then
      perform freight.seed_milestone(c, s, 'booked');
      perform freight.seed_task(c, s, 'confirm_cargo_ready', 'Confirm cargo ready date', 'normal');
      perform freight.seed_task(c, s, 'arrange_trucking', 'Arrange trucking / collection', 'normal');
    when 'cargo_ready' then
      perform freight.seed_task(c, s, 'arrange_collection', 'Coordinate collection', 'normal');
    when 'collection' then
      perform freight.seed_milestone(c, s, 'collected');
    when 'export_clearance' then
      perform freight.seed_task(c, s, 'arrange_customs_export', 'Arrange export customs clearance', 'high');
      perform freight.seed_milestone(c, s, 'export_cleared');
    when 'loaded' then
      perform freight.seed_milestone(c, s, 'loaded');
    when 'departed' then
      perform freight.seed_milestone(c, s, 'departed');
    when 'arrival' then
      perform freight.seed_milestone(c, s, 'arrived');
    when 'import_clearance' then
      perform freight.seed_task(c, s, 'arrange_customs_import', 'Arrange import customs clearance', 'high');
      perform freight.seed_milestone(c, s, 'customs_cleared');
    when 'delivery' then
      perform freight.seed_task(c, s, 'issue_delivery_order', 'Issue delivery order', 'high');
      perform freight.seed_milestone(c, s, 'delivered');
    when 'proof_of_delivery' then
      perform freight.seed_task(c, s, 'request_pod', 'Request proof of delivery', 'normal');
      perform freight.seed_milestone(c, s, 'released');
    when 'invoiced' then
      perform freight.seed_task(c, s, 'issue_invoice', 'Issue customer invoice', 'high');
    when 'completed' then
      perform freight.seed_milestone(c, s, 'completed');
    else
      null;
  end case;
  return new;
end;
$$;

-- Fires on insert and on any update that touches `stage` (the `of stage` clause).
-- Re-entering the same stage is harmless: seed_task/seed_milestone are idempotent
-- (on conflict do nothing). `tg_op` is NOT valid in a trigger WHEN clause — the
-- guard belongs inside the function, and idempotency makes it unnecessary here.
create trigger trg_shipment_stage_automation
  after insert or update of stage on freight.shipments
  for each row
  execute function freight.apply_stage_automation();
