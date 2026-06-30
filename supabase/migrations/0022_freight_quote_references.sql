-- =============================================================================
-- TEAL Enterprise — Migration 0022: Freight quote references
-- -----------------------------------------------------------------------------
-- Human references for RFQs (RFQ-YYYY-NNNNN) and customer quotations
-- (CQ-YYYY-NNNNN), assigned on insert when not supplied. Reuses the
-- concurrency-safe freight.next_reference() counter from 0021.
-- =============================================================================

create or replace function freight.assign_quote_request_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null or new.reference = '' then
    new.reference := freight.next_reference(new.company_id, 'rfq', 'RFQ');
  end if;
  return new;
end;
$$;

create trigger trg_quote_request_reference
  before insert on freight.quote_requests
  for each row execute function freight.assign_quote_request_reference();

create or replace function freight.assign_customer_quote_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null or new.reference = '' then
    new.reference := freight.next_reference(new.company_id, 'customer_quote', 'CQ');
  end if;
  return new;
end;
$$;

create trigger trg_customer_quote_reference
  before insert on freight.customer_quotes
  for each row execute function freight.assign_customer_quote_reference();
