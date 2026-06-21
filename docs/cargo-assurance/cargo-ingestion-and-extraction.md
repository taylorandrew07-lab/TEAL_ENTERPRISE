# Cargo Assurance — Ingestion & Extraction

**TEAL Enterprise — Cargo Assurance Module**
Owning agent: Cargo Assurance Ingestion & Extraction Agent
Status: Draft v1 — 2026-06-17

Purpose: defines how Cargo Assurance ingests hundreds of heterogeneous fuel documents in a single bulk
upload, classifies and extracts them with full source traceability, applies configurable per-client
extraction templates, and automatically reconstructs loadouts from the resulting evidence. This is the
front half of the acceptance spine (`_CARGO-SPEC.md` §9): *bulk-upload → classify + extract → group into
loadouts*. It conforms to `_CARGO-SPEC.md` (canonical `cargo` schema, §6) and `../_ARCHITECTURE-SPEC.md`
(platform conventions, RLS, Storage, audit).

---

## 1. Scope & non-negotiables

This document covers four stages and their state machine: **bulk ingestion**, **classification &
extraction**, **extraction templates**, and **automatic loadout matching**. It does **not** define the
calculation engine, the three result layers, findings, or reporting — those live in sibling docs
(see §12 cross-references).

Carried directly from `_CARGO-SPEC.md` §4 and binding on everything below:

1. **Never discard the original document.** The uploaded bytes are stored once in Supabase Storage and
   the `cargo.documents` row is **never deleted** — not on duplicate, not on failure, not on
   reprocessing, not on cancellation.
2. **Never invent a missing value.** A field that cannot be read is recorded with
   `status ∈ {missing, uncertain, needs_review}`, never with a guessed `normalized_value`.
3. **Source traceability.** Every `cargo.extracted_fields` row links back to document + page + table +
   cell + worksheet wherever technically possible.
4. **Corrections are additive.** A correction writes `cargo.field_corrections`
   (original + corrected + reason + user + timestamp); it improves future extraction of the *same
   format* but **never silently alters a previously approved/published review**.
5. **A source certificate is counted once.** `cargo.loadout_documents.document_id` is unique — one
   document maps to at most one loadout.

---

## 2. Bulk ingestion

### 2.1 Upload experience

The **Import Documents** screen (top-level nav, `_CARGO-SPEC.md` §2) accepts a drag-and-drop of
**hundreds of files in one batch**, plus folder drops and an "add files" picker. A batch is always
created **within an Assurance Review** (`cargo.import_batches.review_id` is not null), because ingestion
exists to populate a review's evidence pool.

Upload is **chunked and resumable**. Files are uploaded directly to Supabase Storage using resumable
(TUS) uploads so a dropped connection mid-batch resumes the in-flight file rather than restarting the
whole drop. The browser uploads in bounded concurrency (e.g. 4–6 in flight) and reports per-file and
whole-batch progress. The batch row is created **first** (status `uploaded`) so that a refresh or crash
mid-upload leaves a recoverable, inspectable batch rather than orphaned bytes.

### 2.2 Supported input types

| Category | Examples | Handling |
| --- | --- | --- |
| Native (digital) PDF | FuelTrax exports, vessel/shore meter reports, loadout summaries | text + table extraction (no OCR) |
| Scanned / image PDF | photographed or faxed tank-sounding & bunker certificates | OCR (§3.2) |
| Images | JPG/PNG/TIFF/HEIC of certificates | OCR |
| Excel | `.xlsx`, `.xls` meter logs, sounding workbooks, client trackers | structured worksheet/cell parsing |
| CSV / delimited | `.csv`, `.tsv` FuelTrax & meter exports | structured row/column parsing |
| ZIP archives | a period's worth of certs zipped per vessel/month | **expanded server-side**; each member becomes its own `cargo.documents` row |
| Client-specific formats | Taylor certificates, bunker/fuel-delivery notes, client trackers | matched to an extraction template (§4) |

