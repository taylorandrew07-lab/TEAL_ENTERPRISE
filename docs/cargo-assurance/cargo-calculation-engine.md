# Cargo Calculation Engine

**TEAL Enterprise — Cargo Assurance Module**
Owning agent: Cargo Assurance Calculation-Engine Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This is the definitive technical reference for the numeric core of the Cargo Assurance module: how raw extracted evidence becomes three independently-computed result layers, how every measurement method is normalised and reconciled, and how a safe versioned rules engine evaluates client procedures and Taylor's corrected mass balance without ever running client-written code. Where `_CARGO-SPEC.md` states a calculation invariant (§7), this document implements it exactly and shows the arithmetic with worked numbers.

This document conforms to `_CARGO-SPEC.md` and `../_ARCHITECTURE-SPEC.md` and is authoritative on engine internals. It cross-references the sibling docs `cargo-data-model.md` (table DDL, RLS, enums) and `cargo-aggregation-and-analytics.md` (period roll-up, meter bias, findings) by filename throughout.

---

## 1. Scope and the invariants that matter

The engine exists to guarantee one thing above all: **raw evidence is never overwritten, and every number we publish can be traced back to a document and reproduced from a pinned methodology version.** Everything below serves the non-negotiable principles in `_CARGO-SPEC.md` §4 and the calculation invariants in `_CARGO-SPEC.md` §7.

The engine has exactly four jobs:

1. **Normalise** each raw extracted reading into canonical units, preserving the original separately (`_CARGO-SPEC.md` §7 units rule; §4.1).
2. **Calculate** a quantity for each measurement method using a versioned formula (`loadout_measurements`).
3. **Reconcile** each loadout into **three result layers** — raw evidence, client-procedure result, Taylor-corrected reconciliation result (`loadout_results`).
4. **Compare** methods and reconcile hire periods, emitting variances with one fixed sign convention (`_CARGO-SPEC.md` §7).

The engine never invents a missing value (`_CARGO-SPEC.md` §4.2). When temperature, density, a totalizer reading, or a transfer document is absent, the affected number is marked missing/uncertain and a `cargo.data_exceptions` row is raised — it is **not** filled with an assumption.

### 1.1 Decision locked: the engine is deterministic and pure

Given (a) the set of `cargo.extracted_fields` for a loadout, (b) a pinned `client_procedures` version, and (c) a pinned `calculation_methodologies` version, the engine produces **byte-identical** `loadout_results` and `loadout_measurements` every time. No wall-clock, no randomness, no network, no floating-point accumulation order ambiguity (we evaluate over `numeric`, never binary `float`). This is what makes `review_snapshots` reproducible (`_CARGO-SPEC.md` §4.7).

---

## 2. The three result layers

Per `_CARGO-SPEC.md` §4.4 every loadout carries three layers, stored as three rows in `cargo.loadout_results` keyed by `layer enum[raw_evidence, client_procedure, taylor_corrected]`. The layers are **computed independently from the same evidence** and stored side by side; later layers never mutate earlier ones.

| Layer | `layer` value | What it answers | Source of logic |
| --- | --- | --- | --- |
| Raw evidence | `raw_evidence` | "What did the certificates literally record?" | The extracted/normalised readings, summed verbatim. No reclassification, no transfer netting. |
| Client procedure | `client_procedure` | "What number does the client's own reporting methodology produce?" | Pinned `cargo.client_procedures.config` rules. |
| Taylor corrected | `taylor_corrected` | "What is the defensible vessel receipt by mass balance?" | Pinned `cargo.calculation_methodologies.formula_rules`. |

Each row stores `quantity`, `unit`, `basis` (e.g. `gross_observed`, `std_at_15c`), a `details jsonb` audit trail (which readings/adjustments fed it and which rule fired), and `methodology_version` (the pinned version for that layer). The `details` blob is what makes every difference between layers **traceable and explainable** (`_CARGO-SPEC.md` §4.4).

### 2.1 Why three rows, not one row with three columns

Three rows means each layer carries its **own** `basis`, `unit`, `methodology_version`, and `details`. The client procedure might report on a gross-observed basis while Taylor corrects to standard volume at 15 °C; those are different `basis` values and must not be coerced into one row's single unit. It also means a layer can be **absent** (e.g. the client procedure cannot be computed because a required document is missing) without nulling columns that belong to a different layer — absence is a missing row plus a `data_exceptions` entry, which is honest.

### 2.2 Worked example — the three layers on one loadout

A single receiving tank, vessel sounding certificate, product MGO.

