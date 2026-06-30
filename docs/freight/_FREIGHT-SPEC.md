# TEAL Enterprise — Freight Forwarding Module (Jupiter Logistics) — Canonical Spec

> **Status:** Draft v0.1 — foundation design, pending build.
> **Module key:** `freight` · **Schema:** `freight` · **Route:** `/freight` · **Display name:** "Jupiter Logistics".
> **Companion docs:** `docs/platform-module-framework.md`, `docs/cargo-assurance/_CARGO-SPEC.md` (the structural template this follows), `docs/security-and-permissions.md`, `docs/multi-company-and-intercompany.md`.

This is the canonical reference for the Freight Forwarding module. It encodes the design decisions agreed with the product owner (Andrew Taylor) and is the source of truth the migrations, manifest, seed, and module code mirror. Keep it current as the module evolves.

---

## 1. Identity & guiding decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Module key | `freight` | Reuses the slot already reserved in `core.modules`; intended for this work from the start. |
| Schema | `freight` | One schema per module (platform rule). |
| Route | `/freight` | Standard module route group. |
| Display name | **Jupiter Logistics** | The operating company; display name may be genericised later if another Taylor company forwards freight. |
| Tenancy | **Jupiter Logistics Ltd = its own `core.companies` tenant** with the `freight` module enabled | Clean data isolation; shares platform services (contacts, documents, audit, financial primitives). |
| Email | **Microsoft 365 / Outlook via Microsoft Graph** | Multiple shared mailboxes (3+ addresses, ~5 users) → Graph shared-mailbox + delegated access + real-time webhooks. |
| AI | **Designed-for, not built-yet.** Human performs every step now; AI is a per-step `performed_by` flip later. | See §7. The single most important architectural commitment. |

### First principles (why the data model looks the way it does)
A freight forwarder is **not** the carrier. It **manages information, coordinates people, and solves problems** so cargo moves while every stakeholder stays informed. Therefore the software is built around **coordination, communication, documentation, visibility, and decision support** — not shipment tracking. Every feature must reduce phone calls, emails, repeat data entry, and human error.

**Everything revolves around ONE object: the Shipment (Job).** Every shipment is a digital workspace. Nothing exists outside it; everything links back to it. The shipment is the single source of truth — which is also what makes AI tractable later (§7).

---

## 2. Shipment lifecycle (the state machine)

A shipment advances through ordered stages. Each stage entry **auto-generates tasks, milestones, reminders, and notifications** (§5, §6).

```
lead → rfq → supplier_quoting → customer_quote → customer_approval →
booking_confirmed → cargo_ready → collection → export_clearance →
loaded → departed → in_transit → arrival → import_clearance →
delivery → proof_of_delivery → invoiced → completed → archived
```

Stored as an enum `freight.shipment_stage`. Direction is normally forward but back-steps are allowed (recorded in the activity log). A separate `mode` enum captures `sea_fcl | sea_lcl | air | road | rail | multimodal`, and `direction` captures `import | export | cross_trade`, because these change which tasks/milestones apply.

---

## 3. Data model (schema `freight`)

All business tables carry `company_id uuid not null references core.companies(id) on delete cascade`, `created_at`, `updated_at`, and (where useful) `created_by/updated_by → core.users`. Parent tables expose `unique (company_id, id)` so children reference `(company_id, parent_id)` — structural cross-tenant protection, matching accounting/cargo. RLS per §8.

### 3.1 Core operational object
- **`freight.shipments`** — the Job. Columns: `reference` (per-company human ref, e.g. `JL-2026-00142`, generated like accounting `entry_no`), `stage`, `mode`, `direction`, `incoterm`, `origin_*`, `destination_*`, `commodity`, `description`, `weight_kg`, `volume_m3`, `packages`, `is_dangerous_goods`, `temperature_control`, `carrier_contact_id`, `vessel`, `voyage`, `booking_ref`, `bl_number`, `eta`, `etd`, `ata`, `atd`, `owner_user_id` (responsible operator), `customer_contact_id`, financial rollups (cached), `status` (active/on_hold/cancelled), `opened_at`, `closed_at`.

