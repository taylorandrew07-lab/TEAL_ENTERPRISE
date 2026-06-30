-- =============================================================================
-- TEAL Enterprise — Migration 0039: dedupe queued customer emails (review P1)
-- -----------------------------------------------------------------------------
-- enqueue_notification (0036) deduped the in-app notification per (shipment, kind,
-- day) but queued the EMAIL unconditionally, so repeated same-day customer-facing
-- events (e.g. several container edits while free time is low, or repeated ETA
-- edits) would enqueue duplicate emails — harmless today (NoopSender, nothing sends)
-- but a guaranteed duplicate-email defect the moment the Microsoft 365 sender lands.
-- This re-creates the function with the email insert guarded by the same per-day
-- idempotency, keyed on the recipient ADDRESS + subject (which encodes the kind, as
-- outbound_emails has no kind column) so distinct recipients/kinds are preserved.
-- =============================================================================
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
      -- One queued email per (shipment, recipient address, subject, day).
      insert into freight.outbound_emails (company_id, shipment_id, to_addresses, subject, body, status)
      select p_company, p_shipment, jsonb_build_array(jsonb_build_object('address', r.email_addr)), p_subject, p_body, 'queued'
      where not exists (
        select 1 from freight.outbound_emails oe
        where oe.shipment_id = p_shipment
          and oe.subject = p_subject
          and oe.to_addresses = jsonb_build_array(jsonb_build_object('address', r.email_addr))
          and oe.created_at::date = now()::date
      );
    end if;
  end loop;

  -- One in-app notification per (shipment, kind, day) for the customer contact.
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
