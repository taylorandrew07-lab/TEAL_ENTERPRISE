-- =============================================================================
-- TEAL Enterprise — Migration 0019: Freight Forwarding schema (Jupiter Logistics)
-- -----------------------------------------------------------------------------
-- The freight module's operational schema. Everything revolves around ONE object,
-- freight.shipments (the Job); every other table links back to it. Multi-tenant:
-- every business table carries company_id and parent tables expose (company_id, id)
-- so children reference (company_id, parent_id) — structural cross-tenant safety,
-- matching accounting (0002) and cargo (0005). RLS in 0020; functions in 0021.
-- AI tables (ai_jobs, prompts) and email tables (mailboxes, email_links) are created
-- now but dormant — the integration seams so AI/email can be switched on without a
-- retrofit. See docs/freight/_FREIGHT-SPEC.md.
-- =============================================================================

create schema if not exists freight;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type freight.shipment_stage as enum (
  'lead','rfq','supplier_quoting','customer_quote','customer_approval',
  'booking_confirmed','cargo_ready','collection','export_clearance','loaded',
  'departed','in_transit','arrival','import_clearance','delivery',
  'proof_of_delivery','invoiced','completed','archived'
);
create type freight.shipment_mode as enum ('sea_fcl','sea_lcl','air','road','rail','multimodal');
create type freight.shipment_direction as enum ('import','export','cross_trade');
create type freight.shipment_status as enum ('active','on_hold','cancelled');

create type freight.contact_kind as enum ('organization','person');
create type freight.contact_role as enum (
  'client','consignee','shipper','supplier','shipping_line','airline','trucker',
  'warehouse','customs_broker','overseas_agent','port_authority','government_agency','other'
);
create type freight.party_role as enum (
  'customer','shipper','consignee','notify','carrier','origin_agent','dest_agent',
  'customs_broker','trucker','warehouse','other'
);

create type freight.quote_request_status as enum ('draft','sent','partial','closed','cancelled');
create type freight.recipient_status as enum ('pending','sent','responded','declined','no_response');
create type freight.supplier_quote_status as enum ('received','shortlisted','selected','rejected','expired');
create type freight.customer_quote_status as enum ('draft','sent','approved','rejected','expired','superseded');

create type freight.container_ownership as enum ('coc','soc');
create type freight.container_status as enum (
  'planned','allocated','loaded','in_transit','discharged','gated_out','returned'
);

create type freight.milestone_key as enum (
  'booked','collected','export_cleared','loaded','departed','arrived',
  'customs_cleared','released','delivered','completed'
);
create type freight.milestone_source as enum ('manual','auto','email','ai');

create type freight.task_status as enum ('open','doing','blocked','done','cancelled');
create type freight.task_priority as enum ('low','normal','high','urgent');

create type freight.comm_channel as enum ('email','phone','whatsapp','meeting','note','system');
create type freight.comm_direction as enum ('inbound','outbound','internal');

create type freight.charge_kind as enum ('cost','charge'); -- cost = supplier cost; charge = customer charge

create type freight.ai_job_status as enum ('queued','running','awaiting_approval','done','failed','skipped');
create type freight.ai_performed_by as enum ('human','ai');

-- -----------------------------------------------------------------------------
-- CRM: contacts (the operational freight book; links to core.clients where billed)
-- -----------------------------------------------------------------------------
create table freight.contacts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  client_id     uuid references core.clients(id) on delete set null, -- shared customer spine, when applicable
  kind          freight.contact_kind not null default 'organization',
  name          text not null,
  roles         freight.contact_role[] not null default '{}',
  emails        jsonb not null default '[]'::jsonb,   -- [{label, address}]
  phones        jsonb not null default '[]'::jsonb,   -- [{label, number}]
  addresses     jsonb not null default '[]'::jsonb,   -- [{label, line1, city, country_code, ...}]
  country_code  char(2),
  tax_id        text,
  credit_limit  numeric(20,4),
  payment_terms text,
  notes         text,
  is_active     boolean not null default true,
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id)
);
create index on freight.contacts (company_id, is_active);
create index on freight.contacts (company_id, name);
create index on freight.contacts using gin (roles);
comment on table freight.contacts is 'Freight CRM: clients, consignees, shippers, carriers, agents, brokers, truckers, authorities. Multi-role via roles[].';