### 3.2 CRM (shared-aware contacts)
- **`freight.contacts`** — the freight contact book: clients, consignees, shippers, suppliers, shipping lines, airlines, truckers, warehouses, customs brokers, overseas agents, port authorities, government agencies. A contact can hold **multiple roles** (`roles text[]` over a `freight.contact_role` enum), plus `name`, `kind` (org/person), `emails jsonb`, `phones jsonb`, `addresses jsonb`, `country_code`, `credit_limit`, `payment_terms`, `tax_id`, `notes`, `is_active`. (Platform-level `core.clients` remains the shared customer spine; `freight.contacts` is the operational, role-rich freight book that can link to a `core.clients` row where the same entity is a billed customer.)
- **`freight.contact_people`** — multiple named people per contact (name, title, email, phone).
- **`freight.shipment_parties`** — links a contact to a shipment in a role (`role` enum: customer, shipper, consignee, notify, carrier, origin_agent, dest_agent, customs_broker, trucker, warehouse, …). One shipment → many parties.

### 3.3 Quotes (the RFQ pipeline — AI-email centrepiece)
- **`freight.quote_requests`** — an RFQ on a shipment (or standalone enquiry pre-shipment). Status, requested-by, due-by, scope/cargo snapshot.
- **`freight.quote_request_recipients`** — the suppliers/carriers/agents an RFQ was sent to (links `contact_id`), with per-recipient `sent_at`, `responded_at`, `status`.
- **`freight.supplier_quotes`** — a supplier's response: `contact_id`, currency, line items (`jsonb` or child rows), validity, transit time, totals. Multiple per RFQ → comparison.
- **`freight.customer_quotes`** — the quotation issued to the customer, built from supplier quotes + margin. Stores `revision`, currency, totals, margin, `valid_until`, `status` (draft/sent/approved/rejected/expired). All revisions retained.
- **`freight.quote_lines`** — line items for customer/supplier quotes (charge code, description, qty, unit, rate, currency, amount).

### 3.4 Containers / equipment
- **`freight.containers`** — per container: `container_no`, `iso_type`, `size`, `ownership` (SOC/COC), `seal_no`, `status`, `current_location`, `loaded_date`, `discharge_date`, `gate_out_date`, `returned_date`, `free_time_days`, and computed `demurrage_days`, `detention_days`, `storage_days` (see §6). Linked to a shipment.

### 3.5 Milestones & tasks
- **`freight.milestones`** — per shipment: `key` (booked, collected, export_cleared, loaded, departed, arrived, customs_cleared, released, delivered, completed), `planned_at`, `actual_at`, `source` (manual/auto/email/ai). Drives dashboards.
- **`freight.tasks`** — operational tasks: `title`, `description`, `assignee_user_id`, `priority`, `due_at`, `status` (open/doing/blocked/done), `completed_at`, `auto_generated` (bool), `template_key`. Comments/attachments via §3.7/§3.6.
- **`freight.task_comments`** — threaded comments on tasks.

### 3.6 Communication centre
- **`freight.communications`** — every email, phone-call note, WhatsApp note, meeting note, internal comment, timeline entry. Columns: `shipment_id`, `channel` (email/phone/whatsapp/meeting/note/system), `direction` (inbound/outbound/internal), `party_contact_id` (nullable), `subject`, `body`, `occurred_at`, `author_user_id`, `email_message_id` (Graph id for dedup/threading), `mailbox_id`, `related_step` (nullable link to a quote request / task), `ai_generated` (bool). **No communication is ever lost; everything threads to a shipment.**
- **`freight.mailboxes`** — connected Microsoft 365 mailboxes for the company (e.g. `ops@`, `imports@`, `exports@`). Columns: `address`, `display_name`, `graph_user_id`/`shared_mailbox_id`, `subscription_id` (Graph webhook), `subscription_expires_at`, `is_active`. Supports N shared mailboxes, many users.
- **`freight.email_links`** — maps an inbound Graph message to a shipment + the rule that linked it (subject token / sender domain / manual), for auditability and "why did this land here".

### 3.7 Documents (with confidentiality / client-visibility)
Bytes live in the platform's private `documents` Storage bucket (`<company_id>/<doc_id>/<filename>`) with metadata in **`core.documents`** (`owner_module='freight'`); downloads use 1-hour signed URLs. A **`freight.shipment_documents`** row adds freight metadata over each file: `document_id` (→ `core.documents`), `shipment_id`, `doc_type`, **`visibility`**, `title`, `notes`.
- **`doc_type`** enum: quotation, booking_confirmation, commercial_invoice, packing_list, **master_bl**, **house_bl**, air_waybill, arrival_notice, delivery_order, cargo_receipt, proof_of_delivery, certificate, photo, scan, email, other.
- **`visibility`** enum — the confidentiality control the owner stressed: `internal` (never shown/sent to the customer — e.g. **Master B/L carrying our fees, supplier invoices**), `client_visible` (safe to share/attach to client emails — e.g. **House B/L with fees hidden**, arrival notice, POD), `client_on_request` (visible only when explicitly released). **Defaults are type-driven:** `master_bl`/`commercial_invoice`(supplier)→`internal`; `house_bl`/`arrival_notice`/`delivery_order`/`proof_of_delivery`→`client_visible`. The customer portal and any client-facing email **only ever** select `client_visible` docs; `internal` is structurally unreachable to externals. This is enforced in queries AND (for the portal) RLS, never just UI.