**ZIP handling.** A ZIP is itself stored as a `cargo.documents` row (`file_type='application/zip'`,
`detected_document_type='other'`, `extraction_status='extracted'` once expanded — it carries no fields
of its own). Each extracted member is a new `cargo.documents` row with
`parent_archive_id = <zip document id>`, preserving provenance. Nested ZIPs are expanded recursively to
a bounded depth; archive bombs (excessive depth/expansion ratio/member count) are rejected at the batch
level with a `data_exceptions` entry, and the original ZIP is still retained.

Unsupported / unreadable members (e.g. encrypted files, password-protected PDFs, corrupt images) are
**not discarded** — they are stored with `extraction_status='failed'` and a `data_exceptions` row of
type `low_confidence` / `unmatched_document` so an analyst can supply a password or a better scan.

### 2.3 Stored fields per document (authoritative)

Every uploaded file produces exactly one `cargo.documents` row (`_CARGO-SPEC.md` §6 → Ingestion). The
spec's required stored fields map as follows — nothing here is optional:

| Concern (spec §4.1) | Column |
| --- | --- |
| original filename | `original_filename` |
| checksum (duplicate detection) | `checksum` (SHA-256 of raw bytes) |
| file type | `file_type` (MIME) |
| batch | `batch_id` → `cargo.import_batches` |
| uploader | `uploaded_by` → `core.users` |
| timestamp | `uploaded_at` |
| client | `client_id` → `core.clients` |
| detected type | `detected_document_type` (`cargo.document_type`) |
| classification confidence | `classification_confidence` |
| extraction status | `extraction_status` enum[pending,processing,extracted,needs_review,failed] |
| extraction confidence | `extraction_confidence` |
| raw values | `raw_extraction jsonb` |
| normalized values | `normalized_extraction jsonb` |
| validation status | `validation_status` enum[pending,valid,invalid,needs_review] |
| source / page span | `page_count`, plus per-field source refs on `cargo.extracted_fields` |
| archive provenance | `parent_archive_id` |
| stored bytes | `storage_path` (Supabase Storage) |

A `core.documents` row may also be registered with `owner_module='cargo_assurance'`
(`_CARGO-SPEC.md` §5) for platform-wide document listing, but `cargo.documents` is the **authoritative**
ingestion record.

### 2.4 Duplicate detection (checksum)

On upload the SHA-256 checksum of the raw bytes is computed (client-side during upload, re-verified
server-side). Before creating field rows the pipeline queries for an existing **non-failed**
`cargo.documents` row with the same `(company_id, checksum)`.

- **Exact duplicate** (same checksum within the company): the new file is **still stored** (never
  discarded) but flagged. The recommended treatment is to record it with a `data_exceptions` row of
  type `duplicate_certificate`, link it to the original, and **skip re-extraction** by default — the
  analyst decides whether it is a genuine re-upload (drop) or a legitimately re-sent certificate. The
  unique-document rule (§5.4) prevents the same content being counted twice in a loadout regardless.
- **Near-duplicate** (same certificate number / vessel / date but different checksum — e.g. a rescanned
  copy) is **not** a checksum match; it is detected later during loadout matching (§5) and surfaced for
  review rather than auto-dropped.

Checksum equality is necessary but the **loadout `unique(document_id)` constraint is the hard guarantee**
against double-counting; duplicate detection is an efficiency + UX layer on top.

### 2.5 Batch processing, status & history

Each batch is a `cargo.import_batches` row tracking `file_count`, `processed_count`, `failed_count`,
and a `status` enum[uploaded, processing, completed, failed, cancelled]. The screen shows:

- **Import progress** — `processed_count / file_count`, with `failed_count` broken out.
- **Per-file status** — each document's `extraction_status` and `classification_confidence`.
- **Failed-document retry** — re-enqueues only the documents in `extraction_status='failed'` (or a
  selected subset); idempotent (§6.3).
- **Cancellation** — flips the batch to `cancelled` and stops dispatching *new* jobs; in-flight jobs
  finish or no-op safely. No bytes are deleted.