- Opening sounding → `opening_quantity` = 220.0 m³; closing → `closing_quantity` = 512.4 m³.
- The vessel also has a **non-receiving** day tank that drew down 0.4 m³ during the loadout (worked in §5.2).
- Shore meter reported delivery 295.0 m³; shore tank inventory drop 296.1 m³.

The three layers for the *vessel receipt* are:

- **Raw evidence** = Σ(closing − opening) over **all** tanks read, exactly as recorded:
  receiving (512.4 − 220.0 = +292.4) + day tank (16.6 − 17.0 = −0.4) = **292.0 m³**.
- **Client procedure** (config: "sum all tank deltas, no reclassification") = **292.0 m³** — identical here, because this client's procedure does not reclassify the day-tank draw-down. The −0.4 is *absorbed into the reported receipt as an apparent loss*.
- **Taylor corrected** (mass balance: non-receiving tank delta is a procedural effect, not a receipt) = receiving tank only, corrected receipt = **292.4 m³**.

The **procedural effect** is `taylor_corrected − client_procedure = 292.4 − 292.0 = +0.4 m³` for this loadout — the client procedure understates the true receipt by 0.4 m³ because it let a day-tank consumption masquerade as a delivery shortfall. This is exactly the spec's worked case (§5.2) and feeds the procedural-drift aggregation in `cargo-aggregation-and-analytics.md`.

All three numbers are stored. Raw evidence (292.0) is **never** overwritten by the corrected figure (292.4).

---

## 3. The safe, versioned rules engine

`_CARGO-SPEC.md` §4.6 forbids arbitrary client-written code. The engine is therefore a **declarative, interpreted rule-tree evaluator** over a whitelisted operation set. There is no `eval`, no `Function()`, no template execution, no SQL string interpolation of config, and no plugin loading.

### 3.1 Where rules live and how they are pinned

- **Client reporting methodology** → `cargo.client_procedures(config jsonb, version int, status enum[draft,active,archived])`. The pair `(client_id, version)` identifies a pinned template (`_CARGO-SPEC.md` §6).
- **Taylor corrected methodology** → `cargo.calculation_methodologies(formula_rules jsonb, version int, status)`.
- A review pins both: `cargo.assurance_reviews.procedure_id` and `.methodology_id` reference the **exact** rows used. Because rows are versioned and `active`/`archived` rather than edited in place, re-running a historical review re-reads the very same config (`_CARGO-SPEC.md` §4.5, §4.7). Each `loadout_results` row also stamps `methodology_version` so the provenance survives even if the review pointer is later repointed by a correction (which creates a new review version, never a silent change).

### 3.2 The rule-tree model (declarative AST, not code)

`formula_rules` / `config` hold a JSON expression tree. Every node is one of a **fixed, whitelisted** set of node types. The evaluator is a recursive interpreter with no escape hatch.

Allowed node kinds:

| Kind | Shape | Meaning |
| --- | --- | --- |
| `const` | `{ "const": 1.05 }` | A literal `numeric`. |
| `ref` | `{ "ref": "tank.closing_quantity" }` | A named, **whitelisted** input from the loadout's normalised reading set. Unknown refs are a config validation error, not a runtime surprise. |
| `op` | `{ "op": "sub", "args": [a, b] }` | Whitelisted binary/n-ary arithmetic: `add, sub, mul, div, neg, sum, min, max, abs, round`. `div` by zero → result marked `indeterminate`, raises `data_exceptions.indeterminate_formula`; never a crash, never a NaN. |
| `convert` | `{ "convert": a, "from": "bbl", "to": "m3" }` | Unit conversion via the §6 factor table only. |
| `filter` | `{ "filter": "tanks", "where": { "role": "receiving" } }` | Selects the subset of readings by whitelisted attribute equality. |
| `when` | `{ "when": cond, "then": a, "else": b }` | Branch on a whitelisted comparison (`eq, ne, gt, gte, lt, lte, present, absent`). |
| `classify` | `{ "classify": "consumption", "evidence": "fueltrax" }` | Emits a typed adjustment with a `supported_by` source, never a bare number. |

There are no loops, no recursion the author can introduce, no variable assignment, no string concatenation that reaches SQL, and no I/O. Worst case runtime is bounded by tree size, which is bounded by the config row. This is the "interpreted rule trees, not eval" the spec demands.

### 3.3 Evaluation, safety, and testing

