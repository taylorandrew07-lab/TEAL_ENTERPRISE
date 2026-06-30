-- =============================================================================
-- TEAL Enterprise — Migration 0027: Freight payment tracking & cargo-release gate
-- -----------------------------------------------------------------------------
-- Integration audit P0: nothing tracked client payment or stopped cargo being
-- released unpaid. This adds operational AR at the shipment level — what we billed
-- the client, payments received, and an explicit RELEASE control gated on payment
-- (unless the shipment is on open-account terms). Field names mirror accounting
-- (invoice_total / amount_paid / status) so this can later sync from the Accounting
-- AR module via the service boundary (_FREIGHT-SPEC §9) without reshaping data.
-- Gated by freight.finance.manage. See docs report (payment->release).
-- =============================================================================

-- One billing record per shipment (finance-owned, separate from shipments so it's
-- gated by freight.finance.manage rather than shipments.manage).
create table freight.shipment_billing (
  company_id    uuid not null references core.companies(id) on delete cascade,
  shipment_id   uuid not null,
  invoice_total numeric(20,4) not null default 0,        -- what we billed the customer
  amount_paid   numeric(20,4) not null default 0,        -- cached sum of shipment_payments
  payment_terms text not null default 'prepaid' check (payment_terms in ('prepaid', 'open_account')),
  released      boolean not null default false,          -- cargo / delivery order released
  released_at   timestamptz,
  released_by   uuid references core.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (company_id, shipment_id),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade
);

create table freight.shipment_payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  shipment_id uuid not null,
  amount      numeric(20,4) not null,
  currency_code char(3),
  method      text,                                      -- e.g. wire, cheque, cash
  reference   text,
  paid_at     date,
  recorded_by uuid references core.users(id),
  created_at  timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade
);
create index on freight.shipment_payments (company_id, shipment_id);

create trigger trg_shipment_billing_updated_at
  before update on freight.shipment_billing
  for each row execute function core.set_updated_at();

-- RLS + grants + audit (finance-gated).
grant select, insert, update, delete on all tables in schema freight to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('shipment_billing',  'freight.finance.manage'),
    ('shipment_payments', 'freight.finance.manage')
  ) as t(tbl, perm) loop
    execute format('alter table freight.%I enable row level security', r.tbl);
    -- per-account module isolation (matches 0025): read requires a freight grant
    execute format('create policy %I on freight.%I for select using ((select core.can_read(company_id, %L)))', r.tbl || '_sel', r.tbl, 'freight');
    execute format('create policy %I on freight.%I for insert with check ((select core.has_permission(company_id, %L)))', r.tbl || '_ins', r.tbl, r.perm);
    execute format('create policy %I on freight.%I for update using ((select core.has_permission(company_id, %L))) with check ((select core.has_permission(company_id, %L)))', r.tbl || '_upd', r.tbl, r.perm, r.perm);
    execute format('create policy %I on freight.%I for delete using ((select core.has_permission(company_id, %L)))', r.tbl || '_del', r.tbl, r.perm);
    execute format('create trigger trg_audit after insert or update or delete on freight.%I for each row execute function core.audit_trigger()', r.tbl);
  end loop;
end $$;