- **Import-batch history** — every batch a review has ever had, with counts and outcomes, so a 12-month
  review's ingestion is fully auditable.

**Background extraction jobs** do the heavy work (OCR, parsing, classification, field extraction)
asynchronously so the browser is never blocked; the upload and the extraction are decoupled (§6).

### 2.6 Automatic grouping of related documents

Beyond ZIP membership, the pipeline performs lightweight **pre-grouping** as documents land, to make
later loadout matching cheaper and reviewable:

- documents sharing a `parent_archive_id` are visually grouped;
- documents whose extracted `certificate_number` / `vessel` / `loadout_date` agree are tagged with a
  provisional **group key** (a hash of normalized client+vessel+terminal+date+certificate) shown in the
  review UI;
- definitive grouping into `cargo.loadouts` happens in the matcher (§5) — pre-grouping is advisory only
  and never writes loadout rows by itself.

---

## 3. Document classification & extraction

### 3.1 Document types to auto-identify

Classification assigns `cargo.documents.detected_document_type` from `cargo.document_type`
(`_CARGO-SPEC.md` §6):

`vessel_sounding_certificate`, `vessel_flow_meter_report`, `shore_flow_meter_report`,
`shore_tank_certificate`, `fueltrax_report`, `bunker_delivery_note`, `loadout_summary`,
`calibration_certificate`, `on_hire_certificate`, `off_hire_certificate`, `other`.

Each carries a `classification_confidence`. Below the template's classification threshold the document
is routed to `needs_review` rather than guessed.

### 3.2 Extraction strategy by source type

- **Native PDF** → digital text + table extraction. Word/table coordinates are retained so each value
  keeps `source_page`, `source_table`, `source_cell`.
- **Scanned PDF / images** → **OCR** (e.g. a Textract/Tesseract-class engine) producing text + word
  bounding boxes + table cells; `source_page` and bounding region are recorded; OCR confidence feeds
  the field `confidence`.
- **Excel** → structured parsing per worksheet; each value keeps `source_worksheet` + `source_cell`
  (e.g. `Soundings!C12`).
- **CSV** → header-mapped column parsing; `source_table` = logical table name, `source_cell` =
  `row:col`.

Native/structured parsing is always preferred over OCR when the format is digital; OCR is a fallback for
non-digital evidence only.

### 3.3 Classification heuristics

Classification is template-driven (§4) but backed by general heuristics so unconfigured documents still
get a best-effort type:

```
score(doc, type) =
    w_kw  * keyword_label_hits(doc.text, type.labels)      // "ULLAGE REPORT", "BUNKER DELIVERY NOTE", "FuelTrax"
  + w_tbl * table_shape_match(doc.tables, type.table_sig)   // columns like Tank|Ullage|Temp|Density|Vol
  + w_fmt * filetype_prior(doc.file_type, type)             // .csv from FuelTrax exporter, etc.
  + w_fn  * filename_pattern(doc.original_filename, type)   // "MV_*_SOUNDING_*.pdf"
  + w_iss * issuer_match(doc.text, type.known_issuers)      // terminal / bunker supplier letterhead

detected = argmax_type score
confidence = softmax(score)[detected]      // 0..1
if confidence < type.classification_threshold: route to needs_review (extraction_status)
```

Worked examples:

- A PDF containing `"CERTIFICATE OF QUANTITY"`, a `Tank / Ullage / Temp / Density / Volume` table, and a
  terminal letterhead → `shore_tank_certificate`.
- A `.csv` whose header is `timestamp,vessel,flow_rate_m3h,totalizer_open,totalizer_close` from the
  FuelTrax exporter → `fueltrax_report`.
- A scanned page reading `"BUNKER DELIVERY NOTE"` / `"BDN No."` with supplier + barge details →
  `bunker_delivery_note`.
- A page titled `"ON-HIRE BUNKER SURVEY"` with ROB-per-tank → `on_hire_certificate`.

### 3.4 Fields to extract

