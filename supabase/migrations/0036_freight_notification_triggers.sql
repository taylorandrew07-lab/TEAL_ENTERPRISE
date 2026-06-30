-- =============================================================================
-- TEAL Enterprise — Migration 0036: Freight customer-notification generation
-- -----------------------------------------------------------------------------
-- Generates freight.notifications (in-app) + freight.outbound_emails (queued for a
-- later provider) on customer-facing shipment events: stage -> arrival/delivery,
-- ETA change, and container free-time/demurrage thresholds. Respects each portal
-- user's notification_preferences (0035); idempotent per (shipment, kind, day).
-- Re-creates apply_stage_automation() with its 0021 body VERBATIM plus the new
-- enqueue calls (the trigger binds by name, so re-create is safe).
-- =============================================================================

-- Fan a customer-facing event out to the customer's active portal users, honouring
-- their preferences. SECURITY DEFINER so it can read prefs + resolve emails.
create or replace function freight.enqueue_notification(
  p_company uuid, p_shipment uuid, p_kind freight.notification_kind, p_subject text, p_body text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contact uuid;
  v_any_in_app boolean := false;
  r record;
begin
  if p_shipment is null then return; end if;
  select customer_contact_id into v_contact from freight.shipments where id = p_shipment;
  if v_contact is null then return; end if;

  for r in
    select ca.user_id,
           coalesce(p.in_app, true)  as in_app,
           coalesce(p.email, false)  as email,
           coalesce(p.kinds, array['eta_update','arrival','delivery','free_time_warning','demurrage_alert']::freight.notification_kind[]) as kinds,
           (select u.email from core.users u where u.id = ca.user_id) as email_addr
    from freight.client_access ca
    left join freight.notification_preferences p
      on p.user_id = ca.user_id and p.customer_contact_id = ca.customer_contact_id
    where ca.customer_contact_id = v_contact and ca.status = 'active'
  loop
    if not (p_kind = any(r.kinds)) then
      continue;
    end if;
    if r.in_app then v_any_in_app := true; end if;
    if r.email and r.email_addr is not null then
      insert into freight.outbound_emails (company_id, shipment_id, to_addresses, subject, body, status)
      values (p_company, p_shipment, jsonb_build_array(jsonb_build_object('address', r.email_addr)), p_subject, p_body, 'queued');
    end if;
  end loop;

  -- One in-app notification per (shipment, kind, day) for the customer contact,
  -- shown to all that customer's portal users via portal_notifications.
  if v_any_in_app then
    insert into freight.notifications (company_id, shipment_id, kind, channel, recipient_contact_id, subject, body, status, sent_at)
    select p_company, p_shipment, p_kind, 'system', v_contact, p_subject, p_body, 'sent', now()
    where not exists (
      select 1 from freight.notifications n
      where n.shipment_id = p_shipment and n.kind = p_kind and n.channel = 'system'
        and n.recipient_contact_id = v_contact and n.created_at::date = now()::date
    );
  end if;
end;
$$;

-- Re-create stage automation: 0021 body VERBATIM + enqueue on customer-facing stages.
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
      perform freight.enqueue_notification(c, s, 'arrival',
        'Your shipment ' || coalesce(new.reference, '') || ' has arrived',
        'Your shipment has arrived at ' || coalesce(new.destination_name, 'destination') || '. We will be in touch about clearance and delivery.');
    when 'import_clearance' then
      perform freight.seed_task(c, s, 'arrange_customs_import', 'Arrange import customs clearance', 'high');
      perform freight.seed_milestone(c, s, 'customs_cleared');
    when 'delivery' then
      perform freight.seed_task(c, s, 'issue_delivery_order', 'Issue delivery order', 'high');
      perform freight.seed_milestone(c, s, 'delivered');
      perform freight.enqueue_notification(c, s, 'delivery',
        'Your shipment ' || coalesce(new.reference, '') || ' is out for delivery',
        'Your shipment is being delivered. Please have someone available to receive it.');
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

-- ETA changes -> notify the customer.
create or replace function freight.notify_eta_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.eta is distinct from old.eta and new.eta is not null then
    perform freight.enqueue_notification(new.company_id, new.id, 'eta_update',
      'Updated ETA for ' || coalesce(new.reference, 'your shipment'),
      'The estimated arrival date is now ' || to_char(new.eta, 'DD Mon YYYY') || '.');
  end if;
  return new;
end;
$$;
create trigger trg_shipment_eta_notify
  after update of eta on freight.shipments
  for each row execute function freight.notify_eta_change();

-- Free-time / demurrage thresholds on containers -> notify the customer.
create or replace function freight.notify_free_time()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_remaining integer;
begin
  if new.returned_date is not null or new.gate_out_date is not null then
    return new;
  end if;
  if new.discharge_date is not null and new.free_time_days is not null then
    v_remaining := new.free_time_days - (current_date - new.discharge_date);
    if v_remaining < 0 then
      perform freight.enqueue_notification(new.company_id, new.shipment_id, 'demurrage_alert',
        'Demurrage accruing on container ' || coalesce(new.container_no, ''),
        'Free time on your container has expired and demurrage charges are now accruing. Please arrange collection urgently.');
    elsif v_remaining <= 3 then
      perform freight.enqueue_notification(new.company_id, new.shipment_id, 'free_time_warning',
        'Free time ending on container ' || coalesce(new.container_no, ''),
        v_remaining::text || ' day(s) of free time remain on your container. Please arrange collection to avoid demurrage charges.');
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_container_free_time_notify
  after update of discharge_date, gate_out_date, free_time_days on freight.containers
  for each row execute function freight.notify_free_time();
