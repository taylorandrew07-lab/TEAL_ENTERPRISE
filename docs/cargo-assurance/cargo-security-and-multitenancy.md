# Cargo Assurance Security & Multi-Tenancy

**TEAL Enterprise — Cargo Assurance Module**
Owning agent: Cargo Assurance Security & Multi-Tenancy Agent
Status: Draft v1 — 2026-06-20

**Purpose.** This is the definitive security design for the Cargo Assurance module: the five module
roles and the `cargo.*` permission catalogue, the **strict multi-tenant + multi-client isolation**
model, and — the centrepiece — the **client portal access model**, the generalized external-access
pattern that lets an outside Client Administrator/Viewer read **only their own client's published
snapshots** and nothing else. It specifies the exact Postgres mechanisms: the `cargo.client_access`
grant table, concrete additive RLS policies layered on top of (never weakening) tenant isolation,
audit coverage for the whole review lifecycle, and Storage security for source documents.

This document conforms to `_CARGO-SPEC.md` §3 (roles & permissions) and §4 (non-negotiables),
reuses the platform security internals defined authoritatively in
[`../security-and-permissions.md`](../security-and-permissions.md) — its helpers
`core.user_companies()` and `core.has_permission(company_id, key)`, its audit trigger
`core.fn_audit()`, and its Storage convention — and makes concrete the **external/portal access
pattern** that [`../platform-module-framework.md`](../platform-module-framework.md) §7 defers to this
doc. It is authoritative on Cargo Assurance access control. It cross-references the sibling Fuel docs
`cargo-data-model.md`, `cargo-ingestion-and-extraction.md`, `cargo-calculation-engine.md`,
`cargo-aggregation-and-analytics.md`, and the reporting/dashboards doc by filename.

---

## 1. Security posture and the two-axis isolation invariant

The platform's one invariant (`../security-and-permissions.md` §1) is *a user can read or write a row
only for a company they are an active member of, and may write only what their role grants*. Fuel
Assurance inherits that **company axis** unchanged and adds a second, narrower axis that the
Accounting module does not have:

> **Two-axis isolation.** (1) **Tenant axis** — every `cargo.*` row is scoped to one
> `core.companies` tenant (Taylor Engineering) and is reachable only by active members of that
> company, exactly as in Accounting. (2) **Client axis** — within a tenant, the data of one
> `core.clients` record (e.g. ExxonMobil) must never be visible to a user granted access to a
> *different* client (e.g. Shell). The client axis is invisible to internal Taylor users (who legitimately
> see all of their company's clients) and is the *only* axis an external portal user is ever allowed past.

Three design commitments follow, all inherited from the platform and made stricter here:

1. **Isolation lives in Postgres RLS, never in `WHERE company_id = ?` / `WHERE client_id = ?`
   clauses.** A forgotten filter must fail *closed*. RLS is the floor; query filters are an optimisation.
2. **Permissions are data, never code** — `cargo.*` keys are rows in `core.permissions`, evaluated by
   the one `core.has_permission()` function. There is no `if (role === 'ca_admin')` anywhere.
3. **External read access is purely additive and purely read.** The portal policies *widen* `SELECT`
   to one client's published data and do nothing else. They cannot widen tenant access, cannot touch
   any write path, and are written so that removing them only ever *reduces* visibility — they can
   never weaken the tenant wall beneath them.

Everything below serves those three commitments.

---

## 2. Principals: internal users vs external portal users

Cargo Assurance has two populations of human principal, and the security model treats them very
differently.

| | **Internal (Taylor) users** | **External (client portal) users** |
| --- | --- | --- |
| Examples | `ca_admin`, `ca_analyst`, `ca_reviewer` | `ca_client_admin`, `ca_client_viewer` |
| Scoped by | `core.company_memberships` (active membership in Taylor's company) | `cargo.client_access` grant to exactly one `core.clients` row |
| Tenant reach | All clients of their company (the client axis is transparent to them) | **Never** — they have *no* `core.company_memberships` row in Taylor's company |
| Can write? | Per `core.has_permission(company_id, 'cargo.*')` | **No** — read-only, published data only |
| Sees drafts / documents / calcs / exceptions? | Yes (per permission) | **No** — published `review_snapshots` for their client only |
| Auth pool | Supabase Auth | **Same** Supabase Auth pool (§7) |

The two populations share one Supabase Auth pool and one `core.users` table; what separates them is
**which grant table governs their visibility** — `core.company_memberships` for internal,
`cargo.client_access` for external. An internal user is a *member of a company*; an external user is a
*grantee against a client*. A principal is one or the other for Cargo Assurance purposes — never both
(§7.3).

---

## 3. The five module roles

Per `_CARGO-SPEC.md` §3, five roles are seeded. The three internal roles are realised through the
platform RBAC exactly like Accounting's roles — rows in `core.role_permissions` joining the role to
`cargo.*` permission keys — and are assignable to Taylor users via `core.company_memberships`. The two
external roles carry only `cargo.client.view` and exist mainly to label the grant; the *real* gate for
external users is the `cargo.client_access` row, not the role's permission set (§5, §6).

| Role key | Name | Nature | Permission shape |
| --- | --- | --- | --- |
| `ca_admin` | TEAL Cargo Assurance Administrator | Internal — full module control | All `cargo.*` keys for the company, including `cargo.config.manage`, `cargo.assets.manage`, `cargo.reviews.publish`. |
| `ca_analyst` | TEAL Cargo Assurance Analyst | Internal — upload, validate, analyse | `cargo.reviews.manage`, `cargo.documents.upload`, `cargo.extraction.correct`, `cargo.data.review`, `cargo.reports.view/export`. **No** `cargo.reviews.review`/`.publish`. |
| `ca_reviewer` | TEAL Reviewer/Publisher | Internal — approve & publish | `cargo.reviews.review`, `cargo.reviews.publish`, `cargo.data.review`, `cargo.reports.view/export`. The only role that can move a review to `approved`/`published`. |
| `ca_client_admin` | Client Administrator | **External** — read-only + manage own client's viewers | `cargo.client.view` only. Additionally may invite/revoke `ca_client_viewer` grants **for its own client** (§5.4) — an app-level capability gated by its `cargo.client_access` row, never a tenant write. |
| `ca_client_viewer` | Client Viewer | **External** — read-only published dashboards/reports | `cargo.client.view` only. |

These are seeded as **system roles** (`core.roles.company_id = null`, `is_system = true`) so they are
assignable in any company that enables the module, mirroring how Accounting's `accountant`/`view_only`
ship (`../security-and-permissions.md` §7.1). There is **no surveyor role and no surveyor workflow**
in the initial release (`_CARGO-SPEC.md` §3).

A note on separation of duties: `cargo.reviews.publish` is deliberately held **only** by
`ca_reviewer`/`ca_admin`, not `ca_analyst`. The analyst who uploaded, corrected, and excluded the data
cannot also publish the review that interprets it — publication is a distinct, audited reviewer act
(§8), which is what makes a published snapshot defensible (`_CARGO-SPEC.md` §4.7).

---

## 4. The `cargo.*` permission catalogue

Keys follow the platform's `category.resource.action` shape with **category = `cargo`**, seeded into
`core.permissions` and granted to roles in `core.role_permissions` exactly like the Accounting
catalogue (`../security-and-permissions.md` §7.2–7.3). They are the source list the module manifest
mirrors (`../platform-module-framework.md` §5).

| Key | Description | Granted to |
| --- | --- | --- |
| `cargo.reviews.manage` | Create/edit assurance reviews; select client/period/procedure; manage included terminals/vessels/products; create import batches. | admin, analyst |
| `cargo.reviews.review` | Move a review to `in_review`/`reviewed`; resolve exceptions; sign off data quality. | admin, reviewer |
| `cargo.reviews.publish` | Approve and **publish** a review; mint a `review_snapshots` row; generate the client report. | admin, reviewer |
| `cargo.documents.upload` | Upload source documents into a batch; trigger classification/extraction. | admin, analyst |
| `cargo.extraction.correct` | Correct extracted field values (`field_corrections`); never silently alters approved reviews. | admin, analyst |
| `cargo.data.review` | Review/edit loadouts, tank readings, measurements, adjustments; exclude loadouts; resolve `data_exceptions`. | admin, analyst, reviewer |
| `cargo.config.manage` | Manage client procedures, extraction templates, calculation methodologies (versioned config). | admin |
| `cargo.assets.manage` | Manage terminals, vessels, vessel tanks, meters, products. | admin |
| `cargo.reports.view` | View internal review dashboards, analytics, findings (all layers, including drafts). | admin, analyst, reviewer |
| `cargo.reports.export` | Export reports/exhibits (PDF/XLSX) of a review. | admin, analyst, reviewer |
| `cargo.client.view` | **External read-only** of *own client's* published reviews/snapshots only. The gate is the `cargo.client_access` row, not just this key (§6). | ca_client_admin, ca_client_viewer |

Two things to note. First, `cargo.client.view` is intentionally *weak on its own*: holding it grants
nothing without a matching `cargo.client_access` row, because the external read policies (§6) require
the grant, not the permission, to identify *which* client's data is visible. Second, every write key
(`*.manage`, `*.correct`, `*.review`, `*.publish`, `*.upload`) is checked by
`core.has_permission(company_id, key)` inside the RLS `with check` of each table (§5), so a key that is
never granted to external roles can never be exercised by an external principal even if a policy were
misconfigured — defence in depth.

---

## 5. Internal tenant isolation — the write/read pattern for `cargo` tables

Internal Taylor users are scoped **exactly like every other module**: a `cargo` row is readable when
its `company_id ∈ core.user_companies()`, and writable only when the user additionally holds the
relevant `cargo.*` permission in that company via `core.has_permission()`. RLS is enabled **and forced**
on every `cargo` table. Every tenant table — including child/join tables — carries its own `company_id`
(per `cargo-data-model.md`), so each table defends itself rather than relying on a join path
(`../security-and-permissions.md` §9.4).

The pattern is the uniform platform pattern; below are the **representative tables** the brief calls
for, with their exact predicates. (Internal read predicates shown here are *widened* for external
portal users by the additive policies in §6 — never the reverse.)

### 5.1 `cargo.assurance_reviews`

```sql
alter table cargo.assurance_reviews enable row level security;
alter table cargo.assurance_reviews force row level security;

-- READ (internal): any active member of the review's company.
create policy reviews_select_internal on cargo.assurance_reviews
  for select using ( company_id in (select core.user_companies()) );

-- INSERT: must hold cargo.reviews.manage in the destination company.
create policy reviews_insert on cargo.assurance_reviews
  for insert
  with check ( core.has_permission(company_id, 'cargo.reviews.manage') );

-- UPDATE: visible row AND the new row still lands in a company you may manage.
-- (Engine triggers separately forbid editing a published review except via a new snapshot version.)
create policy reviews_update on cargo.assurance_reviews
  for update
  using      ( company_id in (select core.user_companies()) )
  with check ( core.has_permission(company_id, 'cargo.reviews.manage')
            or core.has_permission(company_id, 'cargo.reviews.review')
            or core.has_permission(company_id, 'cargo.reviews.publish') );

-- DELETE: drafts only; gated on manage. Published reviews are never deleted (snapshots are immutable).
create policy reviews_delete on cargo.assurance_reviews
  for delete
  using ( core.has_permission(company_id, 'cargo.reviews.manage') );
```

The transition to `approved`/`published` is performed only through the publish function, which itself
checks `cargo.reviews.publish` before minting a snapshot — RLS decides *who and which company*; the
engine decides *what transitions are legal* (mirrors `../security-and-permissions.md` §9.3).

### 5.2 `cargo.documents`

Source documents are the most sensitive `cargo` rows — they are raw client evidence and are **never
deleted** (`_CARGO-SPEC.md` §4.1). They carry `client_id` as well as `company_id`. They are visible to
internal users by company, writable by holders of `cargo.documents.upload`, and **never** visible to
any external portal user (§6 deliberately does not widen reads to `cargo.documents`).

```sql
alter table cargo.documents enable row level security;
alter table cargo.documents force row level security;

create policy documents_select_internal on cargo.documents
  for select using ( company_id in (select core.user_companies()) );

create policy documents_insert on cargo.documents
  for insert
  with check ( core.has_permission(company_id, 'cargo.documents.upload') );

-- UPDATE only touches extraction/validation status & normalized values; gated on upload/correct.
create policy documents_update on cargo.documents
  for update
  using      ( company_id in (select core.user_companies()) )
  with check ( core.has_permission(company_id, 'cargo.documents.upload')
            or core.has_permission(company_id, 'cargo.extraction.correct') );

-- No delete policy ⇒ no app role may delete a source document (fail closed; spec §4.1).
```

The same shape applies to `cargo.extracted_fields`, `cargo.field_corrections`, `cargo.import_batches`,
`cargo.loadout_documents`, `cargo.extraction_templates`: read by company, write gated on
`cargo.documents.upload`/`cargo.extraction.correct`/`cargo.config.manage` as appropriate. None of these
are ever exposed to external users.

### 5.3 `cargo.loadouts`

```sql
alter table cargo.loadouts enable row level security;
alter table cargo.loadouts force row level security;

create policy loadouts_select_internal on cargo.loadouts
  for select using ( company_id in (select core.user_companies()) );

create policy loadouts_insert on cargo.loadouts
  for insert
  with check ( core.has_permission(company_id, 'cargo.data.review') );

create policy loadouts_update on cargo.loadouts
  for update
  using      ( company_id in (select core.user_companies()) )
  with check ( core.has_permission(company_id, 'cargo.data.review') );

create policy loadouts_delete on cargo.loadouts
  for delete
  using ( core.has_permission(company_id, 'cargo.data.review') );
```

Excluding a loadout (`status = 'excluded'`, `exclusion_reason`) is an `UPDATE` gated on
`cargo.data.review` and audited (§8). The loadout's measurement/result children
(`cargo.loadout_tank_readings`, `cargo.loadout_measurements`, `cargo.loadout_results`,
`cargo.loadout_adjustments`, `cargo.internal_transfers`, `cargo.consumption_records`) each carry
`company_id` and repeat this pattern keyed on `cargo.data.review` — they are never exposed externally.

### 5.4 `cargo.findings`

```sql
alter table cargo.findings enable row level security;
alter table cargo.findings force row level security;

create policy findings_select_internal on cargo.findings
  for select using ( company_id in (select core.user_companies()) );

create policy findings_insert on cargo.findings
  for insert
  with check ( core.has_permission(company_id, 'cargo.data.review')
            or core.has_permission(company_id, 'cargo.reviews.review') );

create policy findings_update on cargo.findings
  for update
  using      ( company_id in (select core.user_companies()) )
  with check ( core.has_permission(company_id, 'cargo.reviews.review') );
```

Draft findings are internal-only. A client never reads `cargo.findings` directly; the **published**
findings reach the client *only* as the frozen `snapshot` payload inside a `cargo.review_snapshots` row
(§6), so a draft, amended, or retracted finding can never leak to the portal.

### 5.5 `cargo.review_snapshots` (the one table the portal can read)

```sql
alter table cargo.review_snapshots enable row level security;
alter table cargo.review_snapshots force row level security;

-- READ (internal): by company, like everything else.
create policy snapshots_select_internal on cargo.review_snapshots
  for select using ( company_id in (select core.user_companies()) );

-- INSERT: minting a snapshot is the act of publishing; gated on cargo.reviews.publish.
create policy snapshots_insert on cargo.review_snapshots
  for insert
  with check ( core.has_permission(company_id, 'cargo.reviews.publish') );

-- NO update / delete policy ⇒ snapshots are immutable once written (reproducibility, spec §4.7).
-- A correction creates a NEW (review_id, version), never mutates an existing snapshot row.
```

`cargo.review_snapshots` is the single table that the external read policies in §6 widen — and only for
*published* snapshots of the grantee's *own* client. The internal policy above is left untouched; §6
adds a **second** `SELECT` policy beside it (PostgreSQL OR-combines permissive policies), so the portal
grant *adds* visibility and the tenant policy continues to stand on its own.

---

## 6. The client portal access model (the generalized external-access pattern)

This is the section `../platform-module-framework.md` §7 defers here, and the reusable pattern future
modules (a claims portal, a survey portal) will copy.

### 6.1 The grant table `cargo.client_access`

An external user's entire visibility is governed by one explicit grant row mapping that user to exactly
**one** `core.clients` record. The grant is the wall; the role label and `cargo.client.view` permission
are advisory.

```sql
create type cargo.client_access_role   as enum ('client_admin','client_viewer');
create type cargo.client_access_status as enum ('active','invited','suspended','revoked');

create table cargo.client_access (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,  -- the OWNING tenant (Taylor)
  client_id   uuid not null references core.clients(id)   on delete cascade,  -- the single client this grant exposes
  user_id     uuid not null references core.users(id)     on delete cascade,  -- = auth.users.id (same Auth pool, §7)
  role        cargo.client_access_role   not null,
  status      cargo.client_access_status not null default 'invited',
  created_by  uuid references core.users(id),                                 -- internal granter or a client_admin
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  unique (client_id, user_id)              -- one grant per (client, user)
);

-- Only ACTIVE grants count, and one user maps to AT MOST ONE client (cross-client isolation, §6.4):
create unique index client_access_one_active_client
  on cargo.client_access (user_id)
  where status = 'active';

create index on cargo.client_access (user_id)   where status = 'active';
create index on cargo.client_access (client_id) where status = 'active';
```

The partial unique index `client_access_one_active_client` enforces the hard rule that **an external
user is bound to a single client**: a person cannot simultaneously hold active portal access to two
clients, which is what makes cross-client leakage structurally impossible for the portal population
(§6.4). `company_id` is denormalised onto the grant so the internal RLS on this table is uniform and so
the client genuinely belongs to the asserting tenant.

### 6.2 The portal helper functions (`security definer`, search-path pinned)

Two helpers encapsulate the external-access rule once, mirroring how `core.user_companies()` /
`core.has_permission()` encapsulate the tenant rule. They are `security definer` (so they can read
`cargo.client_access` and `cargo.assurance_reviews` regardless of the caller's own RLS) and pin
`search_path` to prevent hijacking (`../security-and-permissions.md` §6).

```sql
-- The set of client_ids the CURRENT user may read PUBLISHED data for (external portal access).
-- Empty for internal users and for anyone without an ACTIVE grant — so it can only ever ADD rows.
create or replace function cargo.user_client_access()
returns setof uuid
language sql
stable
security definer
set search_path = fuel, core, pg_temp
as $$
  select ca.client_id
  from cargo.client_access ca
  where ca.user_id = auth.uid()
    and ca.status  = 'active';
$$;

-- True if the current user is an external client_admin for p_client (used for viewer self-management, §6.5).
create or replace function cargo.is_client_admin(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = fuel, core, pg_temp
as $$
  select exists (
    select 1 from cargo.client_access ca
    where ca.user_id   = auth.uid()
      and ca.client_id = p_client
      and ca.role      = 'client_admin'
      and ca.status    = 'active'
  );
$$;
```

Note `cargo.user_client_access()` returns the **empty set** for any internal user (they have no grant
rows) and for any external user without an active grant. Because the external policies below are
permissive `SELECT` policies whose predicate is `... in (select cargo.user_client_access())`, they can
only ever *add* visible rows to someone who holds a grant; they are inert for everyone else and they
touch no write path. This is what "additive, never weakening" means concretely.

### 6.3 Additive RLS: read only the grantee's own *published* snapshots

The portal can read **exactly one thing**: published `review_snapshots` for its granted client. We add
a *second, permissive* `SELECT` policy to `cargo.review_snapshots` (it OR-combines with the internal
policy of §5.5) whose predicate ties three conditions together — the snapshot's client must be one the
user holds an active grant for, **and** the parent review must be in status `published`.

```sql
-- Additive external read: published snapshots of the user's own client only.
create policy snapshots_select_portal on cargo.review_snapshots
  for select using (
    review_id in (
      select r.id
      from cargo.assurance_reviews r
      where r.client_id in (select cargo.user_client_access())   -- the grantee's client only
        and r.status   = 'published'                            -- published reviews only
    )
  );
```

Three guarantees fall out of this single predicate:

- **Client-scoped.** `cargo.user_client_access()` returns only the grantee's `client_id`; a portal user
  granted ExxonMobil can never satisfy the predicate for a Shell snapshot. Cross-client leakage is
  closed at the row level, on top of the one-active-client index (§6.1).
- **Published-only.** A `draft`/`in_review`/`reviewed`/`approved` review yields no rows — a client sees
  a review only once a reviewer has published it. Un-publishing (not a normal action) would instantly
  hide it again on the next query.
- **Snapshot-only.** The portal reaches `cargo.review_snapshots` and **nothing else**. There is *no*
  external policy on `cargo.documents`, `cargo.loadouts`, `cargo.loadout_*`, `cargo.findings`,
  `cargo.data_exceptions`, `cargo.extracted_fields`, `cargo.field_corrections`, calculation tables, or
  any other client's data. Everything the client is allowed to see — the dashboard metrics, the
  published findings text, the report artifact paths — is **inside the frozen `snapshot jsonb`** of the
  snapshot row (assembled at publish time by the reporting layer). The client reads a *document*, not
  the live working data behind it.

The companion `assurance_reviews` widening is minimal and exists only so a portal user can resolve a
snapshot's title/period/client for display; it likewise admits **only published reviews of the
grantee's client**:

```sql
create policy reviews_select_portal on cargo.assurance_reviews
  for select using (
    status    = 'published'
    and client_id in (select cargo.user_client_access())
  );
```

No other `cargo` table receives a portal `SELECT` policy. Because RLS fails closed, the *absence* of a
policy is itself the protection: a portal user querying `cargo.documents` directly via PostgREST gets
zero rows.

### 6.4 Strict cross-client isolation (one client can never see another)

Cross-client isolation is enforced at three independent depths, so a single mistake cannot open it:

1. **Structural** — the `client_access_one_active_client` partial unique index (§6.1) makes it
   impossible for one external user to hold active grants to two clients at once.
2. **Functional** — `cargo.user_client_access()` returns *only* the granted `client_id`(s); the portal
   read predicates filter every candidate row through it.
3. **Data-shape** — the only externally reachable rows are published snapshots whose parent review's
   `client_id` is the grantee's; a snapshot's payload is built from one review of one client, so even
   the JSON the client downloads contains no other client's figures.

Internal users are unaffected by the client axis — they legitimately see all of their company's clients
under the tenant policy — but they too can never *cross the tenant axis*, so Taylor-A's analyst cannot
see Taylor-B's clients either (Taylor runs as a single company here, but the guarantee generalises).

### 6.5 Client-admin self-management of viewers

`ca_client_admin` may invite/revoke `ca_client_viewer` access **for its own client only**. This is the
one "write" an external user can perform, and it is confined to the grant table — it never touches
tenant data. RLS on `cargo.client_access` permits it narrowly:

```sql
alter table cargo.client_access enable row level security;
alter table cargo.client_access force row level security;

-- READ: internal members of the owning company see all grants; an external user sees only their own grant row.
create policy client_access_select on cargo.client_access
  for select using (
        company_id in (select core.user_companies())     -- internal Taylor admins
     or user_id    = auth.uid()                           -- the external user's own row
     or cargo.is_client_admin(client_id)                   -- a client_admin sees its client's grants
  );

-- INSERT: either an internal admin (cargo.config.manage) OR a client_admin granting a VIEWER for its own client.
create policy client_access_insert on cargo.client_access
  for insert
  with check (
        core.has_permission(company_id, 'cargo.config.manage')
     or ( cargo.is_client_admin(client_id) and role = 'client_viewer' )
  );

-- UPDATE (e.g. status → 'suspended'/'revoked'): same gate; a client_admin manages only its own client's viewers.
create policy client_access_update on cargo.client_access
  for update
  using (
        core.has_permission(company_id, 'cargo.config.manage')
     or cargo.is_client_admin(client_id)
  )
  with check (
        core.has_permission(company_id, 'cargo.config.manage')
     or ( cargo.is_client_admin(client_id) and role = 'client_viewer' )
  );

-- No DELETE policy ⇒ grants are revoked by status, never hard-deleted (audit trail preserved).
```

A client_admin **cannot** grant another `client_admin` (the `role = 'client_viewer'` check), cannot
grant access to a different client (`cargo.is_client_admin(client_id)` only passes for its own), and
cannot grant itself anything in Taylor's tenant — it has no `core.company_memberships` row, so every
`core.has_permission(company_id, …)` returns false for it. Escalation is structurally blocked.

---

## 7. Identity: one Auth pool, grant-governed visibility

**Decision (recommended and locked): external client users live in the *same* Supabase Auth pool as
internal users**, with `cargo.client_access` — not membership — governing their visibility. This
resolves the open question in `../platform-module-framework.md` §12 ("default: same pool, access-grant
table + RLS") in favour of the default, and here is the justification.

### 7.1 Why one pool

- **One identity primitive.** `core.users.id = auth.users.id` already holds for everyone
  (`../security-and-permissions.md` §3.1). Keeping external users in the same pool means `auth.uid()`
  in every RLS policy resolves uniformly; the portal helpers (§6.2) and the tenant helpers (§6 of the
  security doc) read the *same* `auth.uid()` with no special-casing. A second pool would fork
  `auth.uid()` semantics and double every policy.
- **Reuse of the whole auth surface.** Password reset, email verification, MFA, OAuth, session
  management, and the `core.handle_new_auth_user()` sync trigger all work for portal users with zero
  new machinery.
- **Isolation does not come from the pool; it comes from the grant.** A shared pool is safe precisely
  because *being in the pool grants nothing*. An external user has **no `core.company_memberships`
  row**, so `core.user_companies()` returns empty and every tenant `SELECT`/write policy yields zero
  rows for them. Their *only* visibility is what `cargo.user_client_access()` adds: published snapshots
  of one client. The pool is the front door; the grant table is the only key that opens any room.

### 7.2 What stops an external user behaving like an internal one

The very thing that scopes internal users — an *active membership* — is absent for external users. The
platform invariant already says membership is the wall (`../security-and-permissions.md` §1); a portal
user simply has no membership, so:

- `core.user_companies()` → ∅ ⇒ no tenant row of any kind is readable.
- `core.has_permission(company_id, anything)` → false ⇒ no write of any kind succeeds.
- The only widening is the additive, read-only, published-only, own-client-only portal policies (§6).

A portal user therefore cannot "see Taylor's side" of anything: not documents, not drafts, not other
clients, not even another *review* of their own client until it is published.

### 7.3 Asserting the active client context for portal users

Internal users assert an **active company** via `app.current_company_id` (`../security-and-permissions.md`
§2.2). Portal users have a parallel, separately-named context: the **active client**, asserted via a
request-local GUC and *verified by the database against the grant table*, never trusted on its own.

```sql
-- Returns the asserted active client ONLY if the user holds an active grant for it; else raises.
create or replace function cargo.current_client_id()
returns uuid
language plpgsql
stable
security definer
set search_path = fuel, core, pg_temp
as $$
declare cid uuid;
begin
  cid := nullif(current_setting('app.current_client_id', true), '')::uuid;
  if cid is null then
    return null;                                  -- no client asserted (e.g. portal landing)
  end if;
  if cid not in (select cargo.user_client_access()) then
    raise exception 'client % not accessible to current user', cid
      using errcode = 'insufficient_privilege';
  end if;
  return cid;
end;
$$;
```

The portal server sets `SET LOCAL app.current_client_id = '<uuid>'` per request (txn-scoped, same
discipline as the company GUC to survive the connection pooler — `../security-and-permissions.md`
§4.3). Because §6's read policies are keyed on `cargo.user_client_access()` (the *grant*, not the GUC),
a forged or stale `app.current_client_id` is inert: it can only ever *narrow* what the grant already
allows, never widen it. The GUC picks the door; the grant is the wall — exactly mirroring the
company-context design.

For an external user the portal **never** sets `app.current_company_id` (they have no company); for an
internal user the module **never** sets `app.current_client_id` (they work across clients). The two
contexts are disjoint, which keeps the two principal populations cleanly separated (§2).

---

## 8. Audit: complete coverage of the review lifecycle

Cargo Assurance writes to the platform's single append-only audit store, `core.audit_logs`, with
**`entity_schema = 'cargo'`** (`../security-and-permissions.md` §8, `_CARGO-SPEC.md` §5). The table is
append-only by RLS (no app `UPDATE`/`DELETE`), readable only by holders of `admin.audit.view` scoped by
company, and written by `security definer` triggers — so the Fuel audit trail is tamper-evident from
the application side, which is what a defensible assurance product requires.

### 8.1 Two complementary mechanisms

1. **Generic table-mutation trigger.** The shared `core.fn_audit()` trigger
   (`../security-and-permissions.md` §8.2) is attached to every state-changing `cargo` table. It
   captures the full before/after row image as `jsonb`, the actor from `auth.uid()`, the action
   (`insert`/`update`/`delete`), `entity_schema = 'cargo'`, `entity_type`, `entity_id`, and `ip`.
   Because every `cargo` tenant table carries `company_id`, the trigger reads it directly for the log's
   `company_id`.

```sql
create trigger trg_audit_fuel_documents
  after insert or update or delete on cargo.documents
  for each row execute function core.fn_audit();

create trigger trg_audit_fuel_field_corrections
  after insert or update or delete on cargo.field_corrections
  for each row execute function core.fn_audit();

create trigger trg_audit_fuel_loadouts
  after insert or update or delete on cargo.loadouts
  for each row execute function core.fn_audit();

create trigger trg_audit_fuel_loadout_measurements
  after insert or update or delete on cargo.loadout_measurements
  for each row execute function core.fn_audit();

create trigger trg_audit_cargo_assurance_reviews
  after insert or update or delete on cargo.assurance_reviews
  for each row execute function core.fn_audit();

create trigger trg_audit_fuel_review_snapshots
  after insert or update or delete on cargo.review_snapshots
  for each row execute function core.fn_audit();

create trigger trg_audit_fuel_findings
  after insert or update or delete on cargo.findings
  for each row execute function core.fn_audit();

create trigger trg_audit_fuel_client_access
  after insert or update or delete on cargo.client_access
  for each row execute function core.fn_audit();
-- ...and likewise: client_procedures, calculation_methodologies, extraction_templates,
--    extracted_fields, loadout_tank_readings, loadout_results, loadout_adjustments,
--    internal_transfers, consumption_records, data_exceptions, import_batches,
--    hire_periods + hire_* children, terminals/vessels/meters/products.
```

2. **Explicit domain-event writes.** Table mutations alone read as low-level diffs. For the business
   narrative that makes a review defensible, the module *additionally* writes an explicit
   `core.audit_logs` row with a **domain `action` verb** at each lifecycle milestone, via a small
   `security definer` helper invoked inside the engine functions that perform these acts:

```sql
create or replace function cargo.log_event(
  p_company uuid, p_action text, p_entity_type text, p_entity_id uuid, p_detail jsonb default null
) returns void
language sql
security definer
set search_path = fuel, core, pg_temp
as $$
  insert into core.audit_logs (company_id, user_id, action, entity_schema, entity_type, entity_id, after, ip)
  values (
    p_company, auth.uid(), p_action, 'cargo', p_entity_type, p_entity_id, p_detail,
    nullif(current_setting('app.request_ip', true), '')::inet
  );
$$;
```

### 8.2 The audited action list

Every consequential Cargo Assurance act is captured. Generic triggers cover the row-level before/after;
the explicit domain verbs below give the business reading:

| Lifecycle act | Domain `action` verb | Captured detail |
| --- | --- | --- |
| Document upload | `cargo.document.uploaded` | batch_id, original_filename, checksum, client_id, uploader (table trigger also records the insert). |
| Classification/extraction | `cargo.document.extracted` | detected_document_type, extraction_status, confidence. |
| Field correction | `cargo.field.corrected` | extracted_field_id, original_value, corrected_value, reason (the `field_corrections` insert is also audited). |
| Loadout exclusion | `cargo.loadout.excluded` | loadout_id, exclusion_reason. |
| Internal transfer / adjustment | `cargo.adjustment.recorded` | loadout_id, type, quantity, supported_by, evidence_document_id. |
| Formula / methodology change | `cargo.methodology.changed` / `cargo.procedure.changed` | methodology/procedure id, version, status (versioned config; historical reviews keep their pinned version). |
| Recalculation | `cargo.review.recalculated` | review_id, methodology_version, procedure_version, trigger. |
| Exception resolution | `cargo.exception.resolved` | exception_id, status, resolution_note. |
| Review state change | `cargo.review.submitted` / `cargo.review.reviewed` / `cargo.review.approved` | review_id, from_status, to_status, approver. |
| Publication | `cargo.review.published` | review_id, snapshot_id, version (the immutable `review_snapshots` insert is also audited). |
| Report generation | `cargo.report.generated` | review_id, snapshot version, report_pdf_path/report_xlsx_path, format. |
| Report export/download | `cargo.report.exported` | review_id, format, by whom. |
| Portal grant change | `cargo.client_access.granted` / `.revoked` | client_id, user_id, role, status, granted_by. |
| Portal snapshot view (optional) | `cargo.snapshot.viewed` | review_id, snapshot version, client_id, viewer — so Taylor can evidence *what the client saw and when*. |

The actor attribution is correct even when a write happens inside a `security definer` engine
function, because `core.fn_audit()` and `cargo.log_event()` both read the *invoker's* `auth.uid()`
(`../security-and-permissions.md` §8.2). Corrections to a *published* review never mutate the published
snapshot; they create a new `(review_id, version)` snapshot, and the chain
`recalculated → reviewed → approved → published(new version)` is fully reconstructable from the log
(`_CARGO-SPEC.md` §4.7).

---

## 9. Storage security for source documents

Source documents live in private Supabase Storage and are registered by `cargo.documents`
(`_CARGO-SPEC.md` §5). They reuse the platform Storage model (`../security-and-permissions.md` §9.5) but
extend the path convention with the **client segment**, because Fuel's isolation has a client axis the
Accounting bucket does not.

### 9.1 Bucket and path strategy

A private bucket (no public URL). Object keys are prefixed by **company then client**, so isolation is
legible in the path itself and enforceable by a Storage RLS predicate:

```
fuel-documents/{company_id}/{client_id}/{review_id}/{document_id}/{original_filename}
```

- The **first** segment is the tenant; the **second** is the client. A leaked or guessed key is
  useless without the right grant on *both* segments.
- The bucket is **never public**; downloads are served only via **short-lived signed URLs** minted
  server-side *after* the relevant RLS check passes.

### 9.2 Storage RLS

Internal access is gated on company membership + the upload permission, exactly like `core.documents`.
**External portal users get no Storage read path at all** for source documents — the only file an
external user may download is the *published report artifact*, whose path is recorded inside the
snapshot JSON and which is served by a separate, snapshot-gated signed-URL flow (§9.3). Source
evidence (certificates, spreadsheets) is never exposed to a client.

```sql
-- Internal read: first path segment is a company you belong to.
create policy fuel_docs_read_internal on storage.objects
  for select using (
    bucket_id = 'fuel-documents'
    and (storage.foldername(name))[1]::uuid in (select core.user_companies())
  );

-- Internal write: upload permission in the company segment.
create policy fuel_docs_write_internal on storage.objects
  for insert with check (
    bucket_id = 'fuel-documents'
    and core.has_permission((storage.foldername(name))[1]::uuid, 'cargo.documents.upload')
  );

-- No external/anon policy on fuel-documents ⇒ portal users cannot read source evidence (fail closed).
```

A defence-in-depth note: even though the path carries `client_id`, the security boundary is the
**membership check on the company segment**, not the path string. The client segment exists for
operational legibility and so that a future per-client signed-URL audit is trivial; it is *not* relied
on as the sole control.

### 9.3 Published report artifacts (the one thing a client downloads)

The published PDF/XLSX referenced by `cargo.review_snapshots.report_pdf_path` / `report_xlsx_path` is
the only file an external user may fetch. The portal download endpoint:

1. Confirms the snapshot is readable to the caller under the §6.3 policy (published, own client).
2. Mints a short-lived signed URL for *that specific artifact path only*.
3. Writes a `cargo.report.exported` / `cargo.snapshot.viewed` audit row (§8).

Storing report artifacts under a client-prefixed path
(`fuel-reports/{company_id}/{client_id}/{review_id}/{version}/...`) keeps the same two-segment
guarantee, and the signed URL is the *only* way a client ever touches Storage.

---

## 10. Threat model

| Threat | Vector | Mitigation |
| --- | --- | --- |
| **Cross-tenant read/write** | App forgets `company_id`; PostgREST endpoint hit directly. | RLS `SELECT`/`with check` on every `cargo` table keyed on `core.user_companies()` / `core.has_permission()` (§5). Fail closed. Inherited unchanged from `../security-and-permissions.md` §9–10. |
| **Cross-client leakage** | A portal user (or a bug) reads another client's published data; or a client_admin grants itself a second client. | Three-deep defence: `client_access_one_active_client` partial unique index (§6.1), `cargo.user_client_access()` filtering every portal read (§6.2–6.3), and snapshot payloads built from one client's review. No `cargo` table other than published snapshots is externally readable (§6.3). |
| **Portal-user escalation** | External user attempts a write, claims a `cargo.*` write key, or tries to read drafts/documents/exceptions. | External users have **no `core.company_memberships`**, so `core.has_permission(company_id, …)` is false for all keys (§7.2). The only widening is read-only, published-only, own-client-only snapshot access (§6.3). `cargo.client.view` grants nothing without a grant row (§4). Client_admin's one write (viewer grants) is confined to `cargo.client_access` and cannot create a `client_admin` or touch another client (§6.5). |
| **Tampering with published snapshots** | Alter or delete a published `review_snapshots` row to change what a client sees retroactively. | `cargo.review_snapshots` has **no UPDATE/DELETE policy** ⇒ immutable to all app roles (§5.5). Corrections create a *new* `(review_id, version)`. All snapshot inserts are audited (§8). Only a DBA with direct DB access could alter history, and that is out of the application threat surface. |
| **Forged/stale active client** | Tampered `app.current_client_id` GUC to view another client. | `cargo.current_client_id()` raises unless the value ∈ `cargo.user_client_access()` (§7.3); and the read policies key on the grant, not the GUC, so a forged GUC can only *narrow*, never widen (§6.3). |
| **Shared Auth pool abuse** | An external user in the same pool tries to act as internal. | Pool membership grants nothing; visibility is grant-governed (§7). No membership ⇒ no tenant rows, no writes (§7.2). |
| **Premature disclosure** | A client sees a review/finding before publication, or a retracted finding leaks. | Portal reads require `status = 'published'` and read *only* the frozen snapshot, never live `cargo.findings`/drafts (§6.3). Un-publishing hides it on the next query. |
| **Source-document exposure** | A client downloads or enumerates raw certificates/spreadsheets. | No external Storage policy on `fuel-documents`; downloads are signed-URL-only after RLS passes; bucket private; company+client-prefixed paths (§9). The only client-fetchable file is the published report artifact (§9.3). |
| **`security definer` hijack** | Search-path manipulation to shadow a portal/audit helper. | Every definer function (`cargo.user_client_access`, `cargo.is_client_admin`, `cargo.current_client_id`, `cargo.log_event`) pins `set search_path = fuel, core, pg_temp` (§6.2, §7.3, §8). |
| **`service_role` key leakage** | Key in a client bundle → full RLS bypass. | Server-only, never shipped to browser or portal; used only for system jobs (extraction pipeline, snapshot assembly), which still pass `company_id`/`client_id` explicitly and are reviewed as privileged. Ordinary internal *and* portal traffic runs as `authenticated` with RLS live (`../security-and-permissions.md` §10.1). |
| **Audit tampering** | Hide an exclusion/correction/publish by editing the log. | `core.audit_logs` append-only via RLS; written by `security definer` triggers/helpers; `cargo` events carry `entity_schema = 'cargo'` (§8). |
| **Connection-pool GUC bleed** | Pooler reuses a session carrying a prior client's GUC. | `SET LOCAL`/txn-scoped config, re-asserted per request; grant check makes any residue inert (§7.3). |

### 10.1 Service-role discipline for the Cargo pipeline

The extraction pipeline and the publish/snapshot-assembly job legitimately run server-side and may use
`service_role` for throughput, but they remain bound by the same rules as the platform
(`../security-and-permissions.md` §10.1): server-only, never in any portal/browser bundle, and they
**must pass `company_id` and `client_id` explicitly** on every write. If serving a *portal* request
ever seems to need `service_role`, that is a design smell — the fix is the correct additive RLS policy
in §6, never the bypass. No human, internal or external, uses `service_role` for day-to-day work.

---

## Open Questions

- **Snapshot view receipts.** Should `cargo.snapshot.viewed` logging (§8.2) be mandatory (so Taylor can
  always evidence exactly what a client saw and when, useful in disputes), or optional to reduce log
  volume? Leaning mandatory for published-report opens, sampled for dashboard reads.
- **Client-admin viewer cap.** Should a `ca_client_admin` be limited in how many `ca_client_viewer`
  grants it may create for its client, or is that a per-client setting in `core.company_modules.settings`?
- **External MFA.** Should portal users (especially `ca_client_admin`) be required to have MFA before a
  grant becomes `active`, mirroring the super-admin MFA question in `../security-and-permissions.md`?
- **Cross-client people.** A real person at a parent group may legitimately need portal access to two
  related clients. The one-active-client index (§6.1) forbids this by design; if the need is real, do
  we model it as two separate Auth identities, or relax to a multi-client grant with the read predicate
  unchanged (it already uses a *set*)? Leaning: keep the index strict; use distinct identities.
- **Report artifact bucket.** One `fuel-reports` bucket vs reusing `fuel-documents` with a
  `published/` prefix — finalize with the Storage section of `../security-and-permissions.md` §9.5.
- **Grant expiry.** Should `cargo.client_access` carry an `expires_at` so portal access auto-suspends at
  a review engagement's end, rather than relying on manual revoke?

## Decisions Locked

- **Two-axis isolation.** Fuel inherits the platform **tenant axis** (`company_id ∈
  core.user_companies()`, writes gated by `core.has_permission(company_id, 'cargo.*')`) unchanged, and
  adds a **client axis** that one client can never cross. RLS is enabled and forced on every `cargo`
  table; absence of a policy means fail-closed. (§1, §5, §6)
- **Five roles, data-driven permissions.** `ca_admin`/`ca_analyst`/`ca_reviewer` are internal,
  membership-scoped; `ca_client_admin`/`ca_client_viewer` are external, grant-scoped. The `cargo.*`
  catalogue is seeded into `core.permissions`; `cargo.reviews.publish` is reviewer-only (separation of
  duties). No hard-coded permissions, ever. (§3, §4)
- **Client portal = explicit grant table + additive read-only RLS.** `cargo.client_access(id,
  company_id, client_id, user_id, role, status, created_at)` maps an external user to **exactly one**
  client (enforced by a partial unique index). External users read **only published
  `review_snapshots`/reviews for their client** via *permissive* policies that OR-combine with — and
  never weaken — tenant policies. No external policy exists on documents, drafts, loadouts,
  calculations, exceptions, findings, or any other client's data. This is the reusable external-portal
  pattern for future modules. (§6)
- **One Supabase Auth pool; visibility governed by the grant, not the pool.** External users share the
  Auth pool and `core.users`, hold **no `core.company_memberships`**, and are scoped solely by
  `cargo.client_access`. The active client is asserted via `app.current_client_id` and **verified** by
  `cargo.current_client_id()` against the grant — GUC narrows, grant gates. (§7)
- **Immutable published snapshots.** `cargo.review_snapshots` has no UPDATE/DELETE policy; corrections
  create a new `(review_id, version)`. Published reports are reproducible. (§5.5, §8)
- **Complete `cargo` audit.** Generic `core.fn_audit()` triggers on every state-changing table plus
  explicit `cargo.log_event()` domain verbs cover upload, extraction, correction, exclusion, adjustment,
  methodology/procedure change, recalculation, exception resolution, review state changes, approval,
  publication, report generation/export, and portal grant changes — all with `entity_schema = 'cargo'`
  into append-only `core.audit_logs`. (§8)
- **Storage: private bucket, `{company_id}/{client_id}/…` paths, signed-URL-only.** Source documents
  are never externally readable; the only file a client downloads is the published report artifact, via
  a snapshot-gated signed URL. (§9)

---

*Cross-references:* [`../security-and-permissions.md`](../security-and-permissions.md) (authoritative
platform security internals — `core.user_companies()`, `core.has_permission()`, `core.fn_audit()`,
Storage, threat model), [`../platform-module-framework.md`](../platform-module-framework.md) (the
external/portal access pattern this doc makes concrete; §7, §12), [`_CARGO-SPEC.md`](_CARGO-SPEC.md)
(roles §3, non-negotiables §4, canonical schema §6). Sibling Fuel docs: `cargo-data-model.md` (column
shapes and the `company_id`/`client_id` carried on every table these policies key on),
`cargo-ingestion-and-extraction.md` (the upload/extraction acts audited in §8), `cargo-calculation-engine.md`
(the versioned methodology/procedure changes and recalculations audited here), and the
reporting/dashboards doc (assembles the immutable `review_snapshots.snapshot` payload the portal reads).