Extraction writes one `cargo.extracted_fields` row per recognized field, plus the rolled-up
`raw_extraction` / `normalized_extraction` JSON on the document. Field keys (`field_key`) are stable,
namespaced strings. The target set, per `_CARGO-SPEC.md` §6 (loadouts, tank readings, measurements, hire
periods), includes at least:

**Header / identity:** `client_name`, `vessel_name`, `vessel_imo`, `terminal_name`, `berth`,
`certificate_number`, `loadout_date`, `start_time`, `completion_time`, `product_name`, `product_grade`,
`nominated_quantity`, `reported_delivered_quantity`, `quantity_unit`, `issuer`, `bdn_number`.

**Per-tank (vessel sounding / certificate):** `tank_name`, `tank_role`, `received_flag`,
`opening_sounding`, `closing_sounding`, `opening_quantity`, `closing_quantity`, `unit`, `temperature`,
`density`, `api_gravity`, `std_volume_basis`.

**Meter (vessel/shore flow):** `meter_physical_id`, `opening_totalizer`, `closing_totalizer`,
`meter_factor`, `flow_unit`, `calibration_date`, `calibration_factor`.

**FuelTrax / consumption:** `event_timestamp`, `flow_rate`, `cumulative_volume`, `bunkered_quantity`,
`consumed_quantity`.

**Hire boundary (on/off-hire):** `on_hire_date`, `on_hire_time`, `on_hire_location`, `off_hire_date`,
`off_hire_time`, `off_hire_location`, `boundary`, per-tank `sounding`/`quantity`/`temperature`/
`density`/`std_volume`.

**Calibration:** `meter_physical_id`, `calibration_factor`, `calibration_date`, `expiry_date`.

Each row records `raw_value` (exactly as read), `normalized_value` (unit/format-normalized, **only when
defensible**), `unit`, `confidence`, the source refs, and `status`:

```
status = ok          when value read with confidence ≥ template field threshold
       = missing      when an expected/required field is absent
       = uncertain    when read but below threshold or ambiguous
       = needs_review  when validation rules fail or units can't be resolved
```

**No invention rule:** if `density` is required for a std-volume conversion but absent from the source,
`std_volume` is **not** computed — `density` is `status='missing'` and any dependent field is
`needs_review`. The system never assumes a temperature/density the source does not support
(`_CARGO-SPEC.md` §7).

---

## 4. Extraction templates

`cargo.extraction_templates` (`_CARGO-SPEC.md` §6) is the configurable, **versioned**, per-client /
per-document-type definition that drives classification and extraction. A template is selected by
`(client_id, document_type)` with the most specific active version winning; `client_id NULL` is the
generic fallback for a document type.

### 4.1 What a template configures

| Template column | Contents |
| --- | --- |
| `field_map` | recognizable headings/labels → `field_key`, with required/optional flag and per-field confidence threshold |
| `table_structures` | expected table column signatures (e.g. tank tables, meter logs), with header synonyms |
| `unit_mappings` | source unit strings → canonical units (`MT`→`t`, `KL`→`m³`, `BBLS`→`bbl`) |
| `date_formats` | accepted date/time patterns for this client (`DD/MM/YYYY`, `DD-MMM-YY HH:mm`) |
| `validation_rules` | cross-field checks (closing ≤ opening for ullage, totalizer monotonic, quantity > 0) |
| `confidence_thresholds` | classification threshold + default field threshold |
| naming conventions | tank/meter name → canonical asset (`"No.3 P"` → vessel_tank `3P`) |
| default calculation treatment | e.g. default `tank_role`, default `std_volume_basis`, whether a tank is receiving by default |

### 4.2 Sample CSV (a FuelTrax export) and its mapping

A representative FuelTrax CSV:

```csv
Timestamp,Vessel,Terminal,Product,Tank,OpenTotalizer,CloseTotalizer,MeterFactor,Unit,Temp_C,Density
2026-05-14 06:12,MV TEAL SPIRIT,Pointe-a-Pierre,VLSFO,VES-FLOW-1,18840.50,19920.75,1.0021,m3,31.4,0.9712
```

Template (abridged) mapping it to canonical fields:

```json
{
  "template": "fueltrax-default",
  "client_id": null,
  "document_type": "fueltrax_report",
  "version": 3,
  "confidence_thresholds": { "classification": 0.80, "field_default": 0.75 },
  "date_formats": ["YYYY-MM-DD HH:mm", "DD/MM/YYYY HH:mm"],
  "unit_mappings": { "m3": "m³", "KL": "m³", "BBL": "bbl", "MT": "t" },
  "table_structures": {
    "meter_log": {
      "required_columns": ["Timestamp", "Vessel", "OpenTotalizer", "CloseTotalizer", "Unit"],
      "header_synonyms": { "OpenTotalizer": ["Totalizer Open", "Start Total"],
                           "CloseTotalizer": ["Totalizer Close", "End Total"] }
    }
  },
  "field_map": {
    "event_timestamp":   { "labels": ["Timestamp"],      "required": true,  "type": "datetime" },
    "vessel_name":       { "labels": ["Vessel"],         "required": true },
    "terminal_name":     { "labels": ["Terminal"],       "required": false },
    "product_name":      { "labels": ["Product"],        "required": true },
    "meter_physical_id": { "labels": ["Tank","Meter"],   "required": true },
    "opening_totalizer": { "labels": ["OpenTotalizer"],  "required": true,  "type": "number" },
    "closing_totalizer": { "labels": ["CloseTotalizer"], "required": true,  "type": "number" },
    "meter_factor":      { "labels": ["MeterFactor"],    "required": false, "type": "number", "default": 1.0 },
    "flow_unit":         { "labels": ["Unit"],           "required": true,  "map": "unit_mappings" },
    "temperature":       { "labels": ["Temp_C","Temp"],  "required": false, "type": "number", "unit": "°C" },
    "density":           { "labels": ["Density"],        "required": false, "type": "number" }
  },
  "validation_rules": [
    { "id": "totalizer_increasing", "expr": "closing_totalizer >= opening_totalizer",
      "on_fail": "needs_review", "exception_type": "invalid_sequence" },
    { "id": "positive_factor", "expr": "meter_factor > 0", "on_fail": "needs_review" }
  ],
  "naming_conventions": { "VES-FLOW-1": { "meter_type": "vessel_flow", "canonical": "VFLOW1" } }
}
```

### 4.3 Sample Excel (a vessel sounding workbook)

Worksheet `Soundings` columns and the cells they map to (`source_worksheet`/`source_cell` retained):

| Col | Header | `field_key` | Notes |
| --- | --- | --- | --- |
| A | Tank | `tank_name` | via `naming_conventions` → `vessel_tank_id` |
| B | Role | `tank_role` | maps to `cargo.tank_role`; default `receiving` |
| C | Opening Ullage (m) | `opening_sounding` | unit retained |
| D | Closing Ullage (m) | `closing_sounding` | rule: `closing ≤ opening` |
| E | Temp (°C) | `temperature` | |
| F | Density @15°C | `density` | enables `std_volume_basis='at_15c'` |
| G | Opening Vol (m³) | `opening_quantity` | |
| H | Closing Vol (m³) | `closing_quantity` | |

### 4.4 Corrections feedback loop

When an analyst corrects a value (`cargo.extraction.correct` permission), the pipeline writes
`cargo.field_corrections(original_value, corrected_value, reason, corrected_by, corrected_at)` and updates
the live `cargo.extracted_fields.normalized_value` for *that document* (with `status='ok'`).

The correction is then **offered as a template improvement**: e.g. "the label `Dens@15` mapped to
`density` here — add to `fueltrax-default` field_map?". Accepting it creates a **new template version**
(`version+1`, status managed via draft→active). Two hard rules from `_CARGO-SPEC.md` §4:

- Template improvements apply to the **same format going forward** (new/reprocessed documents matched to
  the template), improving future extraction.
- They **never silently alter previously approved or published reviews**. Existing extracted fields and
  any snapshot stay exactly as approved; re-running extraction against a newer template is an explicit,
  audited reprocess action and produces *new* `extracted_fields` rows with their own corrections trail,
  never an in-place overwrite of approved evidence.