- **Validation at save time.** When a `client_procedures` or `calculation_methodologies` row is created/edited (in `draft`), the tree is validated: every `ref` resolves to a known input key, every `op`/`convert`/comparison is in the whitelist, every `convert` uses a known unit pair, and the tree type-checks (a `numeric` tree returns `numeric`; a `classify` returns an adjustment). Validation failure blocks activation.
- **Evaluation.** The interpreter walks the tree against the loadout's normalised reading set, accumulating in `numeric`. Any `div`-by-zero, missing required `ref`, or unknown unit yields an `indeterminate` result + a `data_exceptions` row, never an exception that aborts the batch.
- **No arbitrary code, restated.** A client cannot supply Python/JS/SQL. They (or a Taylor analyst on their behalf) compose a tree from the whitelist via the Clients & Procedures UI. The engine cannot be made to do anything outside the whitelist.
- **Testing.** Every shipped methodology version has a golden-fixtures test: known inputs → expected `loadout_results`. The cross-cutting `../testing-strategy.md` regime applies; a methodology cannot be set `active` without passing its fixtures. Changing a formula = a **new version**, with its own fixtures, never an in-place edit of an `active` row.

### 3.4 Worked example — a procedure rule tree

Client procedure "sum receiving-tank gross deltas, report in bbl":

```json
{
  "convert": {
    "op": "sum",
    "args": [{
      "op": "sub",
      "args": [
        { "ref": "tank.closing_quantity" },
        { "ref": "tank.opening_quantity" }
      ],
      "over": { "filter": "tanks", "where": { "role": "receiving" } }
    }]
  },
  "from": "m3", "to": "bbl"
}
```

On the §2.2 data: receiving delta = 292.4 m³; `convert m3→bbl` (×6.2898107) = **1839.15 bbl** (`details` stores both the 292.4 m³ intermediate and the factor used). The day tank is excluded because the `filter` restricts to `role = receiving`.

---

## 4. Measurement methods

Each method that observed a loadout gets one `cargo.loadout_measurements` row carrying `method cargo.measurement_method`, `raw_values jsonb`, `normalized_values jsonb`, `calculated_quantity`, `original_unit`, `converted_unit`, `formula`, `formula_version`, `source_document_id`, `confidence`, `included bool`, `exclusion_reason`. The methods are the spec's enum: `vessel_sounding, vessel_meter, shore_meter, shore_tank, fueltrax, client_reported, other` (`other` covers configurable additional methods).

### 4.1 Raw vs normalized vs calculated (the three numeric stages)

This three-stage discipline applies to **every** method and is the unit of traceability:

1. **Raw** (`raw_values`) — verbatim from the document: e.g. `{ "opening_totalizer": "0099840", "closing_totalizer": "0100135", "unit": "bbl", "temp_F": 86 }`. Preserved forever (`_CARGO-SPEC.md` §4.1).
2. **Normalized** (`normalized_values`) — the same facts in canonical units with provenance, e.g. `{ "opening": 99840.0, "closing": 100135.0, "unit": "bbl", "temp_c": 30.0 }`. Conversion is recorded, never destructive.
3. **Calculated** (`calculated_quantity`) — the single method result from the pinned `formula` at `formula_version`.

`source_document_id` ties the row to its certificate; `confidence` carries the extraction confidence forward; `included`/`exclusion_reason` let an analyst drop a method (e.g. an expired-calibration meter) from comparison without deleting evidence.

### 4.2 The method formulas

| Method | Formula (canonical) | Section |
| --- | --- | --- |
| `vessel_sounding` | Σ over tanks (closing_quantity − opening_quantity), classified by tank role | §5 |
| `vessel_meter` | (closing_totalizer − opening_totalizer ± rollover) × meter_factor, converted | §6 |
| `shore_meter` | same totalizer formula, shore meter factor | §6 |
| `shore_tank` | opening_inventory − closing_inventory ± documented adjustments, temp/density corrected | §7 |
| `fueltrax` | normalised flow total from FuelTrax report | §4.3 |
| `client_reported` | the client's stated delivered figure, verbatim | §4.3 |
| `other` | configurable rule tree (§3) | §3 |

### 4.3 FuelTrax and client-reported

`fueltrax` is an independent automated flow record; we normalise its total and carry its `confidence`, treating it as a candidate **reference method** for the comparison engine (§8) because it is independent of both vessel and shore. `client_reported` is the figure the client states they delivered/received — stored verbatim, never edited, and used in the **claimed-over-received** comparison (§8.2). Neither is allowed to overwrite a measured method.

---

## 5. Tank classification and logic

Each `cargo.loadout_tank_readings` row carries `tank_role cargo.tank_role` ∈ `receiving, non_receiving, day_service, settling, transfer, excluded`, plus `received_flag bool`. The per-loadout role can differ from the tank's `vessel_tanks.default_role`, so role is stored **on the reading**, not just the tank (`_CARGO-SPEC.md` §6).