### 3.7a Bulk import (CSV)
**`freight.import_batches`** records each import (`entity_type`, `filename`, `row_count`, `success_count`, `error_count`, `errors jsonb`, `status`). First target: **contacts/clients** (migrate the existing client book). Header-mapped CSV → validated rows → `freight.contacts`. The same batch pattern extends to shipments, rates, etc. later. Reuses the spirit of `docs/import-architecture.md`.

### 3.8 Financials (operational, not accounting)
- **`freight.charges`** — both supplier costs and customer charges on a shipment: `kind` (cost/charge), `charge_code`, `description`, `contact_id`, `currency_code`, `amount`, `base_amount`, `fx_rate`, `quote_line_id` (origin), `invoiced` (bool), `invoice_ref`. Profit = Σ charges − Σ costs (cached on the shipment; computed view for per-customer/route rollups). **Does not replace the Accounting module** — integration to `accounting.invoices` is via the Accounting service boundary later (see §9).

### 3.9 AI readiness (built now, dormant)
- **`freight.ai_jobs`** — the seam for §7. Columns: `shipment_id`, `job_type` (draft_rfq, draft_customer_quote, summarise_status, draft_delay_notice, extract_document, **upsert_contact**, **create_shipment**, **set_shipment_party**, **update_shipment_fields**, …), `status` (queued/running/awaiting_approval/done/failed/skipped), `performed_by` (`human`|`ai`), `input jsonb`, `output jsonb`, `prompt_key`, `model`, `approved_by`, `created_at`, `completed_at`. Today rows are created and **completed by humans**; later an AI worker claims them. Flipping `performed_by` per `job_type` is the entire AI rollout for that step.
- **AI write actions (tool surface).** The AI doesn't get raw DB access — it calls the *same* server actions a human uses, exposed as Claude **tools**, each permission-checked and audit-logged: `createContact` / `updateContact` (grow the client/forwarder list from an email), `createShipment` (put a newly-approved job on the tracking page), `updateShipmentFields` (fill in cargo/dates/refs), `setShipmentParty` (attach the customer / forwarder / agent), `addCommunication`, `createTask`, `setMilestone`, `createQuoteRequest`. So "a job got approved by email → add the new client → create the shipment → enter its details → attach the forwarder" is one AI job that calls four tools. Every AI write is gated by `freight.ai.manage` + the underlying action's own permission, and (initially) routed through an `awaiting_approval` review queue before it commits.

### 3.10 Email send queue, container tracking & client notifications (provider-agnostic seams)
Built now as dormant tables so live integration later is config, not a rebuild:
- **`freight.outbound_emails`** — provider-agnostic send queue: `to/cc` (jsonb), `subject`, `body`, `attachment_document_ids` (uuid[] — **only `client_visible` docs may be attached for client emails**, enforced in the send path), `mailbox_id`, `status` (queued/approved/sent/failed/cancelled), `ai_generated`, `approved_by`, `sent_at`. The Microsoft Graph connector (and later the AI) writes here; one sender drains the queue. Decouples "compose" from "send".
- **`freight.tracking_events`** — normalised container/shipment tracking updates from a **third-party tracking aggregator API** (one API that covers CMA CGM, COSCO, Maersk, … instead of scraping each carrier site): `container_id`, `event_type`, `location`, `vessel`, `voyage`, `eta`, `raw jsonb`, `source`, `occurred_at`. A scheduled poller refreshes ETAs; updates feed milestones + the free-time/demurrage engine (§6) and trigger notifications (§6a).
- **`freight.notifications`** — the client-comms engine: `kind` (eta_update, free_time_warning, demurrage_alert, arrival, delivery, custom), `recipient_contact_id`, `channel`, `scheduled_for`, `status`, `outbound_email_id`. This is what proactively emails customers their **ETAs and free-time/demurrage countdowns** — generated from tracking + container free-time, sent via the outbound queue.
- **`freight.prompts`** — editable prompt templates (`key`, `name`, `template`, `variables`, `version`, `is_active`). Owner-editable; no code change to tune AI.