create table freight.contact_people (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  contact_id  uuid not null,
  name        text not null,
  title       text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (company_id, contact_id) references freight.contacts (company_id, id) on delete cascade
);
create index on freight.contact_people (company_id, contact_id);

-- -----------------------------------------------------------------------------
-- The Shipment (Job) — the single source of truth
-- -----------------------------------------------------------------------------
create table freight.shipments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  reference          text,                              -- per-company human ref, e.g. JL-2026-00142 (assigned in 0021)
  stage              freight.shipment_stage not null default 'lead',
  status             freight.shipment_status not null default 'active',
  mode               freight.shipment_mode,
  direction          freight.shipment_direction,
  incoterm           text,
  -- parties (denormalised primary refs for fast list views; full set in shipment_parties)
  customer_contact_id uuid,
  carrier_contact_id  uuid,
  owner_user_id      uuid references core.users(id),    -- responsible operator
  -- origin / destination
  origin_name        text,
  origin_country     char(2),
  destination_name   text,
  destination_country char(2),
  -- cargo
  commodity          text,
  description        text,
  weight_kg          numeric(18,3),
  volume_m3          numeric(18,3),
  packages           integer,
  package_type       text,
  is_dangerous_goods boolean not null default false,
  temperature_control text,
  -- booking
  vessel             text,
  voyage             text,
  booking_ref        text,
  bl_number          text,
  -- dates
  etd                date,
  eta                date,
  atd                date,
  ata                date,
  -- financial rollups (cached; authoritative detail in freight.charges)
  currency_code      char(3),
  total_cost         numeric(20,4) not null default 0,
  total_charge       numeric(20,4) not null default 0,
  expected_profit    numeric(20,4) not null default 0,
  opened_at          timestamptz not null default now(),
  closed_at          timestamptz,
  created_by         uuid references core.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, reference),
  foreign key (company_id, customer_contact_id) references freight.contacts (company_id, id),
  foreign key (company_id, carrier_contact_id)  references freight.contacts (company_id, id)
);
create index on freight.shipments (company_id, stage);
create index on freight.shipments (company_id, status);
create index on freight.shipments (company_id, owner_user_id);
create index on freight.shipments (company_id, eta);
create index on freight.shipments (company_id, created_at desc);
comment on table freight.shipments is 'The Job — every shipment is a digital workspace; everything links back to it.';

create table freight.shipment_parties (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  shipment_id uuid not null,
  contact_id  uuid not null,
  role        freight.party_role not null,
  notes       text,
  created_at  timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  foreign key (company_id, contact_id)  references freight.contacts (company_id, id),
  unique (company_id, shipment_id, contact_id, role)
);
create index on freight.shipment_parties (company_id, shipment_id);
create index on freight.shipment_parties (company_id, contact_id);

-- -----------------------------------------------------------------------------
-- Quotes: RFQ pipeline (the AI-email centrepiece)
-- -----------------------------------------------------------------------------
create table freight.quote_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies(id) on delete cascade,
  shipment_id  uuid,                                    -- nullable: pre-shipment enquiry
  reference    text,
  status       freight.quote_request_status not null default 'draft',
  scope        jsonb not null default '{}'::jsonb,      -- cargo/route snapshot at request time
  due_by       date,
  requested_by uuid references core.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade
);
create index on freight.quote_requests (company_id, shipment_id);
create index on freight.quote_requests (company_id, status);

create table freight.quote_request_recipients (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  quote_request_id uuid not null,
  contact_id       uuid not null,
  status           freight.recipient_status not null default 'pending',
  sent_at          timestamptz,
  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (company_id, quote_request_id) references freight.quote_requests (company_id, id) on delete cascade,
  foreign key (company_id, contact_id)       references freight.contacts (company_id, id),
  unique (company_id, quote_request_id, contact_id)
);
create index on freight.quote_request_recipients (company_id, quote_request_id);

create table freight.supplier_quotes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  quote_request_id uuid,
  shipment_id      uuid,
  contact_id       uuid not null,                       -- the supplier/carrier/agent
  status           freight.supplier_quote_status not null default 'received',
  currency_code    char(3),
  total_amount     numeric(20,4),
  transit_time_days integer,
  valid_until      date,
  notes            text,
  received_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, quote_request_id) references freight.quote_requests (company_id, id) on delete set null,
  foreign key (company_id, shipment_id)      references freight.shipments (company_id, id) on delete cascade,
  foreign key (company_id, contact_id)       references freight.contacts (company_id, id)
);
create index on freight.supplier_quotes (company_id, shipment_id);
create index on freight.supplier_quotes (company_id, quote_request_id);

