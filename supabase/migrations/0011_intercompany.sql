-- =============================================================================
-- TEAL Enterprise — Migration 0011: Inter-company transfers
-- -----------------------------------------------------------------------------
-- Links the two balanced journal entries that record a transfer between two
-- companies of the same group, via Due-from / Due-to control accounts. One row
-- per transfer pairs the originating (from) and destination (to) journal entries
-- so the movement can be traced and, later, eliminated on consolidation.
--
-- v1 is SAME-CURRENCY (both companies share a base currency); multi-currency is
-- a documented follow-up. Additive only; follows the RLS conventions in 0003.
-- =============================================================================

create table core.intercompany_transfers (
  id              uuid primary key default gen_random_uuid(),
  from_company_id uuid not null references core.companies(id) on delete cascade,
  to_company_id   uuid not null references core.companies(id) on delete cascade,
  from_entry_id   uuid references accounting.journal_entries(id),
  to_entry_id     uuid references accounting.journal_entries(id),
  amount          numeric(20,4) not null,
  currency_code   char(3) not null,
  transfer_date   date not null,
  description     text,
  created_by      uuid references core.users(id),
  created_at      timestamptz not null default now(),
  check (from_company_id <> to_company_id)
);

create index on core.intercompany_transfers (from_company_id);
create index on core.intercompany_transfers (to_company_id);

comment on table core.intercompany_transfers is
  'Pairs the two balanced journal entries of an inter-company transfer (Due-from in the source, Due-to in the destination) for tracing and consolidation elimination.';

-- -----------------------------------------------------------------------------
-- RLS. Read when the user belongs to EITHER company (so each side can trace the
-- pairing); write only when the user belongs to BOTH companies — the same
-- condition the action enforces before posting either leg. Super admins bypass.
-- core.user_companies() is wrapped in a scalar sub-select so the planner runs it
-- once per statement, matching the policy style in 0003.
-- -----------------------------------------------------------------------------
alter table core.intercompany_transfers enable row level security;

create policy intercompany_transfers_sel on core.intercompany_transfers for select
  using (
    (select core.is_super_admin())
    or from_company_id in (select core.user_companies())
    or to_company_id in (select core.user_companies())
  );

create policy intercompany_transfers_ins on core.intercompany_transfers for insert
  with check (
    (select core.is_super_admin())
    or (
      from_company_id in (select core.user_companies())
      and to_company_id in (select core.user_companies())
    )
  );

create policy intercompany_transfers_upd on core.intercompany_transfers for update
  using (
    (select core.is_super_admin())
    or (
      from_company_id in (select core.user_companies())
      and to_company_id in (select core.user_companies())
    )
  )
  with check (
    (select core.is_super_admin())
    or (
      from_company_id in (select core.user_companies())
      and to_company_id in (select core.user_companies())
    )
  );

create policy intercompany_transfers_del on core.intercompany_transfers for delete
  using (
    (select core.is_super_admin())
    or (
      from_company_id in (select core.user_companies())
      and to_company_id in (select core.user_companies())
    )
  );

grant select, insert, update, delete on core.intercompany_transfers to authenticated;
