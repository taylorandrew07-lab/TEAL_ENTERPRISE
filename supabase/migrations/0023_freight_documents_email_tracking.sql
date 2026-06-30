-- =============================================================================
-- TEAL Enterprise — Migration 0023: Freight documents (with confidentiality),
-- email send queue, container tracking events, client notifications, CSV imports.
-- -----------------------------------------------------------------------------
-- Document bytes stay in core.documents + the private 'documents' Storage bucket
-- (0017). freight.shipment_documents adds freight metadata, crucially a VISIBILITY
-- classification so confidential docs (e.g. Master B/L carrying our fees) are never
-- exposed to customers while client-safe docs (e.g. House B/L) can be shared.
-- The outbound_emails / tracking_events / notifications tables are provider-agnostic
-- seams: created now, switched on when the Microsoft 365 + tracking-aggregator
-- integrations are configured. See docs/freight/_FREIGHT-SPEC.md §3.7, §3.10, §6a.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documents
-- -----------------------------------------------------------------------------
create type freight.doc_type as enum (
  'quotation','booking_confirmation','commercial_invoice','packing_list',
  'master_bl','house_bl','air_waybill','arrival_notice','delivery_order',
  'cargo_receipt','proof_of_delivery','certificate','photo','scan','email','other'
);
-- internal       = never shown/sent to the customer (e.g. Master B/L with our fees)
-- client_visible = safe to share / attach to client emails (e.g. House B/L)
-- client_on_request = released to the customer only on explicit action
create type freight.doc_visibility as enum ('internal','client_visible','client_on_request');

create table freight.shipment_documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies(id) on delete cascade,
  shipment_id  uuid not null,
  document_id  uuid not null references core.documents(id) on delete cascade,
  doc_type     freight.doc_type not null default 'other',
  visibility   freight.doc_visibility not null default 'internal',
  title        text,
  notes        text,
  uploaded_by  uuid references core.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade
);
create index on freight.shipment_documents (company_id, shipment_id);
create index on freight.shipment_documents (company_id, doc_type);
create index on freight.shipment_documents (company_id, visibility);
comment on column freight.shipment_documents.visibility is 'Confidentiality control: internal docs are structurally unreachable to customers; only client_visible may be attached to client emails / shown in the portal.';

-- -----------------------------------------------------------------------------
-- Outbound email queue (provider-agnostic; Microsoft Graph drains it later)
-- -----------------------------------------------------------------------------
create type freight.outbound_email_status as enum ('queued','approved','sent','failed','cancelled');

create table freight.outbound_emails (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references core.companies(id) on delete cascade,
  shipment_id           uuid,
  mailbox_id            uuid,
  to_addresses          jsonb not null default '[]'::jsonb,  -- [{name?, address}]
  cc_addresses          jsonb not null default '[]'::jsonb,
  subject               text,
  body                  text,
  attachment_document_ids uuid[] not null default '{}',      -- core.documents ids; client emails => client_visible only
  status                freight.outbound_email_status not null default 'queued',
  ai_generated          boolean not null default false,
  related_quote_id      uuid,
  error                 text,
  created_by            uuid references core.users(id),
  approved_by           uuid references core.users(id),
  sent_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  foreign key (company_id, mailbox_id)  references freight.mailboxes (company_id, id)
);
create index on freight.outbound_emails (company_id, status);
create index on freight.outbound_emails (company_id, shipment_id);

-- -----------------------------------------------------------------------------
-- Container tracking events (from a third-party tracking aggregator API)
-- -----------------------------------------------------------------------------
-- Containers (0019) need (company_id, id) exposed BEFORE the composite FK below.
alter table freight.containers add constraint freight_containers_company_id_id_key unique (company_id, id);

create table freight.tracking_events (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies(id) on delete cascade,
  container_id uuid,
  shipment_id  uuid,
  source       text,                                  -- aggregator/provider key
  event_type   text,                                  -- gate_out, loaded, departed, discharged, ...
  location     text,
  vessel       text,
  voyage       text,
  eta          timestamptz,
  raw          jsonb,
  occurred_at  timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (company_id, container_id) references freight.containers (company_id, id) on delete cascade,
  foreign key (company_id, shipment_id)  references freight.shipments (company_id, id) on delete cascade
);
create index on freight.tracking_events (company_id, container_id, occurred_at desc);
create index on freight.tracking_events (company_id, shipment_id);

-- -----------------------------------------------------------------------------
-- Client notifications (ETAs, free-time, demurrage)
-- -----------------------------------------------------------------------------
create type freight.notification_kind as enum ('eta_update','free_time_warning','demurrage_alert','arrival','delivery','custom');
create type freight.notification_channel as enum ('email','system');
create type freight.notification_status as enum ('pending','scheduled','sent','failed','cancelled');

create table freight.notifications (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  shipment_id        uuid,
  kind               freight.notification_kind not null,
  channel            freight.notification_channel not null default 'email',
  recipient_contact_id uuid,
  subject            text,
  body               text,
  status             freight.notification_status not null default 'pending',
  scheduled_for      timestamptz,
  sent_at            timestamptz,
  outbound_email_id  uuid references freight.outbound_emails(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  foreign key (company_id, recipient_contact_id) references freight.contacts (company_id, id)
);
create index on freight.notifications (company_id, status);
create index on freight.notifications (company_id, shipment_id);

-- -----------------------------------------------------------------------------
-- CSV import batches (first target: contacts/clients)
-- -----------------------------------------------------------------------------
create type freight.import_status as enum ('completed','partial','failed');

create table freight.import_batches (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  entity_type   text not null,                         -- 'contacts', later 'shipments', ...
  filename      text,
  row_count     integer not null default 0,
  success_count integer not null default 0,
  error_count   integer not null default 0,
  errors        jsonb not null default '[]'::jsonb,
  status        freight.import_status not null default 'completed',
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now()
);
create index on freight.import_batches (company_id, entity_type, created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['shipment_documents','outbound_emails','notifications'] loop
    execute format('create trigger trg_%s_updated_at before update on freight.%I for each row execute function core.set_updated_at()', t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS + grants + audit
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema freight to authenticated;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('shipment_documents', 'freight.documents.manage'),
      ('outbound_emails',    'freight.comms.manage'),
      ('tracking_events',    'freight.containers.manage'),
      ('notifications',      'freight.comms.manage'),
      ('import_batches',     'freight.contacts.manage')
    ) as t(tbl, perm)
  loop
    execute format('alter table freight.%I enable row level security', r.tbl);
    execute format('create policy %I on freight.%I for select using ((select core.is_super_admin()) or company_id in (select core.user_companies()))', r.tbl || '_sel', r.tbl);
    execute format('create policy %I on freight.%I for insert with check ((select core.has_permission(company_id, %L)))', r.tbl || '_ins', r.tbl, r.perm);
    execute format('create policy %I on freight.%I for update using ((select core.has_permission(company_id, %L))) with check ((select core.has_permission(company_id, %L)))', r.tbl || '_upd', r.tbl, r.perm, r.perm);
    execute format('create policy %I on freight.%I for delete using ((select core.has_permission(company_id, %L)))', r.tbl || '_del', r.tbl, r.perm);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['shipment_documents','outbound_emails','notifications'] loop
    execute format('create trigger trg_audit after insert or update or delete on freight.%I for each row execute function core.audit_trigger()', t);
  end loop;
end $$;
