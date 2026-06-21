# Security & Permissions

**TEAL Enterprise — Accounting Module**
Owning agent: Multi-Company / Security Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This is the definitive design reference for multi-tenant isolation, authentication, role-based access control, Row Level Security, audit logging, and the platform threat model for TEAL Enterprise. It specifies how every request is scoped to exactly one company, how data-driven permissions gate writes, and the concrete Postgres mechanisms — `security definer` helpers, RLS policies, and audit triggers — that enforce all of it inside the database rather than in application code.

This document conforms to `_ARCHITECTURE-SPEC.md` and is authoritative on platform security internals. It cross-references the spec throughout (schema names §5, RBAC §7, non-negotiables §10) and sits alongside `accounting-engine.md`, whose posting/period functions run *inside* the tenant boundary defined here.

---

## 1. Scope and the security posture

The platform exists to run the books for **many legally distinct companies** in the Taylor group, on **one database**, accessed by **users who legitimately belong to several of those companies at once** — often with a different role in each. The one security invariant that governs everything below:

> **A user can read or write a row only for a company they are an `active` member of, and may write only what their role in *that* company grants. No application bug can leak data across the tenant boundary, because the boundary is enforced by the database, not the application.**

Two design commitments follow directly from `_ARCHITECTURE-SPEC.md` §10 ("No single-company assumptions", "No hard-coded permissions") and §4 ("RLS enabled on every table"):

