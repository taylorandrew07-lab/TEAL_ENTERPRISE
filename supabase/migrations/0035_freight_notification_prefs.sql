-- =============================================================================
-- TEAL Enterprise — Migration 0035: Freight customer notifications — read state,
-- preferences, and the portal read/mark surface.
-- -----------------------------------------------------------------------------
-- Customer Portal, Phase 4 (notifications). The freight.notifications +
-- outbound_emails tables already exist (0023, dormant). This adds: per-notification
-- read state; per-portal-user notification preferences (opt-in); a client-safe
-- portal_notifications view; and SECURITY DEFINER mark-read functions scoped to the
-- signed-in customer. In-app notifications work fully today; emails are queued into
-- outbound_emails and only sent once an email provider (Microsoft 365) is configured.
-- =============================================================================

-- Read state on the existing notifications table.
alter table freight.notifications
  add column read_at timestamptz,
  add column seen_at timestamptz;
create index on freight.notifications (company_id, recipient_contact_id, read_at);

-- Per-portal-user notification preferences. in_app defaults ON (customers always
-- get in-app), email defaults OFF (opt-in). `kinds` selects which event types.
create table freight.notification_preferences (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  customer_contact_id uuid not null,
  user_id             uuid not null references core.users(id) on delete cascade,
  in_app              boolean not null default true,
  email               boolean not null default false,
  kinds               freight.notification_kind[] not null default '{eta_update,arrival,delivery,free_time_warning,demurrage_alert}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (company_id, customer_contact_id) references freight.contacts (company_id, id) on delete cascade,
  unique (customer_contact_id, user_id)
);
create index on freight.notification_preferences (company_id);
create index on freight.notification_preferences (user_id);

create trigger trg_notification_prefs_updated_at
  before update on freight.notification_preferences
  for each row execute function core.set_updated_at();

grant select, insert, update, delete on freight.notification_preferences to authenticated;

alter table freight.notification_preferences enable row level security;
-- Staff visibility (freight module) + the portal user manages ONLY their own row.
create policy notif_prefs_sel on freight.notification_preferences for select
  using ((select core.can_read(company_id, 'freight')));
create policy notif_prefs_self_sel on freight.notification_preferences for select
  using (user_id = auth.uid());
create policy notif_prefs_self_ins on freight.notification_preferences for insert
  with check (user_id = auth.uid() and customer_contact_id in (select freight.user_customer_ids()));
create policy notif_prefs_self_upd on freight.notification_preferences for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and customer_contact_id in (select freight.user_customer_ids()));

-- Client-safe in-app notification feed (channel='system') scoped to the customer.
create view freight.portal_notifications as
select n.id, n.shipment_id, n.kind, n.subject, n.body, n.status, n.created_at, n.read_at
from freight.notifications n
where n.channel = 'system'
  and n.recipient_contact_id in (select freight.user_customer_ids());
grant select on freight.portal_notifications to authenticated;

-- Mark-read: SECURITY DEFINER, scoped so a portal user can only touch their own
-- customer's notifications (avoids a base-table UPDATE policy).
create or replace function freight.portal_mark_notification_read(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update freight.notifications
     set read_at = coalesce(read_at, now()), updated_at = now()
   where id = p_id
     and channel = 'system'
     and recipient_contact_id in (select freight.user_customer_ids());
end;
$$;

create or replace function freight.portal_mark_all_notifications_read()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update freight.notifications
     set read_at = now(), updated_at = now()
   where channel = 'system'
     and read_at is null
     and recipient_contact_id in (select freight.user_customer_ids());
end;
$$;

grant execute on function freight.portal_mark_notification_read(uuid) to authenticated;
grant execute on function freight.portal_mark_all_notifications_read() to authenticated;