The reading stores three reconciled deltas, exactly as the spec names them:
`raw_difference` (evidence), `corrected_receipt_difference` (mass-balance contribution), and `procedural_effect` (the gap the client procedure would mis-book).

| Role | Counts toward corrected receipt? | Rule |
| --- | --- | --- |
| `receiving` | Yes | Full delta is receipt. |
| `non_receiving` | No (unless documented transfer) | `corrected_receipt_difference = 0`; delta becomes `procedural_effect` (§5.2). |
| `day_service` | No | Reductions are **consumption**, classified with evidence (§5.3); never a delivery shortage. |
| `settling` | No | Like day/service for reconciliation; movements are internal. |
| `transfer` | Nets to zero | Internal transfers must net to zero across affected tanks (§5.4). |
| `excluded` | No | Out of scope for this loadout; evidence retained, contributes nothing. |

### 5.1 The three deltas, defined

For any tank reading:

- `raw_difference = closing_quantity − opening_quantity` (signed; the evidence, always stored).
- `corrected_receipt_difference` = the amount this tank legitimately contributes to the **Taylor corrected** vessel receipt (0 for non-receiving without a documented transfer).
- `procedural_effect = raw_difference − corrected_receipt_difference` *as it flows into the client procedure*, i.e. the quantity by which the client procedure mis-attributes this tank's movement. Aggregated across the loadout and the period, this is the procedural drift.

### 5.2 Non-receiving tank — the spec's worked example

A non-receiving day tank during a delivery: opening sounding equivalent 17.0 m³, closing 16.6 m³.

- `raw_difference = 16.6 − 17.0 = −0.4 m³` (stored as raw evidence — the tank genuinely dropped 0.4 m³).
- The tank is **not receiving** product and there is **no documented transfer into or out of it**, so per `_CARGO-SPEC.md` §7 `corrected_receipt_difference = 0.0 m³`. The 0.4 m³ drop is the engine running its consumption, not a delivery shortfall.
- `procedural_effect = −0.4 m³` — the client procedure, by summing every tank delta, books this as if 0.4 m³ of delivered fuel went missing.