---

## 4. Module surface (navigation / routes)

| Nav | Route | Purpose |
|-----|-------|---------|
| Dashboard | `/freight` | Live operational picture (§4.1). |
| Shipments | `/freight/shipments` | List + the **Shipment Workspace** (`/freight/shipments/[id]`) — single source of truth. |
| Quotes | `/freight/quotes` | RFQ pipeline & customer quotations. |
| Contacts | `/freight/contacts` | Freight CRM. |
| Containers | `/freight/containers` | Equipment & free-time/demurrage watch. |
| Tasks | `/freight/tasks` | Cross-shipment operational task list. |
| Documents | `/freight/documents` | Document library (links to `core.documents`). |
| Settings | `/freight/settings` | Mailboxes, charge codes, prompts (Configuration group). |

### 4.1 Dashboard tiles (target)
Today's urgent work · shipments needing attention · pending quotations · pending customer approvals · bookings awaiting confirmation · upcoming vessel arrivals · container free-time countdown · demurrage/detention risk · outstanding documentation · upcoming customs clearances · deliveries due today · overdue invoices · outstanding supplier bills · revenue & profit stats · recent customer comms · (later) AI recommendations.

### 4.2 Shipment Workspace (the heart)
One screen, tabbed: **Overview** (stage, parties, key dates, financial summary) · Cargo · Parties · Milestones · Tasks · Documents · Communications · Financials · Activity log · (later) AI Assistant. Everything about the job is reachable here without leaving.

---

## 5. Automation rules (stage → tasks/milestones)

On stage change, a server-side function seeds the standard tasks/milestones for the new stage (idempotent, template-driven). Examples:
- `rfq` → tasks: "Obtain supplier quotations"; recipients tracked.
- `customer_quote` → task: "Prepare & send customer quotation".
- `booking_confirmed` → milestone `booked`; tasks: "Arrange trucking", "Confirm cargo ready".
- `collection` → milestone `collected`.
- `export_clearance` → task "Arrange customs clearance"; milestone `export_cleared`.
- `delivery` → task "Issue delivery order"; milestone `delivered`; later "Request proof of delivery".
- `invoiced` → task "Issue invoice"; milestone toward `completed`.

Templates live in code first (`freight/templates.ts`); can move to config later. All auto-tasks set `auto_generated=true`, `template_key=…` so re-runs don't duplicate.

---

## 6. Container free-time / demurrage / detention

Computed (function + cached columns), notified **before** penalties occur:
- **Demurrage** — container at port beyond free time pre-gate-out.
- **Detention** — container out beyond free time pre-return.
- **Storage** — warehouse/CFS storage days.
Each yields estimated penalty (rate table per carrier/contact, configurable) and a dashboard risk tile + task/notification ahead of the deadline. Free-time/demurrage computes from the dates the team enters, so it works today with zero integrations. ETAs come from **direct per-carrier-line connectors** (no paid aggregator — `src/modules/freight/tracking.ts`): where a line's API key is configured the app pulls automatically; for lines without API access (or not yet connected), the workspace offers **one-click deep links to the carrier's own tracking page** (pre-filled with the container number) plus a copy-number button and **manual ETA entry** — the operator reads the ETA on the carrier site and records it back. Universal fallback: track-trace.com.

## 6a. Client notifications (ETAs, free-time, demurrage)
A priority for the owner: proactively email customers their **ETA updates and free-time/demurrage countdowns** instead of fielding calls. Driven by `freight.notifications` → composed (later by AI) → sent via `freight.outbound_emails` through the Graph connector. Notifications are generated from tracking-event ETA changes and from free-time thresholds (e.g. "3 days of free time left on CONTAINERNO"). Always respects document visibility (§3.7) when attaching anything.

---

## 7. AI architecture (the commitment)

**Principle:** a step is a step whether a human or an AI does it. We model every repetitive operational step as a structured job (`freight.ai_jobs`) with typed input → typed output, and store every communication as structured data (§3.6). Because the shipment already holds all context, the AI never needs a special "data feed" — it reads the same records a human reads.

**The email→AI→email loop the owner described == the freight quote workflow:**
```
customer enquiry (inbound email, auto-linked to shipment)
  → AI job draft_rfq: compose supplier/carrier RFQs from the enquiry
  → send to N recipients (freight.quote_request_recipients)
  → inbound supplier replies auto-linked → freight.supplier_quotes
  → AI job draft_customer_quote: compile + apply margin → freight.customer_quotes
  → human approves & sends (later: auto)
```
**Rollout:** every `job_type` starts `performed_by='human'`. To enable AI for one step: provide Anthropic API key (server secret) + a `freight.prompts` template, set that `job_type` to `performed_by='ai'` with an `awaiting_approval` gate. Remove the gate per step once trusted. Claude tool-use lets the worker take actions (create tasks, queue emails, set milestones), not just generate text. AI sits behind one internal interface (vendor-swappable).

