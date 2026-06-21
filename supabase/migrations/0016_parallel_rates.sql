-- =============================================================================
-- TEAL Enterprise — Migration 0016: Private parallel (parallel-market) FX rates
-- -----------------------------------------------------------------------------
-- Trinidad reality: the books run on the official bank USD/TTD rate, but USD is
-- actually transacted at a parallel ("black-market") rate, so the books drift and
-- need periodic correction. This records, PRIVATELY, the official + parallel rate
-- on a date so the spread is visible. Unlike accounting.exchange_rates (which feeds
-- posting and is readable by any member), this table is gated by the new private.view
-- permission — only the owner and whoever they grant it see it.
-- =============================================================================

create table accounting.parallel_rates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  rate_date     date not null,
  from_currency char(3) not null references accounting.currencies(code),
  to_currency   char(3) not null references accounting.currencies(code),
  official_rate numeric(20,10) not null check (official_rate > 0),
  parallel_rate numeric(20,10) not null check (parallel_rate > 0),
  note          text,
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now(),
  check (from_currency <> to_currency)
);
create index on accounting.parallel_rates (company_id, rate_date desc);
comment on table accounting.parallel_rates is
  'PRIVATE management overlay: official vs parallel-market FX rate on a date. Gated by private.view — not part of the statutory books.';

-- RLS: private.view gates BOTH read and write (so it is invisible to ordinary
-- accounting staff, unlike the standard "any member can read" tenant tables).
alter table accounting.parallel_rates enable row level security;
grant select, insert, update, delete on accounting.parallel_rates to authenticated;

create policy parallel_rates_sel on accounting.parallel_rates for select
  using ((select core.has_permission(company_id, 'private.view')));
create policy parallel_rates_ins on accounting.parallel_rates for insert
  with check ((select core.has_permission(company_id, 'private.view')));
create policy parallel_rates_upd on accounting.parallel_rates for update
  using ((select core.has_permission(company_id, 'private.view')))
  with check ((select core.has_permission(company_id, 'private.view')));
create policy parallel_rates_del on accounting.parallel_rates for delete
  using ((select core.has_permission(company_id, 'private.view')));