---

## 5. Automatic loadout matching

After documents in a review are extracted, the matcher reconstructs `cargo.loadouts` by grouping the
evidence (`_CARGO-SPEC.md` §6 → Loadouts, §9 acceptance spine).

### 5.1 Matching keys

A document is assigned to a loadout by agreement across, in priority order:

1. `client_id`
2. `certificate_number` (strongest single key when present)
3. `vessel` (IMO preferred over name)
4. `terminal` + `berth`
5. `loadout_date` + time window (start/completion overlap, configurable tolerance, e.g. ±12h)
6. `product`
7. `nominated_quantity` (within a tolerance band)
8. explicit cross-document references (`document references` printed on certs)

### 5.2 Matching pseudocode

```
for review R:
  docs = extracted documents in R not yet in loadout_documents
  candidates = cluster(docs, key = normalized(client, certificate_number, vessel_imo,
                                              terminal, berth, date_bucket, product))

  for cluster C in candidates:
      score = weighted_agreement(C):
          + 0.40 if certificate_number agrees across docs
          + 0.20 if vessel_imo (else fuzzy vessel_name) agrees
          + 0.15 if terminal (+berth) agrees
          + 0.15 if date/time windows overlap
          + 0.10 if product agrees
          - penalty for conflicting nominated_quantity beyond tolerance

      if score >= AUTO_MATCH_THRESHOLD:
          loadout = upsert_loadout(C.identity)        // certificate_number, vessel, terminal, date...
          for doc in C:
              if not exists loadout_documents(doc):    // unique(document_id) — never double-count
                  insert loadout_documents(loadout, doc, role = role_from_type(doc.detected_document_type))
          loadout.match_confidence = score
          loadout.status = 'extracted'
      else:
          // uncertain — surface for human review, do NOT auto-assign
          loadout.status = 'needs_review'
          raise data_exception(type='unmatched_document' | 'duplicate_certificate', docs=C)
```

`role_from_type` maps a document's `detected_document_type` to its `loadout_documents.role`
(e.g. `vessel_sounding_certificate`→`vessel_receipt`, `shore_tank_certificate`→`shore_delivery`,
`bunker_delivery_note`→`bdn`, `fueltrax_report`→`fueltrax`).

### 5.3 Uncertain matches → review

Clusters below `AUTO_MATCH_THRESHOLD`, conflicting nominated quantities, or a document that plausibly
fits two loadouts are **displayed for review** in the Data Review workspace with their candidate
loadouts and the agreeing/conflicting keys highlighted. Nothing uncertain is auto-committed; the analyst
confirms, splits, or excludes. Confirmation writes the `loadout_documents` rows and clears the
`data_exceptions` entry.

### 5.4 Preventing double-counting (the unique-document rule)

`cargo.loadout_documents.document_id` is **unique** (`_CARGO-SPEC.md` §6). Therefore:

- One source certificate can belong to at most one loadout — the database enforces it, not just app
  logic.
- Re-running the matcher is idempotent: an already-assigned document is skipped (the insert would
  violate the constraint, so it is guarded with an existence check).
- If two near-identical certificates (different checksums) both want the same role in a loadout, the
  second is raised as `duplicate_certificate` for an analyst to resolve, rather than silently inflating
  delivered quantity.

The same pattern governs hire periods via `cargo.hire_period_documents.document_id` unique.

---

## 6. Processing pipeline as a state machine

### 6.1 Canonical statuses (from `_CARGO-SPEC.md` §6)

```
import_batches.status   : uploaded → processing → completed
                                              ↘ failed
                                              ↘ cancelled
documents.extraction_status : pending → processing → extracted
                                                  ↘ needs_review
                                                  ↘ failed
documents.validation_status : pending → valid | invalid | needs_review
extracted_fields.status     : ok | missing | uncertain | needs_review
loadouts.status             : extracted → needs_review → approved | excluded
```

### 6.2 Lifecycle