**Capabilities targeted (per shipment AI assistant):** summarise status · draft customer/supplier emails · explain delays · identify missing docs · recommend next action · predict risk · compare supplier quotes · explain Incoterms · suggest savings · generate customer updates · answer questions.

---

## 8. Permissions & roles

Permission catalogue (category `freight`), mirrored in `seed.sql` and the manifest:
- `freight.shipments.manage` — create/edit shipments, advance stage.
- `freight.quotes.manage` — RFQs, supplier & customer quotes.
- `freight.contacts.manage` — freight CRM.
- `freight.containers.manage` — equipment & free-time.
- `freight.documents.manage` — upload/generate freight docs.
- `freight.comms.manage` — send/log communications, manage mailboxes.
- `freight.finance.manage` — costs/charges/profitability.
- `freight.reports.view` / `freight.reports.export` — dashboards & reports.
- `freight.ai.manage` — configure prompts / enable AI steps (dormant now).
- `freight.client.view` *(external)* — customer-portal read-only (later).

System roles (seed, `company_id null`, `is_system`): `freight_admin` (all), `freight_ops` (shipments/quotes/contacts/containers/docs/comms/finance + reports), `freight_sales` (quotes/contacts + reports.view), `freight_accounts` (finance + reports), `freight_client_viewer` (external). Super/Company Admin inherit all via the existing cross-join.

RLS follows the standard loop (per `0006_cargo_rls.sql`): SELECT = super admin or active membership; INSERT/UPDATE/DELETE = `core.has_permission(company_id, '<perm>')`, helpers wrapped in scalar sub-selects. Audit trigger (`core.audit_trigger()`) on security-significant tables: `shipments`, `customer_quotes`, `charges`, `mailboxes`, `ai_jobs`, `communications`.

---

## 9. Integration boundaries
- **Accounting:** freight never writes `accounting.*` directly. When a charge is billable, freight calls the (future) Accounting service to raise an invoice and stores the returned reference on `freight.charges.invoice_ref`. Keeps modules independently deployable.
- **Shared services:** `core.companies`, `core.users`, `core.clients`, `core.documents`, `core.audit_logs` are reused, never forked.
- **No cross-module imports** in `src/modules/freight/*` — shared logic goes through `src/core/*`.

---

## 10. Build phases

1. **Foundation — DONE:** schema (0019) + RLS (0020) + functions (0021); manifest + registry + config + seed; module code; UI (dashboard, shipments list/new/**workspace**, contacts, tasks). Dormant `ai_jobs`/`prompts`/`mailboxes` tables.
2. **Quote pipeline — DONE:** RFQ → recipients → supplier-quote comparison → customer quotation (revisions, margin) → post to charges (0022 + quotes UI).
3. **Documents + CSV import — IN PROGRESS:** confidential document store with `client_visible`/`internal` classification (Master vs House B/L); contacts CSV import; dormant `outbound_emails`/`tracking_events`/`notifications` seam tables (0023).
4. **Microsoft 365 email connector:** Graph — multi shared-mailbox, auto-link inbound to shipment/RFQ, send via `outbound_emails`, attach **client-visible** docs, webhook subscription + renewal. *(Needs Azure app + mailbox addresses from owner.)*
5. **Container tracking + client notifications:** integrate a tracking-aggregator API (one API across CMA CGM/COSCO/Maersk/…), poll ETAs → `tracking_events` → free-time/demurrage engine → auto-email customers ETAs & free-time countdowns. *(Needs provider choice/API key.)*
6. **AI activation:** worker + prompts + per-step `performed_by='ai'`, human-approval gates.
7. **Customer portal:** external read-only (track, **client_visible** docs only, approve quotes, invoices).

---

## 11. Open items to confirm later
- Reference format (`JL-YYYY-NNNNN`?) and whether per-company-configurable.
- Charge-code list (standard freight charge codes) — seed defaults vs. company-defined.
- Demurrage/detention rate source (per carrier contract) — table vs. manual.
- Whether `freight.contacts` should fully merge with `core.clients` or stay a linked operational book (currently: linked book).
- Customer-portal scope and auth (reuse cargo `client_access` pattern).
