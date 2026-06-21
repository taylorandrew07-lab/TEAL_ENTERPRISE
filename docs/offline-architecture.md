# Offline & Sync Architecture

**TEAL Enterprise — Accounting Module**
Owning agent: Offline / Sync Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This document defines how TEAL Enterprise behaves when the network is unreliable or absent. It establishes the guiding principle — **offline view-first** — under which Phase 1 supports offline *viewing* of already-synced data only, and explicitly **forbids offline editing of accounting transactions** until robust sync and conflict rules exist. It specifies the PWA foundation, the on-device read cache, a forward-looking sync design for areas that may earn offline capability later, and the security rules for data held on the device.

This document conforms to `_ARCHITECTURE-SPEC.md` and is bound by its non-negotiables (§10: "No offline editing before sync rules are defined") and its double-entry invariants (§6). It cross-references `accounting-engine.md` (the posting lifecycle and period control it relies on), `teal-enterprise-platform-vision.md` (module roadmap), and `trinidad-accounting-requirements.md` (statutory context). The Accounting Engine doc is authoritative on posting internals; this doc is authoritative on what may and may not happen off-network.

---

## 1. The guiding principle: offline view-first

TEAL Enterprise is a **Progressive Web App** so that staff in the field — surveyors on a vessel, agents at a port, accountants on a flaky office connection in Trinidad & Tobago — can keep working when the connection drops. But "keep working" is deliberately scoped. For Phase 1 the rule is one sentence:

> **You can read what you have already synced. You cannot post, edit, or mutate accounting data while offline.**

Concretely, in Phase 1:

- **Allowed offline:** viewing cached chart of accounts, recent journals, customers, suppliers, invoices/bills already fetched, and last-rendered dashboards and reports — all read-only, all clearly marked as a cached snapshot with an "as of" timestamp.
- **Not allowed offline:** creating or editing journal entries, invoices, bills, payments, receipts; posting anything; closing or locking periods; changing the chart of accounts, tax codes, exchange rates, or any reference data; bulk imports.

Everything that *writes* to the ledger requires a live connection and a server round-trip. This is not a temporary limitation we are apologising for — it is the correct design for a double-entry accounting system, and it is locked until §4's sync foundation is built and proven.

### 1.1 Why offline double-entry editing is dangerous and must be deferred

Offline-first patterns (local writes, background sync, eventual consistency) work beautifully for notes apps, chat, and CRMs. They are actively hazardous for a general ledger. Each hazard below is a concrete reason the spec defers offline editing.

**1. Document numbering gaps and collisions.** Accounting documents carry gapless, server-allocated sequences: `journal_entries.entry_no`, `invoices.invoice_no`, `bills.bill_no`. Auditors and the T&T tax authority expect these sequences to be unbroken and unique. A number can only be safely assigned by the single authority that owns the sequence — the server. If two field devices each invent `INV-1043` offline and both sync later, you get a collision; if a device reserves `INV-1043` offline and never syncs, you get a permanent gap. Neither is acceptable, and there is no client-side trick that fixes it without the server in the loop at write time.

**2. Period locks.** Per `accounting-engine.md` and spec §6.3, posting into a `closed` or `locked` period is rejected. A device that went offline on the 28th does not know that the accountant locked the prior period on the 30th. An entry composed offline against an open period may target a period that is locked by the time it reaches the server. The only correct authority on period status at the moment of posting is the server.

**3. Balance integrity across concurrent edits.** The non-negotiable invariant (spec §6.1) is `SUM(debit) = SUM(credit)` in both transaction and base currency, enforced by a server-side trigger/posting function. An individual offline entry can be locally balanced, but the *ledger* integrity that matters spans documents: an invoice and its payment, a bill and its FX revaluation, a reversal and its original. Offline edits cannot see concurrent changes other users are making to the same accounts, customer balances, or open-item allocations, so "locally valid" does not imply "valid against the book of record."

