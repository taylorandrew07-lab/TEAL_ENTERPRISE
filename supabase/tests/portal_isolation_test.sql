-- =============================================================================
-- TEAL Enterprise — Customer-portal isolation checks (Phase 1)
-- -----------------------------------------------------------------------------
-- Runs entirely in a transaction and ROLLS BACK: creates no persistent data.
-- Apply migrations + seed first, then run via scripts/db-test.mjs. Verifies that
-- an external portal user (a core.users row with a freight.client_access grant but
-- NO company membership):
--   * sees ONLY their own customer's shipments via the portal_* views,
--   * sees ONLY client_visible documents,
--   * canNOT read base freight tables at all (RLS denies — no membership),
--   * loses all access the instant their grant is revoked,
-- and that a user with no client_access sees nothing through the portal.
-- Any failed assertion raises and aborts.
-- =============================================================================
begin;

do $$
declare
  v_company    uuid;
  v_contact_a  uuid;   -- customer A (the portal user's own customer)
  v_contact_b  uuid;   -- customer B (must remain invisible)
  v_ship_a     uuid;
  v_ship_b     uuid;
  v_doc_vis    uuid;   -- core.documents id (client_visible)
  v_doc_int    uuid;   -- core.documents id (internal)
  v_portal_u   uuid := gen_random_uuid();   -- external portal user
  v_stranger   uuid := gen_random_uuid();   -- authed user with no client_access
  v_dbrole     text := current_user;        -- privileged migrate role (to restore after impersonation)
  n            int;
begin
  -- ---- Seed (as the migration role; owner bypasses RLS) -------------------
  insert into core.users (id, email, full_name, is_super_admin)
    values (v_portal_u, 'portal-test@teal.local', 'Portal Customer A', false),
           (v_stranger, 'stranger-test@teal.local', 'No Access', false);

  insert into core.companies (name, base_currency_code)
    values ('Portal Test Co', 'USD') returning id into v_company;

  insert into freight.contacts (company_id, kind, name, roles)
    values (v_company, 'organization', 'Customer A', '{}') returning id into v_contact_a;
  insert into freight.contacts (company_id, kind, name, roles)
    values (v_company, 'organization', 'Customer B', '{}') returning id into v_contact_b;

  insert into freight.shipments (company_id, reference, stage, status, customer_contact_id, total_cost, total_charge, expected_profit)
    values (v_company, 'PT-A-1', 'in_transit', 'active', v_contact_a, 500, 800, 300) returning id into v_ship_a;
  insert into freight.shipments (company_id, reference, stage, status, customer_contact_id)
    values (v_company, 'PT-B-1', 'in_transit', 'active', v_contact_b) returning id into v_ship_b;

  -- A client-visible doc and an internal doc, both on shipment A.
  insert into core.documents (company_id, owner_module, storage_path, filename)
    values (v_company, 'freight', v_company || '/house_bl.pdf', 'house_bl.pdf') returning id into v_doc_vis;
  insert into core.documents (company_id, owner_module, storage_path, filename)
    values (v_company, 'freight', v_company || '/master_bl.pdf', 'master_bl.pdf') returning id into v_doc_int;
  insert into freight.shipment_documents (company_id, shipment_id, document_id, doc_type, visibility, title)
    values (v_company, v_ship_a, v_doc_vis, 'house_bl', 'client_visible', 'House B/L'),
           (v_company, v_ship_a, v_doc_int, 'master_bl', 'internal', 'Master B/L');

  -- A supplier quote (must NEVER be visible) and a sent customer quote (visible).
  insert into freight.supplier_quotes (company_id, shipment_id, contact_id, status, total_amount)
    values (v_company, v_ship_a, v_contact_a, 'received', 450);
  insert into freight.customer_quotes (company_id, shipment_id, status, total_amount, total_cost, margin)
    values (v_company, v_ship_a, 'sent', 800, 500, 300);

  -- Grant portal access: user -> customer A. NO company membership is created.
  insert into freight.client_access (company_id, customer_contact_id, user_id, status)
    values (v_company, v_contact_a, v_portal_u, 'active');

  -- ---- Impersonate the portal user via the JWT claim ----------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_portal_u::text)::text, true);

  -- A) portal_shipments: only customer A's shipment, never B's.
  select count(*) into n from freight.portal_shipments;
  if n <> 1 then raise exception 'portal_shipments expected 1, got %', n; end if;
  select count(*) into n from freight.portal_shipments where id = v_ship_b;
  if n <> 0 then raise exception 'portal_shipments leaked customer B''s shipment'; end if;

  -- B) portal_documents: only the client_visible doc, never the internal one.
  select count(*) into n from freight.portal_documents where shipment_id = v_ship_a;
  if n <> 1 then raise exception 'portal_documents expected 1 client_visible doc, got %', n; end if;
  select count(*) into n from freight.portal_documents where document_id = v_doc_int;
  if n <> 0 then raise exception 'portal_documents leaked an internal document'; end if;

  -- C) portal_quote: the sent customer quote is visible.
  select count(*) into n from freight.portal_quote where shipment_id = v_ship_a;
  if n <> 1 then raise exception 'portal_quote expected 1, got %', n; end if;

  -- D) Base freight tables are denied to the portal user (no membership -> RLS).
  --    Switch to the authenticated role so base-table RLS is actually enforced,
  --    then restore the privileged role (the revoke in step F needs it).
  perform set_config('role', 'authenticated', true);
  select count(*) into n from freight.shipments;
  if n <> 0 then raise exception 'base freight.shipments leaked % rows to a portal user', n; end if;
  select count(*) into n from freight.supplier_quotes;
  if n <> 0 then raise exception 'base freight.supplier_quotes leaked % rows to a portal user', n; end if;
  -- but the curated views still work for them:
  select count(*) into n from freight.portal_shipments;
  if n <> 1 then raise exception 'portal_shipments (as authenticated) expected 1, got %', n; end if;
  perform set_config('role', v_dbrole, true);

  -- E) A stranger (authed, no client_access) sees nothing through the portal.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text)::text, true);
  select count(*) into n from freight.portal_shipments;
  if n <> 0 then raise exception 'portal_shipments visible to a user with no client_access (% rows)', n; end if;

  -- F) Revoking the grant immediately removes all portal visibility.
  perform set_config('request.jwt.claims', json_build_object('sub', v_portal_u::text)::text, true);
  update freight.client_access set status = 'revoked' where user_id = v_portal_u;
  select count(*) into n from freight.portal_shipments;
  if n <> 0 then raise exception 'revoked portal user still sees % shipments', n; end if;

  raise notice 'PORTAL ISOLATION: all checks passed (scoping, doc visibility, base-table denial, revoke).';
end $$;

rollback;
