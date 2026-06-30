-- =============================================================================
-- TEAL Enterprise — Stage-automation + notification regression checks (Phase 4)
-- -----------------------------------------------------------------------------
-- Guards the 0036 re-creation of apply_stage_automation(): every stage must still
-- seed its milestones/tasks (idempotently), and customer-facing stages + ETA
-- changes must enqueue in-app notifications for a customer with portal access.
-- Runs in a transaction and ROLLS BACK. Any failed assertion raises and aborts.
-- =============================================================================
begin;

do $$
declare
  v_company   uuid;
  v_contact   uuid;
  v_user      uuid := gen_random_uuid();
  v_ship      uuid;
  n           int;
begin
  insert into core.users (id, email, full_name, is_super_admin)
    values (v_user, 'stage-test@teal.local', 'Stage Test Portal User', false);
  insert into core.companies (name, base_currency_code) values ('Stage Test Co', 'USD') returning id into v_company;
  insert into freight.contacts (company_id, kind, name) values (v_company, 'organization', 'Stage Customer') returning id into v_contact;
  -- Portal access so customer-facing stages enqueue a notification (in_app default true).
  insert into freight.client_access (company_id, customer_contact_id, user_id, status)
    values (v_company, v_contact, v_user, 'active');

  insert into freight.shipments (company_id, stage, status, customer_contact_id, reference, destination_name)
    values (v_company, 'lead', 'active', v_contact, 'ST-1', 'Port of Spain') returning id into v_ship;

  -- booking_confirmed -> milestone 'booked' + tasks.
  update freight.shipments set stage = 'booking_confirmed' where id = v_ship;
  select count(*) into n from freight.milestones where shipment_id = v_ship and key = 'booked';
  if n <> 1 then raise exception 'stage automation: booked milestone not seeded (got %)', n; end if;
  select count(*) into n from freight.tasks where shipment_id = v_ship and template_key = 'confirm_cargo_ready';
  if n <> 1 then raise exception 'stage automation: confirm_cargo_ready task not seeded (got %)', n; end if;

  -- arrival -> milestone 'arrived' + an in-app 'arrival' notification for the customer.
  update freight.shipments set stage = 'arrival' where id = v_ship;
  select count(*) into n from freight.milestones where shipment_id = v_ship and key = 'arrived';
  if n <> 1 then raise exception 'stage automation: arrived milestone not seeded (got %)', n; end if;
  select count(*) into n from freight.notifications
    where shipment_id = v_ship and kind = 'arrival' and channel = 'system' and recipient_contact_id = v_contact;
  if n <> 1 then raise exception 'notification: arrival not enqueued (got %)', n; end if;

  -- delivery -> milestone 'delivered' + task + 'delivery' notification.
  update freight.shipments set stage = 'delivery' where id = v_ship;
  select count(*) into n from freight.milestones where shipment_id = v_ship and key = 'delivered';
  if n <> 1 then raise exception 'stage automation: delivered milestone not seeded (got %)', n; end if;
  select count(*) into n from freight.tasks where shipment_id = v_ship and template_key = 'issue_delivery_order';
  if n <> 1 then raise exception 'stage automation: issue_delivery_order task not seeded (got %)', n; end if;
  select count(*) into n from freight.notifications
    where shipment_id = v_ship and kind = 'delivery' and channel = 'system' and recipient_contact_id = v_contact;
  if n <> 1 then raise exception 'notification: delivery not enqueued (got %)', n; end if;

  -- completed -> milestone 'completed'.
  update freight.shipments set stage = 'completed' where id = v_ship;
  select count(*) into n from freight.milestones where shipment_id = v_ship and key = 'completed';
  if n <> 1 then raise exception 'stage automation: completed milestone not seeded (got %)', n; end if;

  -- ETA change -> eta_update notification.
  update freight.shipments set eta = current_date + 10 where id = v_ship;
  select count(*) into n from freight.notifications
    where shipment_id = v_ship and kind = 'eta_update' and channel = 'system' and recipient_contact_id = v_contact;
  if n <> 1 then raise exception 'notification: eta_update not enqueued (got %)', n; end if;

  -- Idempotency: re-entering a stage must not duplicate seeds.
  update freight.shipments set stage = 'booking_confirmed' where id = v_ship;
  update freight.shipments set stage = 'arrival' where id = v_ship;
  select count(*) into n from freight.milestones where shipment_id = v_ship and key = 'booked';
  if n <> 1 then raise exception 'stage automation: booked milestone duplicated on re-entry (got %)', n; end if;

  raise notice 'STAGE AUTOMATION + NOTIFICATIONS: all checks passed.';
end $$;

rollback;