**4. FX rates fixed at transaction time.** Spec §8 requires `fx_rate` and base-currency equivalents to be captured at transaction time and **never re-derived historically**. The correct rate lives server-side in `accounting.exchange_rates`. A device offline for two days holds a stale rate. Posting with a stale or guessed rate corrupts the base-currency books and the eventual revaluation. Rate authority must be online.

**5. Conflicts with no safe automatic resolution.** For a chat message, last-write-wins is fine. For a posted journal entry, there is no safe automatic merge: you cannot silently overwrite one accountant's entry with another's, and you cannot auto-merge two divergent versions of a balanced transaction without potentially unbalancing it or double-counting. Posted entries are immutable by invariant (spec §6.2) — corrections are *reversing entries*, not edits — which is fundamentally incompatible with an "edit offline, reconcile later" model.

**6. Audit trust.** `core.audit_logs` records who did what, when, from which IP, with before/after. An offline edit blurs *when* it truly happened versus when it was applied, and from where. Financial audit requires that the moment of posting and its authorisation are unambiguous. Server-authoritative posting keeps the audit trail honest.

The conclusion the spec draws, and this document enforces: **accounting posting is always server-authoritative and always online.** Offline capability, when it eventually arrives (§5), arrives only for *draft data capture* that has not yet touched the ledger — and even then only behind the sync foundation in §4.

---

## 2. PWA foundation

TEAL Enterprise ships as an installable PWA on top of Next.js (App Router) deployed on Vercel (spec §2). The offline story rests on three browser primitives: a **web app manifest**, a **service worker**, and a **local data layer** (§3).

### 2.1 Manifest and install

A web app manifest describes the installable app: name (`TEAL Enterprise`), short name, icons, theme and background colours, `display: standalone`, and a `start_url` that lands on the authenticated shell. Installation gives staff a home-screen / desktop launcher and a chromeless window, which matters most for field use. Install is *additive*: the app must work identically in a normal browser tab. We never gate functionality on being installed.

### 2.2 Service worker and the app shell

The service worker is the network proxy that makes offline possible. Its job in Phase 1 is narrow and conservative:

- **Precache the app shell.** The static, versioned assets that render the UI frame — the HTML shell, JS/CSS bundles, fonts, icons, and the offline fallback page — are cached on install. This is the "shell" in app-shell architecture: the chrome renders instantly and works offline; the *data* is filled in from the local data layer (§3) or the network.
- **Runtime caching by resource class:**
  - **App shell / static build assets:** cache-first, keyed by build hash. New deploys ship a new service worker that precaches the new hash and discards the old. This is safe because these assets are immutable per build.
  - **Read-only API data (GET):** network-first with a cache fallback, *for whitelisted read endpoints only*. Online users always see fresh data; offline users see the last good snapshot. The cached copy is surfaced through the IndexedDB layer (§3), not raw HTTP cache, so we control invalidation and partitioning.
  - **Mutating API calls (POST/PUT/PATCH/DELETE):** **never cached, never queued, never replayed** in Phase 1. If the network is down, the write fails loudly and the UI tells the user they are offline and the action could not be completed. There is no silent background-sync of accounting writes.
- **Navigation fallback.** Requests for routes we cannot serve offline return a friendly "you're offline — here's what you can still view" page that links to the cached read-only areas.

### 2.3 What is safe to cache

| Category | Cache it? | Strategy |
| --- | --- | --- |
| App shell, JS/CSS bundles, fonts, icons | Yes | Cache-first, versioned by build hash |
| Public/static images, logos | Yes | Cache-first |
| Read-only reference & list data (per §3) | Yes, scoped per company | Network-first → IndexedDB snapshot |
| Authenticated GET for a single record already viewed | Yes, scoped per company | Network-first → IndexedDB snapshot |
| Any mutating request (POST/PUT/PATCH/DELETE) | **No** | Always online; fail loudly offline |
| Auth tokens / session secrets | **No** in plain cache | Held in memory / secure session store, cleared on logout (§6) |
| Supabase Storage documents with sensitive content | **No** by default | Stream online only; never bulk-precached |
| Cross-company data in a shared store | **Never** | Partition by `company_id` (§3.3) |