```
[Batch created]            import_batches = uploaded;   N documents = pending
        │  (resumable upload of bytes to Storage completes per file)
        ▼
[Dispatch]                 batch = processing
   for each document (idempotent background job):
        pending → processing
          ├─ expand archive?  → spawn child documents (parent_archive_id), self → extracted
          ├─ checksum dedupe  → duplicate? exception + skip extract (still stored)
          ├─ classify         → detected_document_type, classification_confidence
          ├─ select template  → (client_id, document_type) most-specific active version
          ├─ extract fields   → extracted_fields rows (+ source refs), raw/normalized JSON
          ├─ validate         → validation_rules → validation_status
          └─ result:
                all required ok & valid           → extracted, validation valid
                below threshold / rule fail       → needs_review
                unreadable / engine error         → failed  (+ data_exception)
        ▼
[Batch rollup]   processed_count, failed_count updated atomically per document
        when processed_count + failed_count == file_count:
            failed_count == 0            → completed
            some failed, some ok         → completed (with failures surfaced) — analyst retries
            all failed                   → failed
        cancellation at any point        → cancelled (no new dispatch; in-flight no-op)
        ▼
[Matcher]   over extracted documents → loadouts (+ loadout_documents)   [§5]
```

### 6.3 Safe, queue-based background jobs (Vercel/Supabase realities)

Vercel serverless functions are short-lived and stateless, so the pipeline is **queue-based**, not a
long-running worker held open during the HTTP request:

- **Queue.** A durable work queue (Supabase Postgres-backed queue / `pgmq`, or a Supabase Edge Function
  triggered per item, optionally fronted by Supabase `cron`/Vercel Cron for sweeps). Each document is
  one queue message: `{ document_id, batch_id, attempt }`.
- **Small units of work.** One message = classify + extract **one** document, sized to finish well
  within a function timeout. ZIP expansion enqueues one message per member rather than processing the
  whole archive in one invocation.
- **Idempotency.** Every job is safe to run more than once. A job claims a document via a conditional
  transition (`pending|failed → processing` guarded by row version), and writes are upserts keyed by
  `(document_id, field_key)` so a redelivery overwrites its own partial output rather than duplicating
  rows. Re-running the matcher is guarded by the `loadout_documents` unique constraint.
- **Retry / backoff.** Transient failures (OCR timeout) increment `attempt` and requeue with backoff up
  to a cap; exhausted attempts set `extraction_status='failed'` + a `data_exceptions` row. The
  **failed-document retry** action simply re-enqueues failed documents.
- **Resumability.** Because state lives in the rows (not in memory), a crash, redeploy, or cancellation
  leaves a consistent picture; the next sweep picks up any document still `pending`/`processing` whose
  lease expired.
- **Cancellation safety.** `cancelled` is checked at the start of each job; a job for a cancelled batch
  no-ops. Bytes are never deleted, so a cancelled batch can be inspected or a new batch re-created from
  the same files.
- **Audit.** Every state transition and correction is written to `core.audit_logs` with
  `entity_schema = 'cargo'` (`_CARGO-SPEC.md` §5), under company RLS.

### 6.4 RLS & tenancy

All ingestion tables carry `company_id` and are RLS-protected (`../_ARCHITECTURE-SPEC.md` §7,
`_CARGO-SPEC.md` §5). Background jobs run with a service context but **always scope writes by the
document's `company_id`**; client-portal users never see ingestion rows (they see only published
snapshots). Upload requires `cargo.documents.upload`; corrections require `cargo.extraction.correct`;
reviewing/grouping requires `cargo.data.review`.

---

## 7. Worked end-to-end example

1. An analyst opens review *"ExxonMobil — H1 2026"* and drags a 312-file folder (PDFs, a few ZIPs, two
   Excel trackers, FuelTrax CSVs). One `import_batches` row (`uploaded`, `file_count=312`) is created;
   bytes stream to Storage resumably.
2. Dispatch flips the batch to `processing`; 312 (then more, after ZIP expansion) queue messages are
   enqueued.