1. **Tenant isolation lives in Postgres RLS, not in `WHERE company_id = ?` clauses written by developers.** A forgotten filter must fail *closed* (return nothing), never *open* (leak another company's ledger). RLS is the floor; query filters are an optimisation on top of it.
2. **Permissions are data, never code.** There is no `if (user.role === 'admin')` anywhere. Access is decided by rows in `core.role_permissions`, evaluated by one SQL function. New permissions ship as seed rows, not as deployments.

Everything in this document is in service of those two commitments.

---

## 2. The multi-company / multi-tenant model

### 2.1 The three entities

```
core.companies ──────┐
                     ├──< core.company_memberships >── core.users
core.roles ──────────┘                                    │
                                                          = auth.users.id
```

- **`core.companies`** — a tenant. Every tenant-scoped row in the entire database carries `company_id uuid not null references core.companies(id)` (spec §4). This is the partition key for isolation.
- **`core.users`** — a person. `core.users.id` **is** `auth.users.id` (spec §5); there is exactly one platform identity per Supabase Auth identity.
- **`core.company_memberships`** — the **many-to-many** join that makes the platform multi-tenant. A single user has *N* membership rows, one per company they belong to, **each pointing at its own role**:

```sql
-- shape from _ARCHITECTURE-SPEC.md §5; status as native enum
create type core.membership_status as enum ('active','invited','suspended');

create table core.company_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references core.users(id)     on delete cascade,
  company_id  uuid not null references core.companies(id) on delete cascade,
  role_id     uuid not null references core.roles(id),
  status      core.membership_status not null default 'invited',
  created_at  timestamptz not null default now(),
  unique (user_id, company_id)            -- one membership per (user, company)
);

create index on core.company_memberships (user_id)    where status = 'active';
create index on core.company_memberships (company_id) where status = 'active';
```

The `unique (user_id, company_id)` constraint encodes the rule **"a user has at most one role per company"** while leaving them free to have *different* roles across companies: Andrew may be `Company Admin` of Taylor Surveying and a `View-only User` of Taylor Freight at the same time, via two membership rows.

`status` distinguishes a live member (`active`), an outstanding invite not yet accepted (`invited`), and a revoked-but-retained member (`suspended`). **Only `active` memberships grant access** — this is enforced once, in the `core.user_companies()` helper (§6.1), so every RLS policy inherits the rule for free.

### 2.2 The active-company context

A user with several memberships is, at any moment, *working inside exactly one company*. That choice is the **active company**. It is not a property of the user row (which would be a single-company assumption); it is a property of the **session**.

The active company travels with the request and is asserted at the database boundary:

```
┌──────────┐  active_company_id   ┌──────────┐  JWT (sub, app_metadata)  ┌────────────┐
│ Browser  │ ───────────────────▶ │ Next.js  │ ────────────────────────▶ │  Supabase  │
│ (cookie/ │                      │ (server) │   + SET LOCAL app.company  │  Postgres  │
│  header) │                      └──────────┘                            │  (RLS)     │
└──────────┘                                                              └────────────┘
```

1. The browser holds the chosen `active_company_id` (in a signed cookie / app state). The company switcher in the platform shell `(platform)/` writes it.
2. Every server request to Postgres runs as the authenticated user (JWT `sub` = `core.users.id`) **and** carries the asserted active company via a request-local GUC: `SET LOCAL app.current_company_id = '<uuid>'`.
3. Policies read `auth.uid()` for *who* and `app.current_company_id` for *which tenant*, and verify the two are consistent (the user is an active member of the asserted company) before any row is visible.

The active company is therefore **asserted by the app but verified by the database**. A forged or stale `app.current_company_id` for a company the user does not belong to yields zero rows — the membership check in `core.user_companies()` rejects it. See §4.3 for exactly how it is set and validated.

### 2.3 End-to-end company scoping (request → session → RLS)

```
Request:  GET /accounting/journals             [user JWT in Authorization header]
   │
Session:  Supabase verifies JWT → role `authenticated`, auth.uid() = user_id
   │      Next.js server sets   SET LOCAL app.current_company_id = :active
   │      Guard: company is in core.user_companies()  → else 403 (fail closed)
   │
RLS:      SELECT ... FROM accounting.journal_entries
          policy USING (company_id IN (select core.user_companies()))
          ⇒ Postgres rewrites the query to only return rows for companies the
            user actively belongs to. The :active GUC narrows the working set;
            the membership set is the security boundary.
   │
Result:   Only this company's journals. Cross-company rows are unreachable,
          even if the app forgot a WHERE clause.
```

The decisive property: **even with no `WHERE company_id` in the application query, the result set is already confined to the user's companies by RLS.** The GUC is a convenience for "show me the one I'm looking at"; the membership-backed policy is the wall.

---

## 3. Supabase Auth integration

### 3.1 `auth.users` → `core.users`

Supabase Auth owns `auth.users` (credentials, email confirmation, MFA, OAuth identities). The platform owns `core.users` (profile, super-admin flag). They are joined **by shared primary key**, per spec §5: `core.users.id = auth.users.id`.

The mapping is created automatically the instant an auth user is created, via a trigger on `auth.users` (a `security definer` function owned by a privileged role, since `auth` is not writable by app roles):

```sql
create or replace function core.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = core, pg_temp
as $$
begin
  insert into core.users (id, email, full_name, is_super_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    false                              -- super admin is NEVER self-assignable
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_auth_user();
```

Note `is_super_admin` is hard-set to `false` here. Elevation is a deliberate, separately-audited administrative act (§5), never derived from anything the signing-up user controls.

### 3.2 Sign-up and invite flows

There are two ways a `core.users` row comes to exist; **neither one grants company access by itself** — access is always a separate `core.company_memberships` row.

**A. Invite into a company (the normal path).** A `Company Admin` invites an email into their company with a chosen role:

1. Admin (holding `admin.members.invite`, §7) submits `{email, role_id}` for the active company.
2. The server calls Supabase Auth admin `inviteUserByEmail(email)` → creates/locates `auth.users` (and via §3.1, `core.users`).
3. The server inserts a membership: `core.company_memberships(user_id, company_id, role_id, status = 'invited')`.
4. The invitee accepts (sets a password / SSO). On first authenticated load, the app transitions their membership(s) `invited → active` for the company they accepted into.

The invite **scopes the new user to one company with one role**. They see nothing else.

**B. Self sign-up (restricted).** Public self-sign-up creates `auth.users` + `core.users` but **zero memberships** — the user can authenticate yet has access to *nothing* until an admin grants a membership (RLS returns empty for every tenant table). Self-sign-up is disabled by default for this internal platform and gated to allowed email domains where enabled; the safe default is invite-only.

### 3.3 JWT claims and what the database trusts

The Supabase JWT presented on each request carries:

| Claim | Source | Trusted for |
| --- | --- | --- |
| `sub` | `auth.users.id` | The user identity → `auth.uid()` in policies. **Authoritative.** |
| `role` | Supabase | Postgres role (`authenticated` / `anon` / `service_role`). |
| `email` | `auth.users` | Display only. |
| `app_metadata` | server-set | Optional cached hints (e.g. `is_super_admin`, last company). **Advisory only.** |
| `user_metadata` | user-set | Profile only. **Never trusted for authorization.** |

**Critical rule:** authorization decisions read from **tables**, not from the JWT. `app_metadata` may *cache* `is_super_admin` to save a round-trip in the UI, but the database re-derives super-admin status from `core.users.is_super_admin` (§5) and permissions from `core.role_permissions` (§6.2). The JWT is trusted for *identity* (`sub`); it is never trusted for *privilege*. This means revoking a membership or a permission takes effect on the next query, not on the next token refresh.

### 3.4 Selecting and asserting the active company

- **Selection.** On login the server reads `core.user_companies()`. If the user has one company, it is selected automatically; if several, the switcher offers them and the last-used company (cached in `app_metadata.last_company_id`) is pre-selected. A user with zero active companies sees an "awaiting access" state, not an error.
- **Assertion.** For every database interaction the server emits, within the same transaction/pooled session as the user's JWT:

```sql
select set_config('app.current_company_id', :active_company_id, true);  -- local to txn
```

- **Verification.** The value is *never* trusted on its own. Policies that need the active company (e.g. a uniqueness check, a default insert company) read it through `core.current_company_id()` (§6.1), which **returns the GUC only if it is in `core.user_companies()`**, and raises otherwise. The wall is membership; the GUC merely picks a door within the wall.

---

## 4. The session bridge in detail

### 4.1 Three Postgres roles, three trust levels

Supabase exposes three database roles; this platform uses them with strict discipline:

| Role | Used by | RLS | Notes |
| --- | --- | --- | --- |
| `anon` | unauthenticated page loads | enforced | No tenant rows reachable. Marketing/login only. |
| `authenticated` | every signed-in user request | **enforced** | The default and overwhelmingly dominant path. |
| `service_role` | trusted server jobs only | **bypasses RLS** | Never reaches the browser. See §9.3. |

### 4.2 What the app must do every request

```ts
// conceptual — server-side only, never shipped to the browser
// (design illustration; real code lives in src/core/auth, not in this doc)
withUserSession(jwt, async (db) => {
  await db.exec(`select set_config('app.current_company_id', $1, true)`, [activeCompanyId]);
  // ... all queries here run as `authenticated`, RLS active, company asserted
});
```

The user's JWT (not the service key) backs the connection, so `auth.uid()` resolves and RLS is live for the whole unit of work.

### 4.3 Setting the GUC safely

`SET LOCAL` (equivalently `set_config(..., true)`) confines the value to the current transaction, which matters under Supabase's connection pooler where sessions are reused. A leaked GUC into the next borrower's transaction is prevented by the `LOCAL` scope and by re-asserting on every request. Even if a stale value survived, §6.1's membership check makes it inert.

---

## 5. Super Admin and safe privilege bypass

**Super Admin** (spec §7) is a *platform-wide* identity for the small set of operators who administer the entire group — provisioning companies, recovering tenants, cross-company support. It is the one principal that legitimately sees across the tenant boundary.

It is modelled as a **boolean on the person**, not as a magic role row, so it cannot be granted by editing role assignments inside a single company:

```sql
-- core.users.is_super_admin bool default false   (spec §5)
```

### 5.1 How the bypass is implemented

Super-admin status is folded into the **two helper functions every policy already uses** (§6), so the bypass is defined in exactly one place and is impossible to forget on a new table:

- `core.user_companies()` returns **all** company ids when the caller is a super admin (so `SELECT`/scoping policies pass for every tenant).
- `core.has_permission()` returns **`true`** unconditionally when the caller is a super admin (so write policies pass).

Because every RLS policy is written in terms of those two functions (never in terms of `is_super_admin` directly), a developer adding a new table writes the *normal* policy and gets correct super-admin behaviour automatically. There is no per-table bypass branch to get wrong.

### 5.2 Why this is safe

- **Not self-grantable.** `is_super_admin` is forced `false` at user creation (§3.1) and is excluded from every app-facing update path by RLS on `core.users` (a user may update their own profile columns but **not** `is_super_admin`). Elevation is performed only by an existing super admin or by a direct, logged DBA action.
- **Always audited.** Any change to `is_super_admin` and any write performed by a super admin lands in `core.audit_logs` (§8) with the actor recorded; the bypass is powerful but never silent.
- **Not the app's default credential.** Super admins authenticate as themselves with their own JWT; the bypass is keyed off `auth.uid()` → `core.users.is_super_admin`, *not* off the `service_role` key. Day-to-day, no human uses `service_role` (§9.3).
- **Least privilege still applies in the UI.** The platform shell only surfaces cross-company tooling to super admins; ordinary admin screens read the same RLS-scoped data everyone else does.

---

## 6. The `security definer` helper functions

These two functions are the heart of the model. Every policy delegates to them; they encapsulate the membership rule and the permission rule exactly once. They are `security definer` so they can read `core.*` regardless of the caller's own RLS, and they are pinned with `set search_path` to prevent search-path hijacking.

### 6.1 `core.user_companies()` — the isolation boundary

```sql
-- Returns the set of company_ids the CURRENT user may access.
-- Super admins get every company; everyone else gets only their ACTIVE memberships.
create or replace function core.user_companies()
returns setof uuid
language sql
stable
security definer
set search_path = core, pg_temp
as $$
  select c.id
  from core.companies c
  where exists (
    select 1 from core.users u
    where u.id = auth.uid() and u.is_super_admin
  )
  union
  select m.company_id
  from core.company_memberships m
  where m.user_id = auth.uid()
    and m.status = 'active';
$$;

-- Returns the asserted active company ONLY if the user may access it; else raises.
create or replace function core.current_company_id()
returns uuid
language plpgsql
stable
security definer
set search_path = core, pg_temp
as $$
declare cid uuid;
begin
  cid := nullif(current_setting('app.current_company_id', true), '')::uuid;
  if cid is null then
    return null;                         -- no company asserted (e.g. switcher screen)
  end if;
  if cid not in (select core.user_companies()) then
    raise exception 'company % not accessible to current user', cid
      using errcode = 'insufficient_privilege';
  end if;
  return cid;
end;
$$;
```

`stable` (not `volatile`) lets the planner cache the result within a statement, so `company_id IN (select core.user_companies())` does not re-evaluate per row. The membership/super-admin rule is now defined **once**; every policy that calls it inherits both the "active only" and "super admin sees all" semantics.

### 6.2 `core.has_permission(company_id, permission_key)` — the write gate

```sql
-- True if the current user holds `permission_key` for `p_company` (or is super admin).
-- Reads are governed by membership (user_companies); writes ADD this permission check.
create or replace function core.has_permission(p_company uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = core, pg_temp
as $$
  select
    -- super admin: unconditional yes
    exists (
      select 1 from core.users u
      where u.id = auth.uid() and u.is_super_admin
    )
    or
    -- data-driven: an ACTIVE membership in this company whose role grants the key
    exists (
      select 1
      from core.company_memberships m
      join core.roles            r  on r.id  = m.role_id
      join core.role_permissions rp on rp.role_id = r.id
      join core.permissions      p  on p.id  = rp.permission_id
      where m.user_id    = auth.uid()
        and m.company_id = p_company
        and m.status     = 'active'
        and p.key        = p_permission
        -- role is either a system role (company_id is null) or this company's own role
        and (r.company_id is null or r.company_id = p_company)
    );
$$;
```

There is **no hard-coded permission anywhere** in this function — it is a pure join across `memberships → roles → role_permissions → permissions`. Adding, removing, or recombining permissions is a data change in those tables (spec §10: "No hard-coded permissions"). The function answers exactly one question — "does this user hold this key in this company?" — and every write policy asks it.

---

## 7. RBAC: roles, permissions, and the catalogue

### 7.1 Seed roles

Five **system roles** ship seeded with `company_id = null` and `is_system = true` (spec §5, §7). System roles are visible to every company and may be assigned in any company; a company may additionally define **custom roles** scoped to itself (`company_id = <its id>`).

| Role key | Name | Intent | Typical permission shape |
| --- | --- | --- | --- |
| `super_admin` | Super Admin | Platform-wide operator (the `is_super_admin` person, §5). | Bypass — holds everything implicitly; not enumerated. |
| `company_admin` | Company Admin | Owns one company: members, settings, full accounting. | All accounting `*` + `admin.*` for that company. |
| `accountant` | Accountant / Admin User | Runs the books: create, post, reverse, reconcile, close. | All `accounts/journals/invoices/bills/banking/periods/reports.*`; no `admin.members.*`. |
| `office_user` | Office User | Day-to-day operations: drafts documents, no posting/close. | `*.create`, `*.update`, `*.view`; **no** `*.post`, `*.void`, `periods.close`. |
| `view_only` | View-only User | Read access for review/audit/management. | `*.view` and `reports.view` only. |

`super_admin` is listed for completeness; in practice the bypass (§5) carries it, and the seeded role exists so the relationship is explicit and assignable. The other four are realised purely as **rows in `core.role_permissions`** — their power is whatever permission keys they are joined to, nothing more.

### 7.2 Data-driven permission tables

```sql
create table core.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,            -- e.g. 'journals.post'
  name        text not null,
  description text,
  category    text not null                    -- grouping for the admin UI
);

create table core.role_permissions (
  role_id       uuid not null references core.roles(id)       on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
```

A role's authority is *exactly* the set of `permissions.key` reachable through `role_permissions`. To change what a role can do, you insert or delete `role_permissions` rows — no deployment, no code path. The permission catalogue (§7.3) is reference seed data (spec §3: `supabase/seed/`).

### 7.3 Initial permission catalogue

Keys follow `category.resource.action`. This is the seed catalogue; it is **extensible** — modules add their own keys under their own categories without touching the engine.

| Category | Key | Description |
| --- | --- | --- |
| **accounts** | `accounts.view` | View chart of accounts and account details. |
| | `accounts.create` | Create accounts in the chart. |
| | `accounts.update` | Edit account name, type, status. |
| | `accounts.archive` | Deactivate / archive an account. |
| **journals** | `journals.view` | View journal entries and lines. |
| | `journals.create` | Create draft manual journal entries. |
| | `journals.update` | Edit a *draft* journal entry. |
| | `journals.post` | Post a balanced entry (engine `post_journal_entry`). |
| | `journals.reverse` | Create a reversing entry for a posted entry. |
| | `journals.void` | Void a draft entry. |
| **invoices** | `invoices.view` | View AR invoices. |
| | `invoices.create` | Create draft invoices. |
| | `invoices.update` | Edit a draft invoice. |
| | `invoices.post` | Approve/issue an invoice (posts its journal entry). |
| | `invoices.void` | Void an invoice (reversing entry). |
| | `invoices.payment` | Record a receipt against an invoice. |
| **bills** | `bills.view` | View AP bills. |
| | `bills.create` | Create draft bills. |
| | `bills.update` | Edit a draft bill. |
| | `bills.post` | Approve a bill (posts its journal entry). |
| | `bills.void` | Void a bill (reversing entry). |
| | `bills.payment` | Record a payment against a bill. |
| **banking** | `banking.view` | View bank accounts and statements. |
| | `banking.manage` | Create/edit bank accounts. |
| | `banking.reconcile` | Perform and finalise reconciliations. |
| | `banking.import` | Import bank statement files. |
| **periods** | `periods.view` | View accounting periods and status. |
| | `periods.manage` | Generate / edit periods. |
| | `periods.close` | Close an open period. |
| | `periods.reopen` | Reopen a closed period (logged, §8). |
| | `periods.lock` | Permanently lock a period. |
| **reports** | `reports.view` | Run and view financial reports. |
| | `reports.export` | Export reports (`accounting.report_exports`). |
| **imports** | `imports.view` | View import batches and staging. |
| | `imports.create` | Upload and stage an import batch. |
| | `imports.commit` | Commit a validated import batch to the ledger. |
| **tax** | `tax.view` | View tax codes. |
| | `tax.manage` | Create/edit tax codes (no hard-coded rates, spec §9). |
| **customers** | `customers.view` / `customers.manage` | View / maintain customers. |
| **suppliers** | `suppliers.view` / `suppliers.manage` | View / maintain suppliers. |
| **documents** | `documents.view` | View/download documents (`core.documents`, §9.5). |
| | `documents.upload` | Upload documents. |
| | `documents.delete` | Delete documents. |
| **admin** | `admin.members.view` | View company members and roles. |
| | `admin.members.invite` | Invite users into the company (§3.2). |
| | `admin.members.manage` | Change a member's role / suspend a member. |
| | `admin.roles.manage` | Create/edit custom roles & their permissions. |
| | `admin.company.settings` | Edit company settings (currency, fiscal year, etc.). |
| | `admin.audit.view` | View `core.audit_logs` for the company. |

`super_admin` additionally implies a platform-only `platform.companies.manage` (create/recover companies) carried by the bypass.

---

## 8. Audit logging

### 8.1 `core.audit_logs` design

Per spec §5, every consequential write is recorded immutably with before/after state, actor, and action:

```sql
create table core.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references core.companies(id),  -- null only for platform-level events
  user_id       uuid references core.users(id),      -- actor (auth.uid()); null for system jobs
  action        text not null,                       -- 'insert' | 'update' | 'delete' | domain verb
  entity_schema text not null,                       -- 'accounting' | 'core'
  entity_type   text not null,                       -- table name, e.g. 'journal_entries'
  entity_id     uuid,                                -- the affected row id
  before        jsonb,                               -- row image pre-change (null on insert)
  after         jsonb,                               -- row image post-change (null on delete)
  ip            inet,                                -- from app.request_ip GUC when available
  created_at    timestamptz not null default now()
);

create index on core.audit_logs (company_id, created_at desc);
create index on core.audit_logs (entity_schema, entity_type, entity_id);
```

The table is **append-only**: an RLS policy permits `SELECT` (to holders of `admin.audit.view`, scoped by company) but no `UPDATE`/`DELETE` from any app role, and the trigger that fills it writes as `security definer`. Audit history is therefore tamper-evident from the application's side; only a DBA with direct access could alter it.

### 8.2 Trigger-based population

A single generic `security definer` trigger function serves every audited table, capturing the full before/after row image as `jsonb` and the actor from `auth.uid()`:

```sql
create or replace function core.fn_audit()
returns trigger
language plpgsql
security definer
set search_path = core, pg_temp
as $$
declare
  v_company uuid;
  v_before  jsonb := null;
  v_after   jsonb := null;
  v_id      uuid;
begin
  if (tg_op = 'DELETE') then
    v_before  := to_jsonb(old);
    v_company := (v_before ->> 'company_id')::uuid;
    v_id      := (v_before ->> 'id')::uuid;
  elsif (tg_op = 'UPDATE') then
    v_before  := to_jsonb(old);
    v_after   := to_jsonb(new);
    v_company := (v_after  ->> 'company_id')::uuid;
    v_id      := (v_after  ->> 'id')::uuid;
  else -- INSERT
    v_after   := to_jsonb(new);
    v_company := (v_after  ->> 'company_id')::uuid;
    v_id      := (v_after  ->> 'id')::uuid;
  end if;

  insert into core.audit_logs (
    company_id, user_id, action, entity_schema, entity_type, entity_id, before, after, ip
  ) values (
    v_company,
    auth.uid(),
    lower(tg_op),
    tg_table_schema,
    tg_table_name,
    v_id,
    v_before,
    v_after,
    nullif(current_setting('app.request_ip', true), '')::inet
  );

  return coalesce(new, old);
end;
$$;
```

Attached to each audited table with one statement:

```sql
create trigger trg_audit_accounts
  after insert or update or delete on accounting.accounts
  for each row execute function core.fn_audit();

create trigger trg_audit_journal_entries
  after insert or update or delete on accounting.journal_entries
  for each row execute function core.fn_audit();
-- ...and for journal_lines, invoices, bills, periods, memberships, roles, role_permissions, users
```

What is captured: **who** (`user_id` from `auth.uid()`), **what** (`action`, `entity_*`), **before/after** (full row images for diffing), **where from** (`ip`), and **when** (`created_at`). Because the trigger runs `after` the row change and reads `auth.uid()`, it correctly attributes the actor even when the write happens deep inside a `security definer` posting function — the *invoker's* `auth.uid()` is preserved. Domain-level events (a period reopen, a super-admin elevation, an import commit) additionally write an explicit row with a domain `action` verb so the log reads as a business narrative, not only table mutations. This satisfies the engine doc's open question on logging period reopens.

---

## 9. Row Level Security: policies and hardening

RLS is **enabled and forced on every table** (spec §4). The pattern is uniform and only two rules deep:

- **Read** (`SELECT`): the row's `company_id` is in `core.user_companies()`.
- **Write** (`INSERT`/`UPDATE`/`DELETE`): read rule **and** `core.has_permission(company_id, '<key>')`.

### 9.1 `core.companies`

A company is visible to its members; mutable only by holders of `admin.company.settings`; creatable only by super admins (carried by `has_permission` returning true for them, gated on a platform key the catalogue assigns only to `super_admin`).

```sql
alter table core.companies enable row level security;
alter table core.companies force row level security;

create policy companies_select on core.companies
  for select using ( id in (select core.user_companies()) );

create policy companies_update on core.companies
  for update using ( id in (select core.user_companies()) )
  with check ( core.has_permission(id, 'admin.company.settings') );

create policy companies_insert on core.companies
  for insert
  with check ( core.has_permission(id, 'platform.companies.manage') );  -- super admin only in seed
```

### 9.2 `accounting.accounts`

```sql
alter table accounting.accounts enable row level security;
alter table accounting.accounts force row level security;

-- READ: any active member of the account's company
create policy accounts_select on accounting.accounts
  for select using ( company_id in (select core.user_companies()) );

-- INSERT: must target a company you may write accounts in
create policy accounts_insert on accounting.accounts
  for insert
  with check ( core.has_permission(company_id, 'accounts.create') );

-- UPDATE: old row visible AND new row still in a permitted company
create policy accounts_update on accounting.accounts
  for update
  using  ( company_id in (select core.user_companies()) )
  with check ( core.has_permission(company_id, 'accounts.update') );

-- DELETE (archive is preferred; hard delete gated separately)
create policy accounts_delete on accounting.accounts
  for delete
  using ( core.has_permission(company_id, 'accounts.archive') );
```

The `with check` on `INSERT`/`UPDATE` is what stops a user **moving a row into another company**: even a member of company A cannot insert/update a row whose `company_id` is company B unless they also hold the permission in B. `using` controls which rows you can *see/target*; `with check` controls what the row may *become*. Both are required to seal the tenant boundary on writes.

### 9.3 `accounting.journal_entries`

Posting state interacts with RBAC. The base policies gate by permission; the engine's immutability triggers (`accounting-engine.md` §4.2/§5.3) independently forbid mutating a `posted` row regardless of permission. RLS decides *who and which company*; the engine decides *what transitions are legal*. They are complementary and both must pass.

```sql
alter table accounting.journal_entries enable row level security;
alter table accounting.journal_entries force row level security;

create policy je_select on accounting.journal_entries
  for select using ( company_id in (select core.user_companies()) );

create policy je_insert on accounting.journal_entries
  for insert
  with check ( core.has_permission(company_id, 'journals.create') );

-- editing drafts; posting/reversing happen via engine functions that themselves
-- check journals.post / journals.reverse before allocating numbers and writing lines
create policy je_update on accounting.journal_entries
  for update
  using  ( company_id in (select core.user_companies()) )
  with check ( core.has_permission(company_id, 'journals.update') );
```

`accounting.journal_lines` carries its own `company_id` (spec §5) and the identical pattern keyed on `journals.*`, so a line can never be attached to an entry in a company the user lacks rights to — defence in depth even though lines are normally written only through the posting function.

### 9.4 Why every table, not just headers

Each tenant table carries its own `company_id` *and* its own RLS policies. We do **not** rely on "you can only reach a line through its parent entry" — that assumes the app always joins correctly and never exposes a line endpoint directly. PostgREST exposes tables directly, so each one defends itself. This is the §1 commitment made concrete: isolation is per-table, not per-query-path.

### 9.5 Storage / `core.documents`

Files live in a Supabase Storage bucket; `core.documents` is the metadata row (spec §5). Two layers protect them:

1. **Metadata RLS.** `core.documents` rows are visible per `company_id` ∈ `core.user_companies()`; insert needs `documents.upload`, delete needs `documents.delete`.
2. **Bucket path convention + Storage policies.** Objects are stored under a **company-prefixed path**: `storage_path = '{company_id}/{owner_module}/{entity_type}/{entity_id}/{filename}'`. The bucket is **private** (no public URL). A Storage RLS policy enforces that the first path segment is a company the requester belongs to:

```sql
-- on storage.objects, for the 'documents' bucket
create policy documents_read on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1]::uuid in (select core.user_companies())
  );

create policy documents_write on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and core.has_permission((storage.foldername(name))[1]::uuid, 'documents.upload')
  );
```

Downloads are served via **short-lived signed URLs** minted server-side only after the metadata RLS check passes; the bucket itself is never public. A leaked or guessed `storage_path` is useless without an active membership in the leading company segment.

---

## 10. Threat model and hardening

| Threat | Vector | Mitigation |
| --- | --- | --- |
| **Cross-company read** | App forgets `WHERE company_id`; PostgREST endpoint queried directly. | RLS `SELECT` policy on every table (§9). Result is empty for non-members regardless of query. Fail closed. |
| **Cross-company write / row "teleport"** | Insert/update a row with another company's `company_id`. | `with check (has_permission(company_id, ...))` on every write policy (§9.2). The target company is re-validated against memberships. |
| **Stale / forged active company** | Tampered `app.current_company_id` GUC. | `core.current_company_id()` raises unless the value ∈ `user_companies()` (§6.1). GUC narrows, membership gates. |
| **Privilege escalation via JWT** | User edits `user_metadata`, claims admin. | Authorization reads tables, never JWT metadata (§3.3). `user_metadata` is profile-only. |
| **Self-promotion to super admin** | User sets `is_super_admin` on their own row. | `is_super_admin` forced `false` at creation (§3.1); excluded from the user-self-update policy; changes audited (§5.2, §8). |
| **Permission drift / hidden hard-codes** | Access logic creeps into app code. | Single `has_permission` function; spec §10 forbids hard-coded permissions; reviews reject any `if (role === ...)`. |
| **Audit tampering** | Attacker edits/deletes log rows to hide actions. | `core.audit_logs` append-only via RLS (no app `UPDATE`/`DELETE`); written by `security definer` trigger (§8.1). |
| **`service_role` key leakage** | Key in client bundle / logs → full RLS bypass. | §10.1. |
| **Storage object enumeration** | Guessing `storage_path`. | Private bucket, company-prefixed paths, Storage RLS, signed URLs only (§9.5). |
| **`security definer` hijack** | Search-path manipulation to shadow a function. | Every definer function pins `set search_path = core, pg_temp` (§6, §8). |
| **Connection-pool GUC bleed** | Pooler reuses a session with a prior tenant's GUC. | `SET LOCAL`/txn-scoped config + re-assert per request; membership check makes any residue inert (§4.3). |

### 10.1 Service-role key handling

The `service_role` key **bypasses RLS entirely** and is the single most dangerous secret in the system. Rules:

- It exists **only** in trusted server-side environments (Vercel server runtime / scheduled jobs), **never** in any client bundle, public env var, browser, or log line.
- It is used **only** for legitimately cross-tenant or system operations: the `auth.users` sync trigger context, scheduled reconciliation/rebuild jobs (engine §11), and platform provisioning. Such code **must still pass `company_id` explicitly** and is reviewed as privileged.
- All ordinary user traffic uses the user's JWT as `authenticated` (§4.1). If you find yourself reaching for `service_role` to serve a user request, that is a design smell — the fix is a correct RLS policy, not the bypass.
- The key is rotatable; rotation procedure is documented in operations runbooks (out of scope here).

### 10.2 Tenant isolation guarantees (what we promise)

1. **No member of company A can read or write any row of company B** (other than a super admin), enforced by RLS on every table, including child tables and storage objects.
2. **Every write is permission-checked against the destination company**, so rows cannot be created in, or moved into, a company the actor lacks rights to.
3. **Every privileged or financial mutation is attributable and immutable in `core.audit_logs`.**
4. **Authorization is fully data-driven and revocation is immediate** (next query), because privilege is read from tables, not cached in tokens.

### 10.3 Least privilege, end to end

- Roles grant the *minimum* keys for the job (§7.1); `view_only` truly cannot write; `office_user` truly cannot post or close.
- App roles (`anon`, `authenticated`) hold no table privileges beyond what PostgREST needs; RLS narrows further.
- `security definer` functions are owned by a dedicated role, granted `EXECUTE` to `authenticated`, and do exactly one thing each.
- Super admin is rare, audited, and not the default credential (§5.2).

---

## Open Questions

- **Custom role creation UX.** `admin.roles.manage` lets a company define custom roles over the catalogue. Should custom roles be allowed to grant *any* permission key, or a curated subset (e.g. never `admin.audit.view` without a higher gate)?
- **Invite acceptance and pre-existing users.** When inviting an email that already has a `core.users` row (member of another company), do we auto-activate on accept, or require explicit per-company acceptance for audit clarity? (Leaning explicit.)
- **Request IP provenance.** `app.request_ip` is app-supplied; behind Vercel/Supabase proxies, which forwarded header is authoritative, and should we capture it at the edge instead of trusting a GUC?
- **Super-admin "act as company".** Should super admins assume a specific company context (set `app.current_company_id`) for support so their actions are scoped and audited under that company, rather than ranging across all companies by default?
- **MFA enforcement.** Should `company_admin` and super admins be required to have MFA enabled in Supabase Auth before privileged keys take effect? (Likely yes for super admin.)
- **Permission caching for the UI.** The DB is authoritative, but the client needs a fast "can I see this button?" check. What is the safe staleness window for a cached permission set surfaced to the UI, given DB revocation is immediate?

## Decisions Locked

- **Tenant isolation is enforced by Postgres RLS on every table**, keyed on `company_id ∈ core.user_companies()`; application `WHERE` clauses are an optimisation, never the security boundary. (§1, §9)
- **A user belongs to many companies via `core.company_memberships`, with one role per company**; only `active` memberships grant access. The active company is **asserted by the app and verified by the database** through `core.current_company_id()`. (§2)
- **`core.users.id = auth.users.id`**, created by a `security definer` trigger that forces `is_super_admin = false`; super-admin elevation is a separate, audited act. (§3.1, §5.2)
- **Authorization reads tables, never the JWT.** `app_metadata`/`user_metadata` are advisory/profile only; revocation is immediate. (§3.3)
- **Permissions are 100% data-driven** via `core.permissions` + `core.role_permissions`, evaluated by the single `core.has_permission(company_id, key)` function. **No hard-coded permissions, ever** (spec §10). (§6.2, §7)
- **Two `security definer` helpers** — `core.user_companies()` and `core.has_permission()` — encapsulate the membership rule, the active-only rule, and the **super-admin bypass** in one place; every policy delegates to them. Both pin `search_path`. (§5.1, §6)
- **RLS pattern:** `SELECT` gated by membership; `INSERT`/`UPDATE`/`DELETE` additionally gated by `has_permission`, with `with check` on the destination `company_id` to prevent cross-company writes. (§9)
- **`core.audit_logs` is append-only**, populated by a generic `security definer` trigger capturing before/after `jsonb`, actor, action, and IP. (§8)
- **`service_role` is server-only**, used solely for cross-tenant/system jobs, never for ordinary user requests; user traffic always runs as `authenticated` with RLS live. (§10.1)
- **`core.documents` storage is a private bucket** with company-prefixed paths, Storage RLS, and signed-URL-only downloads. (§9.5)

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative cross-cutting spec — schema names §5, double-entry invariants §6, RBAC model §7, non-negotiables §10). `accounting-engine.md` (the `post_journal_entry` / `reverse_journal_entry` and immutability triggers run *inside* the tenant boundary and permission gates defined here; this doc resolves its open question on auditing period reopens). Sibling module docs (currency, AR/AP, tax, import) inherit this RLS pattern and permission catalogue for their tables.