The service worker is intentionally "dumb" about accounting. It knows how to serve the shell and how to fall back to a read snapshot. It knows nothing about posting, and it must never be taught to replay a financial write.

---

## 3. Local data layer (read-only cache)

### 3.1 Why IndexedDB

The HTTP Cache API is good for opaque responses (the app shell). For structured, queryable, per-record, invalidatable business data we use **IndexedDB**: it holds large structured datasets, supports indexed lookups (by company, by code, by date), and lets us reason about freshness and partitioning explicitly. The Cache API serves the *frame*; IndexedDB serves the *data*. We access IndexedDB through a thin typed wrapper (conceptually a small library in `src/core/`), never ad hoc, so partitioning and invalidation rules are enforced in one place.

### 3.2 What we cache (Phase 1 read-only datasets)

These are the datasets a field user reasonably needs to *consult* offline. All are snapshots of already-synced server state, all read-only, all stamped with a fetch timestamp:

- **Chart of accounts** (`accounting.accounts`, `accounting.account_types`) — slow-changing reference; ideal to cache.
- **Recent journals** (a bounded window of posted `accounting.journal_entries` + `accounting.journal_lines`, e.g. last N days or last N entries) — for lookup, not editing.
- **Customers and suppliers** (`accounting.customers`, `accounting.suppliers`) — contact and balance reference.
- **Recent invoices and bills** already viewed (`accounting.invoices`/`bills` headers and lines) — for reference.
- **Reference data**: `accounting.currencies`, `accounting.tax_codes`, and the latest known `accounting.exchange_rates` (clearly labelled "as of" and **for display only** — never used to compose an offline posting; see §1.1 hazard 4).
- **Dashboards and reports**: the last-rendered dashboard config (`accounting.dashboard_configs`) and the last *materialised result* of a report the user opened, stored as a snapshot so the dashboard re-renders offline with a visible "data as of {timestamp}" banner.

Each cached object store carries metadata: `company_id`, `fetched_at`, a `source_etag`/`version` where the API provides one, and the logical dataset key. The UI must always show the snapshot age and an explicit "cached — may be out of date" indicator so no one mistakes a stale balance for a live one.

### 3.3 Per-company cache partitioning (never mix companies)

TEAL is multi-company by spec §1 and §4 (every tenant-scoped row has `company_id`). The cache must reflect that boundary absolutely:

- **Every cached object store key is prefixed/partitioned by `company_id`.** A read for company A can never return rows belonging to company B, even on the same device for the same user.
- **The active company is part of the cache lookup key.** Switching companies switches the partition the UI reads from; it does not merge or fall through.
- **On company switch, the previously active company's cache is evicted** (see §6.3). We do not keep multiple companies' financial data warm on the device simultaneously beyond what the user is actively using, and we never present one in the context of another.
- RLS protects the *server*; this partitioning protects the *device*. Both must hold. A bug that leaked company B's cached balances into company A's screen would be as serious as an RLS failure.

### 3.4 Cache invalidation

A read cache is only safe if it is demonstrably fresh-or-flagged. Our invalidation rules:

- **Freshness on reconnect.** When connectivity returns and the relevant screen is opened, we refetch and replace the snapshot (network-first). The cache is a fallback, never the preferred source when online.
- **TTL / staleness flag.** Each dataset has a soft staleness threshold. Past it, the data is still shown offline but the "stale" indicator escalates. Reference data (chart of accounts, currencies) tolerates longer TTLs; balances and dashboards are flagged sooner.
- **Version/etag checks.** Where the API exposes an etag or `updated_at` high-water mark, we cheaply check "has this dataset changed?" before re-downloading the whole set.
- **Event-driven invalidation.** After any successful online mutation (a posting, a new invoice), the affected datasets for that company are marked dirty and refetched, so the cache cannot lag behind a write the same user just made.
- **Hard purge triggers.** Logout, company switch, and detected auth/permission change purge the relevant partition immediately (§6).
- **Schema/version bump.** A change to the local store shape bumps an IndexedDB version and discards incompatible stores rather than migrating risky financial snapshots.