Stored row (the spec's exact figures): `raw_difference = −0.4`, `corrected_receipt_difference = 0.0`, `procedural_effect = −0.4`, `explanation = "non-receiving day tank; 0.4 m³ consumed during loadout, no documented transfer"`.

**Aggregation across the period.** Suppose over a 6-month review this same pattern recurs on 84 of 120 loadouts, each with a non-receiving-tank procedural effect between −0.2 and −0.6 m³. We **never sum the percentages**; we sum the quantities: Σ procedural_effect = −38.7 m³ across the period. That −38.7 m³ is *recurring directional* procedural drift — the client's method systematically understates received fuel by ~0.46 m³/loadout. `cargo-aggregation-and-analytics.md` turns this into a `findings.category = 'procedural_effect'` finding with `sample_size = 84`, using neutral, defensible language (`_CARGO-SPEC.md` §4.9) — it describes a procedural effect, it does not allege loss.

### 5.3 Day/service tank consumption logic

A reduction in a day/service or settling tank is **consumption**, never automatically a delivery shortage (`_CARGO-SPEC.md` §7). Each is written to `cargo.consumption_records` with `classification enum[documented, estimated, unsupported, unexplained]` and a `source enum[fueltrax, engine_log, duration_rate, client_approved, other]`:

| Classification | Trigger | Treatment |
| --- | --- | --- |
| `documented` | Backed by FuelTrax / engine log / client-approved figure | Used as a verified adjustment. |
| `estimated` | Derived (e.g. duration × consumption rate) | Used **only** as an estimate, flagged as such — **never presented as measured** (`_CARGO-SPEC.md` §4.2). |
| `unsupported` | A reduction with no evidence at all | Recorded, flagged, excluded from verified figures. |
| `unexplained` | A movement we cannot account for | Recorded, surfaced as a `data_exception`, kept out of verified consumption. |

Worked example: day tank drops 0.4 m³. FuelTrax shows 0.39 m³ burned over the loadout window → `classification = documented`, `source = fueltrax`, quantity 0.39, residual 0.01 m³ flagged `unexplained`. Had there been no FuelTrax, the same 0.4 m³ would be `unsupported` — recorded and flagged, but **not** silently treated as a measured delivery loss.

### 5.4 Internal transfers net to zero

A documented transfer from tank A to tank B is one `cargo.internal_transfers(from_tank_id, to_tank_id, quantity, matched)` row. The invariant (`_CARGO-SPEC.md` §7): across the affected tanks the transfer contributes **0** to the vessel receipt — what leaves A enters B.

Worked check: 12.5 m³ moved A→B. A's reading shows −12.5, B's shows +12.5; the transfer row carries `quantity = 12.5`, `matched = true`. Net vessel contribution = −12.5 + 12.5 = **0.0 m³**. If only one side is documented (say A −12.5 but no matching B receipt and no transfer doc), `matched = false`, the engine raises `data_exceptions.undocumented_transfer`, and the unmatched leg is **not** netted away — it becomes an unexplained movement, not a silent zero.

---

## 6. Meter calculation (vessel meter / shore meter)

Both `vessel_meter` and `shore_meter` use the same totalizer arithmetic; the physical meter is tracked in `cargo.meters` (with `calibration_factor`, `calibration_date`, `replaced_by_meter_id`) so bias can be analysed per device in `cargo-aggregation-and-analytics.md`.

### 6.1 The formula

```
gross_qty   = (closing_totalizer − opening_totalizer + rollover_adjustment) × meter_factor
net_qty     = unit_convert(gross_qty)              then optional temp/density → std volume (§7.3)
```

- **Meter factor.** `meter_factor = calibration_factor` from the `cargo.meters` row effective on the loadout date. If `calibration_date` is older than the procedure's calibration validity window, raise `data_exceptions.expired_calibration`; the measurement is computed but may be `included = false` pending review (`_CARGO-SPEC.md` §4.2 — flagged, not silently trusted).
- **Rollover.** If `closing_totalizer < opening_totalizer`, the totalizer wrapped. `rollover_adjustment = modulus` where `modulus` is the meter's digit capacity (e.g. `1e6` for a 6-digit register), applied **only** when a rollover is documented or the digit-width is known. An unexplained decrease without a known modulus is an exception, not an assumed wrap.
- **Units.** Totalizers may be in bbl, m³, L, or US gal; convert with the §6.4 factor table and store both `original_unit` and `converted_unit`.

### 6.2 Worked example — vessel meter with rollover and factor

6-digit register (`modulus = 1 000 000`), `meter_factor = 1.0025`, reading in bbl.

- Opening totalizer = 999 600; closing = 000 295 (it wrapped).
- `rollover_adjustment = 1 000 000`.
- `gross_qty = (000 295 − 999 600 + 1 000 000) × 1.0025 = (695) × 1.0025 = 696.74 bbl`.
- Convert bbl→m³ (÷6.2898107) = **110.77 m³** (stored `original_unit = bbl`, `converted_unit = m3`).

Without the documented 6-digit modulus, `(295 − 999 600)` would be hugely negative → the engine refuses to guess, marks `indeterminate`, and raises `invalid_sequence`.

### 6.3 Calibration and meter identity

The `cargo.meters.physical_id` plus `replaced_by_meter_id` chain lets a meter be swapped mid-period while preserving per-device history. A loadout's measurement records which physical meter produced it (via `source_document_id` → calibration certificate where present), so `cargo.meter_analytics` can compute per-meter mean/median/weighted variance and `same_direction_pct` (persistent bias) downstream.

### 6.4 Conversion factors (canonical)

| From → To | Factor | Note |
| --- | --- | --- |
| bbl → m³ | × 0.158987295 | 1 US barrel = 0.158987295 m³ |
| m³ → bbl | × 6.2898107 | inverse |
| US gal → m³ | × 0.0037854118 | |
| L → m³ | × 0.001 | |
| °F → °C | (°F − 32) × 5/9 | |

Factors are constants in the engine, version-stamped with the methodology; they are **not** client-editable config (a barrel is a barrel).

---

## 7. Shore tank calculation and standard-volume support

### 7.1 Shore tank formula

```
delivery = (opening_inventory − closing_inventory)
           ± documented_receipts/withdrawals/returns/transfers
           ± temperature/density corrections (→ std volume)
```

(`_CARGO-SPEC.md` §7: shore delivery = opening inventory − closing inventory, adjusted for documented movements and temp/density.)

Worked example: shore tank opening 8 420.0 m³, closing 8 123.9 m³ → gross drop 296.1 m³. A documented 1.2 m³ return into the tank during the window is **added back** (it was not part of this delivery): `delivery = 296.1 − 1.2 = 294.9 m³`. Each adjustment is a `cargo.loadout_adjustments` row with `supported_by = documented_transfer` and an `evidence_document_id`. An *undocumented* inventory movement is **not** adjusted away — it is flagged.

### 7.2 Units and standard volume (preserve original + conversions separately)

The reading row supports `temperature`, `density`, `api_gravity`, and `std_volume_basis enum[none, at_15c, at_60f]` (`_CARGO-SPEC.md` §6). Rules (`_CARGO-SPEC.md` §7 units):

- **Preserve original.** The observed (gross) volume in its source unit and the observed temperature/density are stored verbatim; the standard-volume figure is stored **separately** alongside, never replacing the original.
- **Never assume.** If a certificate gives volume but **no** temperature or density, the engine does **not** invent a VCF or apply `products.default_density`. It records `std_volume_basis = none`, marks the figure gross-observed only, and raises `low_confidence`/an exception so a human decides. A default density from `cargo.products` may be *offered* in the UI but is never silently applied to evidence.

### 7.3 Standard-volume worked example

Gross observed 296.1 m³ at 30.0 °C, density 0.8350 kg/L (MGO). Correcting to standard volume @15 °C with the procedure's pinned volume-correction rule (VCF = 0.9890 for this product/temperature):

```
std_volume@15c = 296.1 × 0.9890 = 292.84 m³
```

Stored: `temperature = 30.0`, `density = 0.8350`, `std_volume_basis = at_15c`, gross 296.1 **and** std 292.84 both retained. If temperature were missing, none of this runs — we keep 296.1 gross and flag it.

### 7.4 General vessel mass balance (the reconciliation anchor)

The Taylor-corrected vessel receipt for a loadout is the spec's mass balance (`_CARGO-SPEC.md` §7):

```
received = ending_inventory − starting_inventory
           + consumption
           + external_discharged
           − other_external_received
           (internal transfers net to zero)
```

Worked example for the §2.2 loadout:

- ending − starting (receiving tank) = 512.4 − 220.0 = **+292.4**
- consumption (day tank, documented) = **+0.39** (it burned fuel that we received-and-consumed; added back because the ending inventory is lower by that burn)
- external_discharged = 0; other_external_received = 0; internal transfers net to 0.
- `received = 292.4 + 0.39 + 0 − 0 = 292.79 m³` Taylor-corrected receipt when day-tank consumption is folded in.

When the day-tank consumption is **not** documented, the engine reports the **verified** receipt (292.4 m³, receiving tank only) and flags the 0.4 m³ as `unsupported` — it does **not** inflate the receipt with an unverified burn. This is the §4.2 / §7 honesty rule made concrete.

---

## 8. Comparison engine

Every method result (§4) and the corrected receipt (§7.4) becomes a comparable quantity. The comparison engine measures how far each method sits from a **configurable reference method** and emits the three named differences from `_CARGO-SPEC.md` §7.

### 8.1 Variance, variance %, and the one sign convention

```
variance    = comparison_method − reference_method
variance_%  = (comparison_method − reference_method) / reference_method × 100
```

**Sign convention, stated everywhere it appears (`_CARGO-SPEC.md` §7): positive ⇒ the comparison method reports MORE than the reference.** The reference method is configurable per procedure/review (`config`/review setting); no method is hard-coded as absolute truth. Percentages are **never summed** across loadouts — cumulative figures come from aggregated quantities or correctly weighted averages (`_CARGO-SPEC.md` §7), handled in `cargo-aggregation-and-analytics.md`.

### 8.2 The three named comparisons

| Name | Formula (`_CARGO-SPEC.md` §7) | Meaning |
| --- | --- | --- |
| Claimed-over-received | `shore_reported_delivery − Taylor_corrected_vessel_receipt` | How much more the shore side claimed it delivered than the vessel defensibly received. |
| Procedural apparent loss | `Taylor_corrected_vessel_result − client_procedure_result` | The loss the client's *method* manufactures vs Taylor's corrected result. |
| Unexplained residual | `Taylor_corrected_vessel_receipt − selected_independent_reference` | Residual gap vs an independent method (e.g. FuelTrax/shore meter) after correction. |

### 8.3 Worked comparison

Using §2.2/§7.4 numbers, reference method = FuelTrax independent total = 291.8 m³:

- Shore reported delivery (client_reported) = 295.0; Taylor corrected receipt (verified) = 292.4.
  **Claimed-over-received** = 295.0 − 292.4 = **+2.6 m³** (shore claimed 2.6 m³ more than the vessel received).
- Taylor corrected result 292.4; client procedure result 292.0.
  **Procedural apparent loss** = 292.4 − 292.0 = **+0.4 m³** (the client method shows a 0.4 m³ loss that is purely procedural — the non-receiving-tank effect of §5.2).
- Taylor corrected receipt 292.4; independent FuelTrax reference 291.8.
  **Unexplained residual** = 292.4 − 291.8 = **+0.6 m³** (`variance_% = 0.6 / 291.8 × 100 = +0.206 %`), genuinely unexplained and flagged for a finding.

Note the decomposition: the +2.6 claimed-over-received splits into a +0.4 procedural component the client's own method created and a +0.6 residual vs the independent reference, with the remainder explained by measurement basis. Each piece is traceable to a stored row.

---

## 9. Hire-period (on/off-hire) reconciliation

Hire-period reconciliation is a **separate** balance from loadout reconciliation, computed **per fuel grade** and stored in `cargo.hire_period_results` (one row per `product_id`). Boundary soundings live in `cargo.hire_tank_readings(boundary enum[on_hire, off_hire], …)`.

### 9.1 The hire balance

Exactly the spec formula (`_CARGO-SPEC.md` §7), with columns matching `cargo.hire_period_results`:

```
expected_off_hire_rob = on_hire_rob
                      + fuel_received
                      − verified_consumption
                      − external_discharged
                      + other_adjustments

hire_variance         = actual_off_hire_rob − expected_off_hire_rob
```

**Sign convention: positive hire_variance ⇒ MORE ROB on board than expected.** Negative ⇒ less ROB than the balance predicts.

`unexplained_residual` captures the portion of the variance not attributable to any documented adjustment; `data_quality jsonb` records which inputs were verified vs missing.

### 9.2 The incomplete-evidence rule (critical)

Per `_CARGO-SPEC.md` §7: **if consumption or transfer evidence is unavailable, show only the verified on-hire → off-hire change; do NOT infer an unexplained loss from incomplete information.** Operationally:

- If `verified_consumption` cannot be established (no engine log, no FuelTrax, no client-approved figure), the engine does **not** plug it with an estimate inside `expected_off_hire_rob`. Instead it reports the **verified delta** `actual_off_hire_rob − on_hire_rob` (and `fuel_received` if documented) and leaves consumption marked unverified in `data_quality`. No "loss" number is fabricated.
- An `estimated` consumption (duration × rate) may be shown **labelled as an estimate** for context, but never folded into `verified_consumption` nor presented as the measured result (`_CARGO-SPEC.md` §4.2).

### 9.3 The hire-period waterfall

The waterfall (rendered in `cargo-aggregation-and-analytics.md`) walks the balance per grade:

```
on_hire_rob
  + fuel_received
  − verified_consumption
  − external_discharged
  + other_adjustments
  = expected_off_hire_rob
  vs actual_off_hire_rob  → hire_variance (→ unexplained_residual)
```

### 9.4 Tank-by-tank worked example (per grade: MGO)

On-hire boundary soundings (sum to `on_hire_rob`) and off-hire boundary soundings (sum to `actual_off_hire_rob`):

| Tank | On-hire ROB (m³) | Off-hire ROB (m³) |
| --- | --- | --- |
| Port main | 180.0 | 96.0 |
| Stbd main | 180.0 | 102.0 |
| Day tank | 12.0 | 11.5 |
| **Total** | **372.0** | **209.5** |

Documented during the hire period: `fuel_received` = 0 (no bunkering), `external_discharged` = 0, `other_adjustments` = 0. Verified consumption from engine logs = 160.0 m³.

- `on_hire_rob = 372.0`; `actual_off_hire_rob = 209.5`.
- `expected_off_hire_rob = 372.0 + 0 − 160.0 − 0 + 0 = 212.0 m³`.
- `hire_variance = 209.5 − 212.0 = −2.5 m³` (positive convention: this is **2.5 m³ less ROB than expected**).
- `unexplained_residual = −2.5 m³`, surfaced as a finding (`reconciliation_gap`) with `data_quality` noting consumption was engine-log-verified.

**Now the incomplete-evidence path.** Suppose engine logs were missing, so `verified_consumption` is unknown. The engine does **not** compute the −2.5 above. It reports only the **verified change**: `actual_off_hire_rob − on_hire_rob = 209.5 − 372.0 = −162.5 m³` net reduction over the hire period, with `verified_consumption` flagged unverified in `data_quality` and **no** loss inferred. A duration-based estimate (say 161 m³) may be displayed labelled "estimate", never as the result.

### 9.5 Comparison vs loadout reconciliation

| Aspect | Loadout reconciliation (§2–§8) | Hire-period reconciliation (§9) |
| --- | --- | --- |
| Question | "Did the vessel receive what shore claims it delivered?" | "Does off-hire ROB match the on-hire balance for this charter?" |
| Boundary | A single delivery event | On-hire → off-hire window |
| Per grade? | Per loadout/product | **Per fuel grade**, one `hire_period_results` row each |
| Anchor formula | Mass balance (§7.4) | Hire balance (§9.1) |
| Shared discipline | Three layers, never overwrite evidence, never invent values, one sign convention | identical |

The two are stored separately (`loadout_results` vs `hire_period_results`) and reconciled independently; the aggregation doc may relate them (e.g. loadout receipts that fall inside a hire window feed `fuel_received`), but neither overwrites the other.

---

## 10. Open Questions

1. **Volume-correction tables.** Should VCFs (e.g. ASTM D1250 / API 11.1) be a versioned reference table inside the methodology, a per-product configuration, or an external standard pinned by version? §7.3 assumes a pinned VCF rule; the exact table provenance needs a decision in `cargo-data-model.md`.
2. **Reference-method default.** §8.1 makes the reference method configurable. Should the platform ship a sensible default (e.g. prefer FuelTrax > shore meter > shore tank when present), or always force an explicit choice per procedure?
3. **Confidence propagation.** How should per-field extraction `confidence` combine into a method-level and loadout-level confidence (min? weighted?) for the comparison engine's inclusion decisions? Proposed: conservative `min` with an analyst override.
4. **Rollover modulus source.** §6.1 needs the meter digit-width recorded on `cargo.meters` (or its calibration cert) so rollovers are documented rather than inferred. Confirm the column lives in the data model.
5. **Estimated-consumption display.** §5.3/§9.2 allow showing labelled estimates for context. Confirm the UI/report convention that visually and textually separates estimate from measured so it can never be mistaken (owned with `ui-workflows.md`).

## 11. Decisions Locked

1. **Three result layers, stored as three `cargo.loadout_results` rows** (`raw_evidence`, `client_procedure`, `taylor_corrected`), each with its own `basis`, `unit`, `methodology_version`, `details`. Raw evidence is never overwritten; every inter-layer difference is traceable via `details`. (`_CARGO-SPEC.md` §4.4)
2. **No arbitrary client code.** Formulas are a whitelisted, interpreted **rule-tree AST** in `client_procedures.config` / `calculation_methodologies.formula_rules` — no `eval`, no plugins. Validated at save, golden-fixture tested before `active`. (`_CARGO-SPEC.md` §4.6)
3. **Versions are pinned, never edited in place.** A review pins `procedure_id` + `methodology_id`; each result row stamps `methodology_version`; changing a formula creates a new version. (`_CARGO-SPEC.md` §4.5, §4.7)
4. **Every method runs raw → normalized → calculated**, preserving original units and source document; methods can be `included = false` without deleting evidence. (`_CARGO-SPEC.md` §4.1)
5. **Tank role drives reconciliation.** Non-receiving tanks contribute `corrected_receipt_difference = 0` unless a documented transfer exists; the delta is a `procedural_effect`; day/service reductions are classified consumption, never delivery shortage; internal transfers net to zero. (`_CARGO-SPEC.md` §7) — worked at 17.0 → 16.6 m³ ⇒ raw −0.4, corrected 0.0, procedural −0.4.
6. **Meter qty = (closing − opening ± rollover) × factor**, with documented modulus and calibration validity; unexplained sequences are exceptions, not guesses. **Shore delivery = opening − closing ± documented adjustments**, temp/density to std volume only when supported. (`_CARGO-SPEC.md` §7)
7. **Mass balance is the corrected anchor:** received = ending − starting + consumption + external_discharged − other_external_received; internal transfers net to zero. (`_CARGO-SPEC.md` §7)
8. **One sign convention everywhere:** `variance = comparison − reference`, positive ⇒ comparison reports more. Reference method configurable; percentages never summed. Claimed-over-received, procedural apparent loss, and unexplained residual computed by the §7 formulas. (`_CARGO-SPEC.md` §7)
9. **Hire balance:** `expected_off_hire_rob = on_hire_rob + fuel_received − verified_consumption − external_discharged + other_adjustments`; `hire_variance = actual − expected` (positive ⇒ more ROB than expected); per fuel grade. With incomplete evidence, only the verified on→off change is shown — **no inferred loss.** (`_CARGO-SPEC.md` §7)
10. **Never invent a value.** Missing temperature/density/totalizer/transfer ⇒ flagged exception, never an assumed default silently applied. Estimates are labelled estimates, never measured facts. (`_CARGO-SPEC.md` §4.2)

---

*Cross-references: `_CARGO-SPEC.md` (authoritative module spec), `../_ARCHITECTURE-SPEC.md` (platform core), `cargo-data-model.md` (table DDL, enums, RLS, the columns this engine reads and writes), `cargo-aggregation-and-analytics.md` (period roll-up, meter bias, waterfalls, findings).*