create table freight.customer_quotes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  shipment_id   uuid not null,
  reference     text,
  revision      integer not null default 1,
  status        freight.customer_quote_status not null default 'draft',
  currency_code char(3),
  total_amount  numeric(20,4) not null default 0,
  total_cost    numeric(20,4) not null default 0,
  margin        numeric(20,4) not null default 0,
  valid_until   date,
  sent_at       timestamptz,
  decided_at    timestamptz,
  notes         text,
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, shipment_id, revision),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade
);
create index on freight.customer_quotes (company_id, shipment_id);
create index on freight.customer_quotes (company_id, status);

create table freight.quote_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  customer_quote_id uuid,
  supplier_quote_id uuid,
  charge_code       text,
  description       text not null,
  quantity          numeric(18,4) not null default 1,
  unit              text,
  rate              numeric(20,4) not null default 0,
  currency_code     char(3),
  amount            numeric(20,4) not null default 0,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  foreign key (company_id, customer_quote_id) references freight.customer_quotes (company_id, id) on delete cascade,
  foreign key (company_id, supplier_quote_id) references freight.supplier_quotes (company_id, id) on delete cascade,
  check (customer_quote_id is not null or supplier_quote_id is not null)
);
create index on freight.quote_lines (company_id, customer_quote_id);
create index on freight.quote_lines (company_id, supplier_quote_id);

-- -----------------------------------------------------------------------------
-- Containers / equipment
-- -----------------------------------------------------------------------------
create table freight.containers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  shipment_id     uuid not null,
  container_no    text,
  iso_type        text,
  size            text,
  ownership       freight.container_ownership not null default 'coc',
  seal_no         text,
  status          freight.container_status not null default 'planned',
  current_location text,
  loaded_date     date,
  discharge_date  date,
  gate_out_date   date,
  returned_date   date,
  free_time_days  integer,
  demurrage_days  integer not null default 0,           -- computed in 0021/app
  detention_days  integer not null default 0,
  storage_days    integer not null default 0,
  est_penalty     numeric(20,4) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade
);
create index on freight.containers (company_id, shipment_id);
create index on freight.containers (company_id, container_no);
create index on freight.containers (company_id, status);

-- -----------------------------------------------------------------------------
-- Milestones & tasks
-- -----------------------------------------------------------------------------
create table freight.milestones (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  shipment_id uuid not null,
  key         freight.milestone_key not null,
  planned_at  timestamptz,
  actual_at   timestamptz,
  source      freight.milestone_source not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  unique (company_id, shipment_id, key)
);
create index on freight.milestones (company_id, shipment_id);

create table freight.tasks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  shipment_id     uuid,
  title           text not null,
  description     text,
  assignee_user_id uuid references core.users(id),
  priority        freight.task_priority not null default 'normal',
  status          freight.task_status not null default 'open',
  due_at          timestamptz,
  completed_at    timestamptz,
  auto_generated  boolean not null default false,
  template_key    text,
  created_by      uuid references core.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  -- prevents duplicate auto-generated tasks for the same template on the same shipment
  unique (company_id, shipment_id, template_key)
);
create index on freight.tasks (company_id, status);
create index on freight.tasks (company_id, assignee_user_id, status);
create index on freight.tasks (company_id, shipment_id);
create index on freight.tasks (company_id, due_at);

create table freight.task_comments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  task_id     uuid not null,
  author_user_id uuid references core.users(id),
  body        text not null,
  created_at  timestamptz not null default now(),
  foreign key (company_id, task_id) references freight.tasks (company_id, id) on delete cascade
);
create index on freight.task_comments (company_id, task_id);

-- -----------------------------------------------------------------------------
-- Communication centre + email (Microsoft Graph) integration tables
-- -----------------------------------------------------------------------------
create table freight.mailboxes (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references core.companies(id) on delete cascade,
  address              text not null,                  -- e.g. ops@jupiterlogistics...
  display_name         text,
  graph_user_id        text,                           -- Graph object id (user or shared mailbox)
  is_shared            boolean not null default true,
  subscription_id      text,                           -- Graph webhook subscription id
  subscription_expires_at timestamptz,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, address)
);
create index on freight.mailboxes (company_id, is_active);