Cached data never participates in a balance calculation that is treated as authoritative. The authoritative balance is always the server-derived General Ledger (`accounting-engine.md`). The cache shows a *picture*; the server holds the *truth*.

---

## 4. Sync foundation for the future

Phase 1 ships with **no** sync engine for writes, by design. But the architecture must not paint us into a corner: when certain non-ledger areas earn offline capability (§5), they will need a disciplined sync mechanism. This section is forward-looking design — not Phase 1 scope — so that the eventual implementation is principled rather than improvised.

### 4.1 The outbox / operation-log pattern

When offline write capability arrives for an eligible area, offline actions are **not** applied directly to a local mirror of server tables. Instead each user action is recorded as an immutable **operation** in a local **outbox** (an append-only operation log in IndexedDB):

- An operation captures: a client-generated operation id (idempotency key), the actor, the target entity and its known base version, the intended change (as a semantic operation, e.g. "create draft survey note", not a raw row diff), the local timestamp, and the `company_id`.
- The UI reflects the operation *optimistically* against the local view, clearly marked **pending / not yet synced**.
- On reconnect, the outbox is drained **in order** to the server, which is the sole authority that decides whether each operation is accepted, transformed, or rejected. The operation id makes replay **idempotent** — re-sending after a flaky connection cannot double-apply.
- Accepted operations return the authoritative server state, which replaces the optimistic local copy. Rejected operations surface to the user for manual resolution; they are never silently dropped or silently forced.

The outbox is an *intent log*, not a shadow ledger. It records what the user wanted to do, leaving the server to decide what actually happened.

### 4.2 Conflict detection

Conflicts are detected by **version/precondition checks**, not guesswork. Each operation carries the base version (`updated_at` / row version / etag) of the entity it was composed against. The server compares that base against the current state:

- **No divergence** (server unchanged since base): apply.
- **Divergence** (server changed since base): conflict — do not blindly apply. Route to a resolution policy (§4.3).

This is optimistic concurrency control. It requires that eligible entities expose a monotonic version the client can pin to.

### 4.3 Resolution: last-write-wins vs server-authoritative

Two resolution stances, chosen *per data class*, never globally:

- **Last-write-wins (LWW)** is acceptable only for **low-stakes, single-owner, non-financial** data where a later edit legitimately supersedes an earlier one (e.g. a personal dashboard layout in `accounting.dashboard_configs`, a draft note's free-text body). Even here, LWW is a deliberate choice with a visible "your offline change replaced a newer version" warning where divergence occurred.
- **Server-authoritative resolution** is the default and the *only* option for anything that approaches financial meaning. The server's posting functions, period checks, sequence allocation, FX lookup, and balance triggers run at sync time exactly as they would online. The client's offline draft is treated as a *request*, the server as the decider. If the server rejects (period now locked, validation failed, conflict), the draft stays as an unposted draft for the user to fix — it never half-applies.

### 4.4 Why posting is always server-authoritative and online

Even with a mature outbox, **posting to the ledger never becomes a fire-and-forget offline operation.** The six hazards in §1.1 do not disappear just because we have a sync engine — the sync engine *contains* them by forcing the server to be the authority at the moment of posting. Specifically:

- Sequence allocation (`entry_no`, `invoice_no`, `bill_no`) happens **only** server-side, at accept time, so there are no offline-invented numbers, no gaps, no collisions.
- Period status (`open`/`closed`/`locked`) is evaluated **at the server, at accept time**, never against a stale local guess.
- The balance trigger and base-currency check (spec §6.1) run server-side; an offline draft that *looks* balanced is re-validated authoritatively before it can post.
- FX rate is taken from server `exchange_rates` at accept time, not from a cached rate.
- Immutability of posted entries (spec §6.2) means the only offline-eligible artefact is a **draft that has not posted**. The act of posting is an online, server-owned transition.

So the future offline model is precisely: **capture drafts offline → sync the draft → the server posts (or rejects) authoritatively while online.** The ledger transition itself is never delegated to the device.

---

## 5. Phased roadmap

### Phase 1 — View-only cache (now)
- PWA install, app-shell precache, offline fallback page (§2).
- Per-company read-only IndexedDB cache of chart of accounts, recent journals, customers, suppliers, recent invoices/bills, reference data, last-rendered dashboards/reports (§3).
- All snapshots stamped and flagged as cached. All mutating requests fail loudly offline (§2.2).
- Hard cache purge on logout / company switch (§6).
- **No outbox, no offline writes, no background write-sync of any kind.**

### Phase 2 — Offline draft capture with sync (later, gated)
- Introduce the outbox / operation-log (§4) for **non-ledger draft capture only** — e.g. drafting an invoice or expense that is *not yet posted*, or field data capture for future modules (Survey, Claims, Cargo).
- Optimistic local drafts marked pending; ordered, idempotent sync on reconnect.
- Optimistic concurrency (version checks) + server-authoritative resolution; LWW only for personal/non-financial preferences.
- Drafts sync to the server, which then runs normal online posting validation. A draft becoming a *posted* document remains an online, server-authoritative step.
- Ships only after the sync foundation is implemented, tested, and the conflict rules are documented and locked. (Spec §10: "No offline editing before sync rules are defined.")

### Never offline — server-authoritative, online-only (permanently)
- **Posting** any journal entry, invoice, bill, payment, or receipt to the ledger.
- **Period close / lock / reopen.**
- **Payments and receipts** (movement of money / settlement of open items).
- **Reference & control changes**: chart of accounts structure, tax codes, exchange rates, roles/permissions, company configuration.
- **Bulk imports** (always staged + validated server-side per spec §10).
- **FX revaluation** and any `source = 'fx_revaluation'` posting.

These remain online-only regardless of how mature the sync engine becomes, because they are the points where the ledger's integrity, numbering, and audit trust are established — and those can only be guaranteed by the single server-side authority.

---

## 6. Security of cached data on-device

A device cache is an attack surface and a data-leak surface. The rules below are mandatory.

### 6.1 What we do and do not cache
- **Do not cache** auth tokens or session secrets in plain IndexedDB/Cache. Sessions live in the Supabase client's secure session store / memory and are cleared on logout.
- **Do not bulk-precache** sensitive Storage documents (`core.documents`, scanned bills, KYC material). Such files stream online only and are not retained offline by default.
- **Minimise sensitive financial fields in the cache.** We cache what a user needs to *view*, not the entire ledger. Where a field is sensitive and not needed offline, it is omitted from the snapshot.

### 6.2 Encryption considerations
- All transport is HTTPS; the service worker only operates in secure contexts.
- IndexedDB is **origin-isolated** by the browser but **not encrypted at rest by the application** by default. For a device that may be shared or lost, OS-level full-disk encryption is the baseline expectation, and for higher-sensitivity deployments we layer application-level encryption of cached payloads (a session-derived key held in memory, never persisted), so a cold device yields no readable financial data. The decision on application-level encryption strength is recorded under Open Questions.
- No sensitive cache key material is written to disk; keys are derived per session and discarded on logout.

### 6.3 Clearing cache on logout and company switch
- **On logout:** purge all IndexedDB business stores and the auth/session state for the user; the next user on the device starts clean. The service worker's static app-shell cache may remain (it is non-sensitive, public build assets), but all per-company business data is gone.
- **On company switch:** evict the prior company's partition (§3.3) so company A's balances cannot linger behind company B's screen. The new company's data is fetched fresh online; if offline at switch time, only that company's already-cached partition (if any) is shown, clearly flagged.
- **On detected auth/permission change** (membership suspended, role changed, token revoked): treat as logout for cache purposes and purge.
- **On schema/version bump:** discard incompatible stores rather than migrate (§3.4).

The principle: the cache must never outlive the authorisation that produced it. RLS governs the server (spec §7); these rules govern the device. They are complementary and both required.

---

## 7. Boundaries: what is and isn't allowed offline

| Operation | Online | Offline (Phase 1) | Offline (future, §5) | Authority |
| --- | --- | --- | --- | --- |
| View cached chart of accounts | Yes | Yes (read-only snapshot) | Yes | Cache, flagged |
| View recent journals / invoices / bills | Yes | Yes (read-only snapshot) | Yes | Cache, flagged |
| View customers / suppliers | Yes | Yes (read-only snapshot) | Yes | Cache, flagged |
| View last-rendered dashboards / reports | Yes | Yes (snapshot, "as of") | Yes | Cache, flagged |
| View latest known FX rates | Yes | Yes (display only) | Yes (display only) | Cache, flagged |
| Draft a non-ledger document (e.g. unposted invoice draft) | Yes | **No** | Yes (outbox, server-resolved) | Server at sync |
| Field data capture for future modules | Yes | **No** | Yes (outbox, server-resolved) | Server at sync |
| Edit personal dashboard layout | Yes | **No** in Phase 1 | Yes (LWW, warned) | LWW allowed |
| Create / edit a journal entry | Yes | **No** | **No** | Server-authoritative |
| **Post** any entry / invoice / bill | Yes | **No** | **No** | Server-authoritative |
| Record a payment / receipt | Yes | **No** | **No** | Server-authoritative |
| Close / lock / reopen a period | Yes | **No** | **No** | Server-authoritative |
| Change chart of accounts / tax codes / FX rates | Yes | **No** | **No** | Server-authoritative |
| Change roles / permissions / company config | Yes | **No** | **No** | Server-authoritative |
| Bulk import | Yes | **No** | **No** | Server staged + validated |

If it writes to the ledger or to control data, it is **online and server-authoritative, always.** If it is a read, it may be served from the per-company cache, flagged as a snapshot. Drafts of non-ledger data may *eventually* be captured offline behind the §4 sync foundation, but the act of posting is never delegated to the device.

---

## Open Questions

1. **Application-level cache encryption.** Do we require app-level encryption of IndexedDB payloads in Phase 1, or rely on origin isolation + OS full-disk encryption and defer app-level encryption to deployments handling the most sensitive companies? Needs a risk decision per the T&T deployment profile.
2. **Cache window sizing.** What are the concrete bounds for "recent" journals/invoices per company on a device (last N days vs last N records), balancing field usefulness against device storage and leak surface?
3. **Staleness thresholds per dataset.** Exact TTLs and the escalation points for the "stale" indicator, especially for balances and dashboards.
4. **Phase 2 trigger.** What objective criteria (which modules, which user demand, what test coverage of the sync engine) gate the move from view-only to offline draft capture?
5. **Outbox durability.** Retention and recovery rules for unsynced drafts if a device is lost before reconnect — and how that interacts with the logout/company-switch purge rules in §6.

## Decisions Locked

1. **Offline is view-first.** Phase 1 supports offline *viewing* of already-synced data only. No offline editing of accounting transactions. (Spec §2, §10.)
2. **Posting is always server-authoritative and online**, permanently — including period close/lock, payments/receipts, reference changes, FX revaluation, and bulk imports. No sync engine ever delegates posting to the device. (Spec §6.)
3. **Mutating requests are never cached, queued, or background-replayed in Phase 1.** Offline writes fail loudly. (§2.2.)
4. **The read cache lives in IndexedDB, partitioned strictly by `company_id`.** Companies' data is never mixed on-device; the active company selects the partition. (§3.3.)
5. **The cache never outlives its authorisation.** Logout, company switch, and auth/permission changes purge the relevant per-company business cache. (§6.3.)
6. **Cached data is never authoritative.** All cached snapshots are flagged with an "as of" timestamp; the server-derived General Ledger is the only source of truth for balances. (§3.4, cross-ref `accounting-engine.md`.)
7. **The future sync model is outbox/operation-log with optimistic concurrency and server-authoritative resolution**, with last-write-wins permitted only for personal/non-financial preferences. Drafts may be captured offline; posting them is an online, server-owned transition. (§4, §5.)