3. Each document is checksum-deduped, classified (e.g. a scanned `shore_tank_certificate` via OCR; a
   `fueltrax_report` CSV via the template in §4.2), extracted with source refs, and validated. Three
   documents fail OCR (poor scans) → `failed` + exceptions; nine fall below threshold → `needs_review`.
4. Batch reaches `completed` with `failed_count=3`. The analyst fixes one scan, supplies a password for
   another, retries those two (idempotent re-enqueue); they now extract cleanly.
5. The matcher clusters extracted docs into ~80 loadouts. 74 auto-match (high `match_confidence`); 6 are
   `needs_review` (one duplicate certificate, two ambiguous date windows). The analyst resolves them in
   Data Review; `loadout_documents` rows are written, each document used exactly once.
6. The review is now ready for the calculation engine and the three result layers (sibling docs).

---

## 8. Open Questions

1. **Duplicate default action** — should an exact-checksum duplicate auto-skip extraction (current
   recommendation) or be hidden entirely from the batch view until requested? Confirm with reviewers.
2. **Queue technology** — `pgmq` on Supabase vs. an external queue (e.g. Upstash/QStash) for fan-out at
   the hundreds-of-files scale; needs a load test before locking.
3. **OCR engine** — managed (AWS Textract / Google Document AI) vs. self-hosted (Tesseract/PaddleOCR);
   trade-off cost vs. table-extraction quality on tank/meter certificates.
4. **Auto-match threshold** — the numeric `AUTO_MATCH_THRESHOLD` and key weights in §5.2 are
   placeholders; calibrate against a labelled sample of real Taylor loadouts.
5. **Cross-review documents** — policy when the same certificate legitimately appears in two overlapping
   reviews (checksum match across reviews) — share vs. duplicate the `cargo.documents` row?
6. **Confidence calibration** — mapping raw OCR/parser confidence to the `0..1` field confidence used by
   thresholds needs a defined calibration method.

## 9. Decisions Locked

1. The original document is **never discarded** — not on duplicate, failure, cancellation, or
   reprocess; `cargo.documents` rows are never deleted.
2. Bulk upload is **drag-and-drop, hundreds of files, resumable**, batched under a review via
   `cargo.import_batches`.
3. Duplicate detection uses a **SHA-256 checksum** on raw bytes, scoped to `(company_id, checksum)`.
4. **Never invent a value.** Missing/low-confidence fields get `status ∈ {missing,uncertain,
   needs_review}`; dependent calculations are not computed.
5. **Every extracted value retains source traceability** (document + page/table/cell/worksheet).
6. Extraction is **template-driven and versioned** per `(client_id, document_type)`, with
   `client_id NULL` fallback.
7. **Corrections are additive** (`cargo.field_corrections` = original+corrected+reason+user+timestamp);
   they improve future extraction of the same format and **never silently alter approved/published
   reviews**; reprocessing against a newer template produces new rows, never in-place overwrites.
8. A document maps to **at most one loadout** — enforced by the `cargo.loadout_documents.document_id`
   **unique** constraint (same for `cargo.hire_period_documents`).
9. Uncertain classifications and uncertain matches are **routed to human review**, never auto-committed.
10. Background extraction is a **queue-based, idempotent, resumable** state machine over
    `import_batches` / `documents` / `extracted_fields`, designed for Vercel/Supabase (short-lived
    functions, durable state in rows).

## 10. Cross-references

- `_CARGO-SPEC.md` — authoritative module spec (schema, principles, calculation invariants).
- `../_ARCHITECTURE-SPEC.md` — platform conventions (RLS, Storage, audit, tenancy).
- *cargo-calculation-engine.md* (planned) — three result layers, measurement comparison, drift waterfall.
- *fuel-data-review.md* (planned) — exception queue and spreadsheet review workspace.
- *fuel-loadout-reconstruction.md* (planned) — deeper loadout/hire-period reconstruction rules.
- *fuel-security.md* (planned) — `cargo.client_access`, RLS policies, client-portal isolation.