create table freight.communications (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  shipment_id     uuid,
  channel         freight.comm_channel not null,
  direction       freight.comm_direction not null,
  party_contact_id uuid,
  mailbox_id      uuid,
  subject         text,
  body            text,
  occurred_at     timestamptz not null default now(),
  author_user_id  uuid references core.users(id),
  email_message_id text,                               -- Graph message id (dedup/threading)
  email_thread_id  text,
  related_quote_request_id uuid,
  related_task_id uuid,
  ai_generated    boolean not null default false,
  created_at      timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  foreign key (company_id, party_contact_id) references freight.contacts (company_id, id),
  foreign key (company_id, mailbox_id) references freight.mailboxes (company_id, id)
);
create index on freight.communications (company_id, shipment_id, occurred_at desc);
create index on freight.communications (company_id, channel);
create unique index on freight.communications (company_id, email_message_id) where email_message_id is not null;

create table freight.email_links (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  email_message_id text not null,
  shipment_id     uuid,
  mailbox_id      uuid,
  link_rule       text,                                -- 'subject_token' | 'sender_domain' | 'manual' | 'ai'
  linked_by_user_id uuid references core.users(id),
  created_at      timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  foreign key (company_id, mailbox_id)  references freight.mailboxes (company_id, id),
  unique (company_id, email_message_id)
);
create index on freight.email_links (company_id, shipment_id);

-- -----------------------------------------------------------------------------
-- Operational finance (NOT accounting; integrates via Accounting service later)
-- -----------------------------------------------------------------------------
create table freight.charges (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  shipment_id   uuid not null,
  kind          freight.charge_kind not null,          -- cost (supplier) | charge (customer)
  charge_code   text,
  description   text not null,
  contact_id    uuid,                                  -- supplier (for cost) / customer (for charge)
  currency_code char(3),
  amount        numeric(20,4) not null default 0,      -- in currency_code
  fx_rate       numeric(20,8),                         -- to company base, captured at entry
  base_amount   numeric(20,4) not null default 0,      -- amount * fx_rate
  quote_line_id uuid,
  invoiced      boolean not null default false,
  invoice_ref   text,                                  -- reference returned by Accounting service
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade,
  foreign key (company_id, contact_id)  references freight.contacts (company_id, id)
);
create index on freight.charges (company_id, shipment_id);
create index on freight.charges (company_id, kind);
create index on freight.charges (company_id, invoiced);

-- -----------------------------------------------------------------------------
-- AI seams — created now, dormant until AI is switched on. See _FREIGHT-SPEC §7.
-- -----------------------------------------------------------------------------
create table freight.prompts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  key         text not null,                           -- e.g. 'draft_rfq'
  name        text not null,
  template    text not null,
  variables   jsonb not null default '[]'::jsonb,
  version     integer not null default 1,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, key, version)
);
create index on freight.prompts (company_id, key, is_active);

create table freight.ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  shipment_id   uuid,
  job_type      text not null,                         -- draft_rfq, draft_customer_quote, upsert_contact, create_shipment, set_shipment_party, ...
  status        freight.ai_job_status not null default 'queued',
  performed_by  freight.ai_performed_by not null default 'human',
  input         jsonb not null default '{}'::jsonb,
  output        jsonb,
  tool_calls    jsonb,                                 -- record of AI tool actions taken (audit)
  prompt_key    text,
  model         text,
  error         text,
  created_by    uuid references core.users(id),
  approved_by   uuid references core.users(id),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  foreign key (company_id, shipment_id) references freight.shipments (company_id, id) on delete cascade
);
create index on freight.ai_jobs (company_id, status);
create index on freight.ai_jobs (company_id, shipment_id);
create index on freight.ai_jobs (company_id, job_type, status);

-- -----------------------------------------------------------------------------
-- updated_at maintenance (reuses core.set_updated_at from 0001)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'contacts','contact_people','shipments','quote_requests','supplier_quotes',
    'customer_quotes','containers','milestones','tasks','mailboxes','charges',
    'prompts'
  ] loop
    execute format(
      'create trigger trg_%s_updated_at before update on freight.%I for each row execute function core.set_updated_at()',
      t, t);
  end loop;
end $$;
