# Cargo Aggregation & Analytics

**TEAL Enterprise — Cargo Assurance Module**
Owning agent: Cargo Assurance Aggregation & Analytics Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This is the definitive technical reference for how the Cargo Assurance module turns hundreds of individually reconstructed loadouts (and their hire-period siblings) into period-level totals, meter/terminal bias analytics, vessel comparisons, procedural-drift decompositions, and neutral, defensible findings. It specifies every aggregate metric in `_CARGO-SPEC.md`, the exact SQL/pseudocode that derives each one from the loadout/measurement/result/adjustment tables, and — above all — the *correct* weighted-percentage formulas, because **percentages are never summed** (`_CARGO-SPEC.md` §7).

This document conforms to `_CARGO-SPEC.md` (the authoritative module spec) and to `_ARCHITECTURE-SPEC.md` (the platform core). Where the fuel spec lists a metric or a `cargo.*` analytics table, this document is authoritative on *how it is computed* and *how it is materialized*. It does not introduce new schema; it consumes the canonical `cargo` schema in `_CARGO-SPEC.md` §6.

---

## 1. Scope and the one invariant that matters

The aggregation layer exists to guarantee one thing above all others: **an aggregate is only ever as true as the quantities it was built from, and it is never built by adding percentages.** Everything below — period totals, meter bias, drift waterfalls, hire-period rollups, findings — is in service of the calculation invariants in `_CARGO-SPEC.md` §7, of which the governing one for this layer is:

> **Percentages never summed.** Cumulative percentages are computed from aggregated quantities or correctly weighted averages.

A loadout's variance % is a *ratio of two quantities for that one loadout*. It is meaningless to average eighty-six such ratios with equal weight and call the result "the period variance %", because a 50 m³ loadout that is 4% off and a 5,000 m³ loadout that is 0.1% off do not deserve equal say in a portfolio figure. The portfolio figure is **Σ(comparison) − Σ(reference)) / Σ(reference)** — a ratio of *summed quantities*. The simple mean of the per-loadout percentages is a *separate, explicitly-labelled* statistic (it answers "how does a typical loadout behave?"), never the cumulative figure.

This single rule is repeated, in formula form, at every metric below. If a reader takes away nothing else: **sum the numerators and denominators in their native units first; divide last.**

### 1.1 The four inputs every aggregate reads

All aggregates are functions of four canonical layers, in unit-normalized form:

1. **Loadout headers** — `cargo.loadouts` (nominated, reported-delivered, product, vessel, terminal, status). Only `status = 'approved'` rows enter aggregates; `excluded`/`needs_review` are counted separately for data-completeness.
2. **Per-method measurements** — `cargo.loadout_measurements` (one row per measurement method per loadout: `vessel_sounding`, `vessel_meter`, `shore_meter`, `shore_tank`, `fueltrax`, `client_reported`), each with a normalized `calculated_quantity`, `converted_unit`, and `included` flag.
3. **The three result layers** — `cargo.loadout_results` (`raw_evidence`, `client_procedure`, `taylor_corrected`), each a single defensible quantity per loadout in a stated `basis`.
4. **Adjustments & tank readings** — `cargo.loadout_adjustments` (the drift-waterfall components) and `cargo.loadout_tank_readings` (`procedural_effect`, `corrected_receipt_difference`).

Reference vs comparison method is **configurable per procedure/review** (`_CARGO-SPEC.md` §7); the aggregation layer reads the selected reference from the review's pinned `cargo.client_procedures.measurement_methods` and never hard-codes one method as truth.

### 1.2 Unit normalization precedes all aggregation

You cannot sum m³ and bbl. Every quantity entering an aggregate is first reduced to the review's **aggregation unit** (set on the procedure; default m³ for volume, with a parallel mass/std-volume basis where the procedure requires it). Conversions are stored separately from raw values (`_CARGO-SPEC.md` §7, units); the aggregation reads the `converted_unit`/`normalized_value` and asserts they all share one unit, raising a `unit_mismatch` exception (`cargo.data_exceptions`) rather than silently coercing. Temperature/density-dependent conversions to std volume @15°C / @60°F are only applied where the source supports them; where it does not, the loadout is flagged and excluded from the std-volume aggregate (but may still appear in the gross-volume aggregate). **Never assume a temperature/density the source doesn't support.**

---

## 2. Period-level aggregation (`cargo.review_aggregates`)

This section specifies every period metric named in `_CARGO-SPEC.md`. Each is computed over the **approved** loadouts of one review (`cargo.assurance_reviews.id`), filtered to the review's `included_terminals`/`included_vessels`/`included_products`. The output is one `metrics jsonb` blob in `cargo.review_aggregates`, materialized at publish (§9), and a live `cargo.v_review_aggregates` view for draft/in-review browsing.

Throughout, let the approved loadout set be `L`, and for a loadout `i` let:
- `nom_i` = `nominated_quantity`
- `rep_i` = `reported_delivered_quantity` (shore-reported delivery)
- `cp_i` = client-procedure result quantity (`loadout_results.layer = 'client_procedure'`)
- `tc_i` = Taylor-corrected receipt (`loadout_results.layer = 'taylor_corrected'`)
- `ref_i` = the selected reference-method quantity for loadout `i`
- `cmp_i` = the selected comparison-method quantity for loadout `i`

### 2.1 Quantity totals (pure sums — the easy ones)

These are honest sums of like-united quantities. No percentage trap here, but unit normalization (§1.2) is mandatory.

| Metric | Formula | Source |
| --- | --- | --- |
| Total loadouts | `COUNT(*)` over `L` | `cargo.loadouts` |
| Total nominated | `Σ nom_i` | `cargo.loadouts.nominated_quantity` |
| Total reported delivery | `Σ rep_i` | `cargo.loadouts.reported_delivered_quantity` |
| Total client-procedure quantity | `Σ cp_i` | `loadout_results` (`client_procedure`) |
| Total Taylor corrected receipt | `Σ tc_i` | `loadout_results` (`taylor_corrected`) |
| Total FuelTrax | `Σ ft_i` | `loadout_measurements` (`method='fueltrax'`, `included`) |
| Total vessel-meter | `Σ vm_i` | `loadout_measurements` (`method='vessel_meter'`, `included`) |
| Total shore-meter | `Σ sm_i` | `loadout_measurements` (`method='shore_meter'`, `included`) |
| Total shore-tank | `Σ st_i` | `loadout_measurements` (`method='shore_tank'`, `included`) |

```sql
-- Period quantity totals, one row per review, unit-normalized to the review unit.
-- Method totals come from a pivot over loadout_measurements.
with mq as (
  select l.id as loadout_id,
         max(case when m.method='fueltrax'      and m.included then m.calculated_quantity end) as ft,
         max(case when m.method='vessel_meter'  and m.included then m.calculated_quantity end) as vm,
         max(case when m.method='shore_meter'   and m.included then m.calculated_quantity end) as sm,
         max(case when m.method='shore_tank'    and m.included then m.calculated_quantity end) as st
  from cargo.loadouts l
  left join cargo.loadout_measurements m on m.loadout_id = l.id
  where l.review_id = $1 and l.status = 'approved'
  group by l.id
),
res as (
  select l.id as loadout_id,
         max(r.quantity) filter (where r.layer='client_procedure') as cp,
         max(r.quantity) filter (where r.layer='taylor_corrected') as tc
  from cargo.loadouts l
  left join cargo.loadout_results r on r.loadout_id = l.id
  where l.review_id = $1 and l.status='approved'
  group by l.id
)
select count(*)                          as total_loadouts,
       sum(l.nominated_quantity)         as total_nominated,
       sum(l.reported_delivered_quantity)as total_reported_delivery,
       sum(res.cp)                       as total_client_procedure,
       sum(res.tc)                       as total_taylor_corrected,
       sum(mq.ft)                        as total_fueltrax,
       sum(mq.vm)                        as total_vessel_meter,
       sum(mq.sm)                        as total_shore_meter,
       sum(mq.st)                        as total_shore_tank
from cargo.loadouts l
join mq  on mq.loadout_id  = l.id
join res on res.loadout_id = l.id
where l.review_id = $1 and l.status='approved';
```

### 2.2 Documented consumption and non-receiving-tank procedural effect

Both are pure sums of signed quantities from the adjustment/tank layers, kept separate so the period report can show *what kind* of apparent loss is procedural rather than real.

- **Documented consumption** = `Σ` of `cargo.consumption_records.quantity` where `classification = 'documented'`, scoped to the review's loadouts (and, for hire periods, §6). Estimated/unsupported/unexplained consumption is summed into *separate* buckets and **never folded into the documented total** — presenting an estimate as documented violates `_CARGO-SPEC.md` §4.2.
- **Non-receiving-tank procedural effect** = `Σ cargo.loadout_tank_readings.procedural_effect` over tanks where `tank_role = 'non_receiving'` (and any other tank whose `received_flag = false`). By invariant (`_CARGO-SPEC.md` §7) a non-receiving tank's `corrected_receipt_difference = 0` unless a documented transfer occurred; its `raw_difference` is preserved as evidence and the delta lands in `procedural_effect`. This sum is exactly "how much apparent loss the client procedure would have booked that Taylor's method correctly attributes to a tank that never received product."

```sql
select
  (select coalesce(sum(c.quantity),0)
     from cargo.consumption_records c join cargo.loadouts l on l.id=c.loadout_id
     where l.review_id=$1 and l.status='approved' and c.classification='documented')
     as documented_consumption,
  (select coalesce(sum(tr.procedural_effect),0)
     from cargo.loadout_tank_readings tr join cargo.loadouts l on l.id=tr.loadout_id
     where l.review_id=$1 and l.status='approved'
       and (tr.tank_role='non_receiving' or tr.received_flag = false))
     as non_receiving_procedural_effect;
```

### 2.3 Explained vs unexplained variance (waterfall close-out)

For the period, the total apparent gap between what shore reported and what Taylor corrected for is decomposed into *explained* components (each backed by evidence) and an *unexplained residual* (everything left). This is the period-level sum of the per-loadout waterfall in §5.

- **Total apparent gap** = `Σ rep_i − Σ tc_i` (claimed-over-received, §2.4).
- **Total explained** = `Σ` over all `cargo.loadout_adjustments` whose `supported_by <> 'none'`, grouped by `type` (non-receiving tank, consumption, internal transfer, temperature/density conversion, meter correction). Internal transfers must net to zero across affected tanks (`_CARGO-SPEC.md` §7); a non-zero net is an `undocumented_transfer` exception, not an explanation.
- **Total unexplained** = `Total apparent gap − Total explained`. Equivalently `Σ (tc_i − ref_i)` against the selected independent reference per `_CARGO-SPEC.md` §7 (unexplained residual). The two routes must reconcile; if they differ beyond rounding tolerance, the review carries a reconciliation exception and is **not** publishable (§9.3).

```sql
-- Explained components by type; unexplained = apparent gap − Σ explained
with gap as (
  select sum(l.reported_delivered_quantity) - sum(r.tc) as apparent_gap
  from cargo.loadouts l
  join (select loadout_id, max(quantity) filter (where layer='taylor_corrected') tc
        from cargo.loadout_results group by loadout_id) r on r.loadout_id=l.id
  where l.review_id=$1 and l.status='approved'
),
expl as (
  select a.type, sum(a.quantity) as q
  from cargo.loadout_adjustments a join cargo.loadouts l on l.id=a.loadout_id
  where l.review_id=$1 and l.status='approved' and a.supported_by <> 'none'
  group by a.type
)
select (select apparent_gap from gap)                        as apparent_gap,
       coalesce((select sum(q) from expl),0)                 as total_explained,
       (select apparent_gap from gap) - coalesce((select sum(q) from expl),0)
                                                             as total_unexplained,
       (select jsonb_object_agg(type, q) from expl)          as explained_by_type;
```

### 2.4 Cumulative claimed-over-received

Per `_CARGO-SPEC.md` §7, **claimed-over-received = shore reported delivery − Taylor corrected vessel receipt**, at the loadout level. The cumulative figure is the sum of the *quantities*, not of any per-loadout percentage:

- **Cumulative claimed-over-received (quantity)** = `Σ (rep_i − tc_i) = Σ rep_i − Σ tc_i`.
- **Cumulative claimed-over-received (%)** = `(Σ rep_i − Σ tc_i) / Σ tc_i × 100` — a ratio of summed quantities. **Do not** compute `mean((rep_i − tc_i)/tc_i)` and call it cumulative.

### 2.5 Average and median variance % (the labelled distribution stats)

These describe the *distribution of per-loadout behaviour*, and are explicitly distinct from the cumulative ratio. Variance % per loadout follows the invariant: `var_pct_i = (cmp_i − ref_i)/ref_i × 100` (positive ⇒ comparison reports more).

- **Average (simple mean) variance %** = `(1/n) Σ var_pct_i`. This is a per-loadout average and is reported *next to*, never *instead of*, the weighted/cumulative figure.
- **Weighted-average variance %** (the defensible portfolio figure) = `Σ wᵢ·var_pct_i / Σ wᵢ` with weight `wᵢ = ref_i` (reference quantity). Algebraically this collapses to `Σ(cmp_i − ref_i)/Σ ref_i × 100`, i.e. it **equals the cumulative ratio** — which is exactly why the cumulative ratio is the correct portfolio number and the simple mean is not.
- **Median variance %** = the order-statistic median of `{var_pct_i}`. Robust to a few wild small-loadout ratios; reported as the typical-loadout figure alongside the mean.

```sql
-- Per-loadout variance %, then the three summary statistics in one pass.
with v as (
  select l.id,
         cmp.q  as cmp,
         ref.q  as ref,
         (cmp.q - ref.q) / nullif(ref.q,0) * 100.0 as var_pct
  from cargo.loadouts l
  join lateral (select quantity q from cargo.loadout_results
                where loadout_id=l.id and layer = $cmp_layer) cmp on true
  join lateral (select quantity q from cargo.loadout_results
                where loadout_id=l.id and layer = $ref_layer) ref on true
  where l.review_id=$1 and l.status='approved'
)
select avg(var_pct)                                            as mean_variance_pct,
       percentile_cont(0.5) within group (order by var_pct)    as median_variance_pct,
       -- weighted by reference quantity == cumulative ratio:
       sum(cmp - ref) / nullif(sum(ref),0) * 100.0             as weighted_variance_pct
from v;
```

> NOTE the `sum(cmp-ref)/sum(ref)` form. We never write `avg((cmp-ref)/ref)` for the cumulative/weighted figure. The two differ whenever loadout sizes differ, which is always.

### 2.6 % of loadouts biased the same direction

A directional-consistency measure: of the loadouts where the comparison is non-zero versus reference, what fraction lean the *same* way? This is a count ratio, computed from signs, not from magnitudes.

- Let `pos` = `#{i : var_pct_i > +ε}`, `neg` = `#{i : var_pct_i < −ε}`, where `ε` is the procedure's "material direction" deadband (ties/near-zero excluded so noise doesn't masquerade as bias).
- **% same-direction** = `max(pos, neg) / (pos + neg) × 100`, with the dominant direction reported (e.g. "73% of 86 loadouts show shore-reported > Taylor-corrected"). The denominator is the count of *directional* loadouts, not all loadouts.

### 2.7 # and % within tolerance

Tolerance comes from the pinned procedure (`cargo.client_procedures.tolerances`), expressed as an allowable `|variance %|` (and/or absolute) per product/method. A loadout is *within tolerance* if `|var_pct_i| ≤ tol`.

- **# within tolerance** = `#{i : |var_pct_i| ≤ tol_i}`.
- **% within tolerance** = `(# within tolerance) / n × 100` — a count ratio over the approved set.

This is reported with the tolerance value cited, because "94% within ±0.5%" and "94% within ±2%" are different claims.

### 2.8 Data completeness %

Measures how much of the *expected* evidence actually arrived and extracted cleanly — the honesty gauge that gates every strong conclusion (`_CARGO-SPEC.md` §4.9). It is a **quantity-or-count ratio, never a percentage average**.

- **Loadout-level completeness** = `(# approved loadouts with all required documents present & extracted) / (# expected loadouts) × 100`, where required documents come from `cargo.client_procedures.required_documents` and presence from `cargo.loadout_documents`.
- **Field-level completeness** = `(# extracted_fields with status='ok') / (# expected fields) × 100`, expected fields driven by the extraction template. Missing/uncertain/needs-review fields reduce the figure rather than being silently treated as present.
- A composite `data_completeness_pct` is reported plus a breakdown (documents present, fields ok, methods available per loadout). Every downstream finding carries the completeness figure as a limitation (§7).

```sql
select
  100.0 * count(*) filter (where ld.has_all_required) / nullif(count(*),0) as loadout_completeness_pct
from (
  select l.id,
         bool_and(req.present) as has_all_required
  from cargo.loadouts l
  join lateral (
    -- one row per required document type for this loadout's procedure
    select rd.value->>'type' as dtype,
           exists (select 1 from cargo.loadout_documents lx
                   join cargo.documents d on d.id=lx.document_id
                   where lx.loadout_id=l.id
                     and d.detected_document_type = (rd.value->>'type')::cargo.document_type
                     and d.extraction_status in ('extracted')) as present
    from cargo.client_procedures p
    cross join lateral jsonb_array_elements(p.required_documents) rd
    where p.id = (select procedure_id from cargo.assurance_reviews where id=$1)
  ) req on true
  where l.review_id=$1 and l.status in ('approved','needs_review')
  group by l.id
) ld;
```

### 2.9 Estimated financial exposure (optional)

Per `_CARGO-SPEC.md` §8 this is optional and uses the review's `reporting_currency`. It is a *defensible, clearly-bounded* figure, never presented as an established loss:

- **Estimated exposure** = `unexplained_residual_quantity × unit_price`, where `unit_price` is a documented, sourced price for the product over the period (from procedure config or a client-approved reference), in `reporting_currency`.
- Reported as a **range** when the residual or price has uncertainty, with the price source cited, and **omitted entirely** when `reporting_currency` is null or no defensible price exists. It is tagged as estimated and excluded from any "documented" total. Designed-for, not depended-on, the future Accounting link (`_CARGO-SPEC.md` §8): the figure reuses `core.clients`/`reporting_currency` so a later credit/shortage-claim flow is natural.

---

## 3. Terminal & meter bias analytics (`cargo.meter_analytics`)

Per `_CARGO-SPEC.md` §6, **physical meters are tracked independently** (`cargo.meters`, with `physical_id`, `calibration_factor`, `calibration_date`, `replaced_by_meter_id`). Bias analytics are *per physical meter*, because the entire point is to find a specific instrument (e.g. "Chaguaramas Shore Meter 02") that reads consistently in one direction. Each meter's row maps to `cargo.meter_analytics(meter_id, review_id, loadout_count, total_volume, mean_variance_pct, median_variance_pct, weighted_variance_pct, stddev, cumulative_variance, same_direction_pct, computed_at)`.

For a meter `m`, the relevant sample is every approved loadout whose `loadout_measurements` includes a reading from `m` (a meter measurement's source links to the physical meter via the document/asset chain). For each such loadout `i`, let `meas_i` = the meter's measured quantity and `ref_i` = the selected reference (per §1.1; typically Taylor-corrected receipt), with `var_pct_i = (meas_i − ref_i)/ref_i × 100`.

### 3.1 The per-meter metrics and their formulas

| Column | Formula |
| --- | --- |
| `loadout_count` | `n_m = #{i}` |
| `total_volume` | `Σ meas_i` (the meter's own measured throughput) |
| `mean_variance_pct` | `(1/n_m) Σ var_pct_i` (distribution stat) |
| `median_variance_pct` | `percentile_cont(0.5)` of `{var_pct_i}` |
| `weighted_variance_pct` | `Σ(meas_i − ref_i) / Σ ref_i × 100` (**the bias figure**) |
| `stddev` | `stddev_samp(var_pct_i)` — dispersion of the per-loadout %s |
| `cumulative_variance` | `Σ (meas_i − ref_i)` (signed total volume bias, in units) |
| `same_direction_pct` | `max(pos,neg)/(pos+neg) × 100` (§2.6 applied to this meter) |

```sql
with v as (
  select m.id as meter_id,
         lm.calculated_quantity as meas,
         ref.q as ref,
         (lm.calculated_quantity - ref.q)/nullif(ref.q,0)*100.0 as var_pct
  from cargo.meters m
  join cargo.loadout_measurements lm
        on lm.method in ('vessel_meter','shore_meter') and lm.included
       and lm.source_document_id in (         -- meter→document linkage
            select d.id from cargo.documents d where d.id = lm.source_document_id)
       and exists (select 1 from cargo.loadout_documents lx
                   where lx.document_id = lm.source_document_id)
  join cargo.loadouts l on l.id = lm.loadout_id and l.status='approved' and l.review_id=$1
  join lateral (select quantity q from cargo.loadout_results
                where loadout_id=l.id and layer=$ref_layer) ref on true
  -- (meter identity resolved via asset map: meter_id = resolve_meter(lm.source_document_id, l))
)
select meter_id,
       count(*)                                              as loadout_count,
       sum(meas)                                             as total_volume,
       avg(var_pct)                                          as mean_variance_pct,
       percentile_cont(0.5) within group (order by var_pct)  as median_variance_pct,
       sum(meas-ref)/nullif(sum(ref),0)*100.0                as weighted_variance_pct,
       stddev_samp(var_pct)                                  as stddev,
       sum(meas-ref)                                         as cumulative_variance,
       100.0*greatest(count(*) filter (where var_pct>0),
                      count(*) filter (where var_pct<0))
            / nullif(count(*) filter (where var_pct<>0),0)   as same_direction_pct
from v group by meter_id;
```

> The weighted figure uses `Σ(meas−ref)/Σref` — the bias number that survives audit. `mean`/`median`/`stddev` describe the *spread* of per-loadout behaviour and feed the control-chart and trend tests (§3.3). They are stored together precisely so a reviewer can see "biased *and* tight" (systematic) versus "biased *but* scattered" (noisy).

### 3.2 Rolling averages and variance-by-segment

- **Rolling averages.** Order the meter's loadouts by `loadout_date`; compute a rolling weighted variance % over a window of the last `k` loadouts (k from settings) using `Σ_window(meas−ref)/Σ_window ref × 100`. Implemented with a window function ordered by date. This exposes drift onset (a meter that was clean for 40 loadouts then trends +1%).
- **Variance by vessel / product / loadout-size.** The same meter sample re-grouped by `vessel_id`, `product_id`, or a loadout-size bucket (small/medium/large by `ref_i`). Each group reports its own weighted variance % (`Σ(meas−ref)/Σref` *within the group*). This separates a true instrument bias (consistent across vessels/products) from a confound (a meter that only looks biased because it happened to serve one awkward vessel).

```sql
-- Rolling weighted variance % over last k loadouts for one meter
select loadout_date,
       sum(meas-ref) over w / nullif(sum(ref) over w,0) * 100.0 as rolling_wvar_pct
from v
window w as (order by loadout_date rows between $k-1 preceding and current row);
```

### 3.3 Control-chart & trend concepts; before/after calibration

- **Control chart.** Treat `{var_pct_i}` in date order as a process. Centre line = the meter's weighted variance %; control limits at centre ± 3·`stddev`/√(subgroup). Points outside limits, or runs of ≥7 on one side of centre (a classic Western-Electric run rule), flag a **persistent_bias** or **calibration_concern** candidate. The chart is a *concept the analytics expose*, not a live SPC system; it informs findings, with the human reviewer in the loop.
- **Trend test.** A simple ordered-by-date regression of `var_pct` on loadout sequence; a significant non-zero slope is a drift signal. Reported with the slope and the sample size, never as a conclusion on its own.
- **Before/after calibration.** `cargo.meters.calibration_date` (and `replaced_by_meter_id` for swaps) partitions the sample. Compute the weighted variance % for `loadout_date < calibration_date` versus `≥`. A meaningful shift toward zero post-calibration *supports* a calibration-concern finding for the pre-period; a shift that persists *strengthens* an instrument-bias finding. Each side reports its own sample size — a "before" window of three loadouts proves nothing.
- **Minimum sample size before a strong trend conclusion.** Gated by `cargo.client_procedures`/Cargo Assurance Settings (`min_sample_strong_trend`, configurable). Below it, the analytics still compute and display the numbers, but **no `persistent_bias`/`calibration_concern` finding with strong language may be generated** (§7.4). This implements `_CARGO-SPEC.md` §4.9 and §9.

### 3.4 Terminal-level rollup

A terminal aggregates its meters. Because each meter's bias is a quantity-ratio, the terminal figure is *not* the average of its meters' percentages: it is `Σ_meters Σ_i(meas−ref) / Σ_meters Σ_i ref × 100` — re-summed from the underlying quantities. The terminal view also surfaces *which* meter dominates the terminal's bias, so a single rogue instrument is not laundered into a "terminal is fine on average" statement.

---

## 4. Vessel comparison (accounting for number & size of loadouts)

Comparing vessels naively by "average variance %" rewards a vessel that did two tiny loadouts over one that did forty large ones. The vessel comparison therefore reports, **per vessel**, both the size-aware portfolio figure and the exposure context:

- `loadout_count` and `total_reference_volume` (`Σ ref_i`) — so the reader weights the comparison themselves.
- **Weighted variance %** = `Σ(cmp_i − ref_i)/Σ ref_i × 100` within the vessel (size-aware).
- **Cumulative variance volume** = `Σ(cmp_i − ref_i)` (absolute units — the figure that actually matters for exposure).
- **Mean & median per-loadout variance %** (distribution context) and `same_direction_pct`.
- A small-sample flag when `loadout_count < min_sample` (settings), suppressing strong ranking language for that vessel.

Vessels are ranked by cumulative variance *volume* and by weighted variance %, presented side by side, never by simple-mean percentage alone. A note accompanies any vessel whose ranking is driven by one or two loadouts.

```sql
select l.vessel_id,
       count(*)                                   as loadout_count,
       sum(ref.q)                                 as total_reference_volume,
       sum(cmp.q-ref.q)/nullif(sum(ref.q),0)*100  as weighted_variance_pct,
       sum(cmp.q-ref.q)                           as cumulative_variance_volume,
       avg((cmp.q-ref.q)/nullif(ref.q,0)*100)     as mean_variance_pct,
       percentile_cont(0.5) within group (order by (cmp.q-ref.q)/nullif(ref.q,0)*100)
                                                  as median_variance_pct
from cargo.loadouts l
join lateral (select quantity q from cargo.loadout_results where loadout_id=l.id and layer=$cmp_layer) cmp on true
join lateral (select quantity q from cargo.loadout_results where loadout_id=l.id and layer=$ref_layer) ref on true
where l.review_id=$1 and l.status='approved'
group by l.vessel_id;
```

---

## 5. Procedural-drift decomposition (the waterfall)

This is the heart of the assurance argument: it shows that an *apparent* loss is largely **procedural** (a consequence of how the client's methodology treats tanks, conversions, and consumption) rather than physical product gone missing. Per `_CARGO-SPEC.md` §7, the relevant identities are:

- **Procedural apparent loss** = `taylor_corrected − client_procedure` (per loadout, summed for the period).
- **Unexplained residual** = `taylor_corrected receipt − selected independent reference`.
- **Claimed-over-received** = `shore reported delivery − taylor_corrected receipt`.

### 5.1 Per-loadout waterfall

Starting from what shore *claimed* it delivered and walking down to the residual that no evidence explains:

```
shore_reported_delivery (rep)
  − non_receiving_tank_procedural_effect      (tank read as loss but never received)
  − documented_consumption                    (day/service tank burn, evidenced)
  − internal_transfer_effect                  (nets to zero across tanks; here = mis-attribution removed)
  − temperature_density_conversion_difference (std-volume basis differences)
  − meter_correction                          (calibration-factor / rollover fixes)
  = taylor_corrected_receipt (tc)             ── the defensible receipt
  − selected_independent_reference (ref)
  = unexplained_residual                      ── what remains, honestly labelled
```

Each subtraction is a `cargo.loadout_adjustments` row of the corresponding `type`, with `supported_by` evidence and an `evidence_document_id`. The waterfall is *only* valid when every step cites support; an adjustment with `supported_by='none'` is not a step, it is part of the unexplained residual. Internal transfers must net to zero (`cargo.internal_transfers`, `_CARGO-SPEC.md` §7); a non-zero net surfaces as an `undocumented_transfer` exception and is left in the residual rather than "explained away."

### 5.2 Period waterfall

The period decomposition is the **sum of each component across loadouts** (§2.3), presented as a single waterfall from `Σ rep` to `Σ tc` to the period unexplained residual, with each band labelled by adjustment type and carrying its evidence-coverage %. The bands are quantities (units), summed natively; any percentage shown on the chart is computed from the band quantity over `Σ rep` *after* summing.

```sql
-- Period waterfall bands (units), then residual against the independent reference.
select
  sum(rep)                                   as shore_reported_total,
  sum(non_receiving)                         as band_non_receiving,
  sum(documented_consumption)                as band_consumption,
  sum(transfer_effect)                       as band_internal_transfer,
  sum(temp_density)                          as band_conversion,
  sum(meter_correction)                      as band_meter_correction,
  sum(tc)                                    as taylor_corrected_total,
  sum(tc) - sum(indep_ref)                   as unexplained_residual_total
from cargo.v_loadout_waterfall          -- view assembling per-loadout bands from adjustments
where review_id=$1;
```

### 5.3 Conversion-difference band

Temperature/density/std-volume differences are their own band because they are a frequent, entirely legitimate source of apparent discrepancy: shore reads gross volume at one temperature, vessel sounding implies std volume at @15°C, etc. The band is computed only where the source documents support the conversion (`std_volume_basis` present); where they do not, the difference is **not** invented — the loadout is flagged (`low_confidence`) and the conversion band excludes it, with the omission disclosed in data-quality notes.

---

## 6. Hire-period portfolio analytics

Hire periods (`cargo.hire_periods`, `cargo.hire_period_results`) run the *same* upload/extraction/validation/versioning workflow (`_CARGO-SPEC.md` §9) and produce on-hire→off-hire reconciliations per fuel grade. Their analytics parallel the loadout analytics but pivot on hire boundaries.

### 6.1 The hire-period identity and its aggregates

Per `_CARGO-SPEC.md` §7: `expected_off_hire_rob = on_hire_rob + fuel_received − verified_consumption − external_discharged + other_adjustments`; `hire variance = actual_off_hire_rob − expected_off_hire_rob` (positive ⇒ more ROB than expected). The `unexplained_residual` per `cargo.hire_period_results` row is carried straight from the engine. **If consumption/transfer evidence is unavailable, only the verified on-hire→off-hire change is shown; no unexplained loss is inferred from incomplete information.**

Portfolio rollups (all sums of quantities, then ratios computed last):

- **On/off-hire variance by vessel** = `Σ variance` grouped by `vessel_id` (and weighted variance % = `Σ variance / Σ expected_off_hire_rob × 100`).
- **By fuel grade** = same grouped by `product_id`.
- **By client / charter period** = same grouped by `client_id` / `charterer_client_id` and `(on_hire_date, off_hire_date)`.
- **Total unexplained across hire periods** = `Σ unexplained_residual`, with the count of hire periods whose residual is undetermined-for-lack-of-evidence reported *separately* (never summed in as zero).
- **Recurring tank-level discrepancies** = tanks (`hire_tank_readings.vessel_tank_id`) that show a same-direction boundary discrepancy across multiple hire periods — a persistent-bias analogue at the tank level, gated by the same min-sample rule.

```sql
select hp.vessel_id, r.product_id,
       count(*)                                          as hire_periods,
       sum(r.variance)                                   as total_variance,
       sum(r.variance)/nullif(sum(r.expected_off_hire_rob),0)*100 as weighted_variance_pct,
       sum(r.unexplained_residual)                       as total_unexplained,
       count(*) filter (where r.data_quality->>'consumption_evidence'='missing')
                                                         as undetermined_count
from cargo.hire_period_results r
join cargo.hire_periods hp on hp.id = r.hire_period_id
where hp.review_id = $1 and hp.status='approved'
group by hp.vessel_id, r.product_id;
```

### 6.2 Reconciling loadout view against hire-boundary view

A vessel's fuel story can be told two ways: (a) sum of per-loadout receipts vs claims; (b) on-hire→off-hire ROB reconciliation. The portfolio analytics present both and **explain the bridge** between them: `Σ fuel_received` (hire) should reconcile to `Σ taylor_corrected receipt` (loadouts) over the overlapping window, with documented consumption and external discharge accounting for the difference. A gap that neither method explains is reported as a cross-method discrepancy with both sample sizes and both data-completeness figures — never resolved by quietly preferring one method.

---

## 7. Findings generation (`cargo.findings`)

A finding is a **neutral, defensible statement** produced only when the evidence supports it. Every `cargo.findings` row must carry: `statement`, `supporting_record_ids` (the loadouts/measurements/meters/documents it rests on), `sample_size`, `comparison_method`, `reference_method`, `absolute_variance`, `variance_pct`, `tolerance`, `data_quality_notes`, `severity`, and `category`. No finding is generated without these fields populated — that is the structural guarantee of defensibility.

### 7.1 How findings are produced

For each `category` (`procedural_effect`, `reconciliation_gap`, `directional_variance`, `persistent_bias`, `measurement_inconsistency`, `calibration_concern`, `explained_variance`, `unexplained_residual`) a generator runs over the aggregates/analytics and emits a *candidate* finding when its threshold (from the procedure/tolerances) is crossed **and** the min-sample gate (§7.4) is satisfied. Each candidate is templated into neutral language, stamped with its supporting records and statistics, and queued for reviewer approval. The reviewer can accept, downgrade, or reject; nothing reaches a published report unreviewed.

The statistics on a finding are read straight from the materialized aggregates (`cargo.review_aggregates`, `cargo.meter_analytics`) so the number in the sentence is provably the number in the dashboard — they share one source (§9).

### 7.2 Example generated statements

Using the spec's worked examples (86-loadout period; Chaguaramas Shore Meter 02):

> **Directional variance (period).** "Across the **86 loadouts** reviewed (data completeness **96%**), shore-reported delivery exceeded the Taylor-corrected vessel receipt in **63 of the 84 directional loadouts (75%)**. The cumulative claimed-over-received quantity was **1,240.6 m³**, equal to **+0.82%** of total corrected receipt (151,300 m³). Comparison method: shore-reported delivery; reference method: Taylor-corrected receipt. Tolerance: ±0.50%. **Note:** two loadouts lacked vessel-meter corroboration and are flagged in the data-quality appendix."

> **Persistent bias (meter).** "**Chaguaramas Shore Meter 02** measured **41 loadouts** (total measured volume **78,900 m³**). Its volume-weighted variance versus Taylor-corrected receipt was **+0.61%** (cumulative **+481.3 m³**), with **88%** of loadouts biased in the same (positive) direction and a standard deviation of per-loadout variance of **0.27%**. The sample of 41 exceeds the configured minimum of **20** for a trend conclusion. Comparison method: shore flow meter; reference method: Taylor-corrected receipt. Tolerance: ±0.50%. This is consistent with a **systematic positive reading bias** on this physical meter; it is **not** evidence of any deliberate act."

> **Calibration concern (before/after).** "For Chaguaramas Shore Meter 02, weighted variance was **+0.74%** across the **26 loadouts before** the 2026-03-14 calibration and **+0.18%** across the **15 loadouts after** (both samples above the configured minimum). The post-calibration shift toward zero is consistent with the calibration having corrected part of the bias."

> **Procedural effect (period).** "Of the **1,240.6 m³** apparent gap between shore-reported delivery and Taylor-corrected receipt, **910.2 m³ (73%)** is attributable to documented procedural effects — **612.0 m³** to non-receiving tanks read as loss, **210.5 m³** to documented day-tank consumption, and **87.7 m³** to temperature/density conversion basis differences — leaving an **unexplained residual of 330.4 m³ (0.22% of corrected receipt)**."

### 7.3 Forbidden language

Findings **never** allege **theft, fraud, tampering, pilferage, deliberate manipulation, or dishonesty** (`_CARGO-SPEC.md` §4.9). Permitted, defensible framing: *systematic bias*, *directional variance*, *procedural effect*, *apparent loss*, *unexplained residual*, *consistent with a reading bias*, *warrants instrument verification*. The generator enforces a denylist on emitted `statement` text and the reviewer is reminded of the constraint; a candidate that cannot be phrased neutrally is not emitted. Causation beyond what evidence shows is never asserted — the system reports *what the numbers are*, with their limits, and stops there.

### 7.4 Minimum-sample gating

No `persistent_bias`, `calibration_concern`, or `directional_variance` finding using *strong/trend* language is generated when the relevant `sample_size` is below the configured minimum (`min_sample_strong_trend`, from Cargo Assurance Settings / the procedure). Below the threshold the system may still record an *informational* finding ("insufficient sample (n=8) for a trend conclusion; figures shown for completeness") at `severity='info'`, but never a conclusion. The `sample_size` and `tolerance` on every finding make the gate auditable after the fact.

---

## 8. The correct weighted-percentage formulas (consolidated reference)

For implementers, every cumulative/portfolio percentage in this module is one of two forms. **Never the simple mean of ratios for a cumulative figure.**

```
# Cumulative / portfolio variance % (size-aware, = quantity ratio)
cum_var_pct = ( Σ_i (comparison_i − reference_i) / Σ_i reference_i ) × 100

# Weighted-average variance %, weight = reference quantity (identical to above)
wavg_var_pct = ( Σ_i w_i · var_pct_i ) / ( Σ_i w_i )      where w_i = reference_i
            = ( Σ_i reference_i · (comparison_i−reference_i)/reference_i ) / Σ_i reference_i × 100
            = ( Σ_i (comparison_i − reference_i) / Σ_i reference_i ) × 100      ✓ equals cum_var_pct

# Cumulative claimed-over-received %
coc_pct = ( Σ_i reported_i − Σ_i taylor_corrected_i ) / Σ_i taylor_corrected_i × 100

# % within tolerance (count ratio)
within_tol_pct = #{ i : |var_pct_i| ≤ tol_i } / n × 100

# % same direction (count ratio over directional loadouts)
same_dir_pct = max(pos, neg) / (pos + neg) × 100

# Data completeness % (count/quantity ratio of present-vs-expected)
completeness_pct = present / expected × 100
```

```
# FORBIDDEN for any cumulative/portfolio figure:
bad = (1/n) Σ_i ( (comparison_i − reference_i) / reference_i ) × 100   # simple mean of ratios
```

The simple mean and the median **are** computed and reported — but only as labelled distribution statistics describing per-loadout behaviour, never as the cumulative portfolio number. When a denominator (`reference_i`, `Σ reference`) is zero, the ratio is `NULL`/undefined and the loadout is excluded from that percentage with an exception, never coerced to zero.

---

## 9. Materialization: `review_aggregates` at publish vs live views

### 9.1 Live views (draft / in-review)

While a review is `draft`/`in_review`/`reviewed`, every metric in §2–§6 is available through **live views** computed on demand over the current approved loadouts: `cargo.v_review_aggregates`, `cargo.v_meter_analytics`, `cargo.v_vessel_comparison`, `cargo.v_loadout_waterfall`, `cargo.v_hire_period_rollup`. These reflect edits immediately so analysts and reviewers always see current truth. They are read-only and respect RLS (internal users only at this stage).

### 9.2 Materialized snapshot (publish)

At **approve/publish**, the live computations are evaluated once and written as durable rows: `cargo.review_aggregates(review_id, computed_at, metrics jsonb)` for the period figures and `cargo.meter_analytics(...)` rows per physical meter, alongside the reproducible `cargo.review_snapshots` (`_CARGO-SPEC.md` §6). After publication the **client dashboard and report read the materialized snapshot, not the live views** — this is what makes a published report reproducible (`_CARGO-SPEC.md` §4.7): the numbers are frozen at publish, immune to later loadout edits. A subsequent correction creates a **new review version / new snapshot**, never a silent change to the published one.

`cargo.review_aggregates.metrics` carries the full §2 metric set plus the procedure/methodology versions, the reference/comparison method selections, the aggregation unit, and the data-completeness breakdown, so the snapshot is self-describing.

### 9.3 Reconciliation guarantees

The materialization is only valid if it reconciles. At publish, before the snapshot is committed, the engine asserts:

1. **View ↔ snapshot identity.** Each materialized metric equals its live-view value at `computed_at` (recompute-and-compare within rounding tolerance). A mismatch blocks publish.
2. **Waterfall closure.** `Σ rep − Σ tc = Σ explained_bands + unexplained_residual` (§2.3, §5.2). The two derivations of the residual (apparent-gap-minus-explained, and corrected-minus-independent-reference) must agree within tolerance.
3. **Transfer neutrality.** Every `cargo.internal_transfers` set nets to zero across affected tanks; any non-zero net is an open exception, and an open `error`-severity exception blocks publish.
4. **No-double-count.** `cargo.loadout_documents.document_id` is unique (a document maps to at most one loadout, `_CARGO-SPEC.md` §6), so no measurement is summed twice; the assertion re-counts contributing documents per metric.
5. **Findings ↔ aggregates.** Every published finding's `variance_pct`/`absolute_variance`/`sample_size` equals the corresponding figure in the snapshot it cites. A finding whose numbers don't match the snapshot blocks publish.

These mirror the accounting engine's "every statement must reconcile, surfaced in-report, with a backstop assertion" discipline (`accounting-engine.md` §9, `reporting-and-dashboards.md` §9): a Cargo Assurance report that cannot reconcile is escalated, never cosmetically fixed.

---

## Open Questions

- **Reference-method selection granularity.** The reference method is configurable per procedure/review (`_CARGO-SPEC.md` §7). Should a single review be allowed to use *different* reference methods per product or per terminal (e.g. shore-tank as reference where no meter exists), and if so how is the mixed-reference portfolio figure labelled so it stays defensible?
- **Min-sample thresholds — one knob or many?** Is `min_sample_strong_trend` a single setting, or per-category (a meter persistent-bias conclusion may warrant a higher n than a period directional-variance statement)? Settle the settings shape with the Cargo Assurance Settings doc.
- **Median weighting.** The median is currently an unweighted order statistic over per-loadout %s. Do we also want a *quantity-weighted median* (the variance % at the loadout holding the 50th percentile of cumulative volume) for the size-aware "typical" figure, and is that worth the explanation cost on a client report?
- **Financial exposure price source.** Where does the defensible `unit_price` for estimated exposure come from over a 6–12 month period — a procedure-config reference, a client-approved price list, or a future Accounting feed — and how is intra-period price variation represented in the range?
- **Control-chart subgrouping.** Loadouts are irregular in time and size; what subgroup/window definition makes the SPC limits meaningful without implying a real-time process the batch model doesn't have?
- **Hire-vs-loadout bridge window.** When on/off-hire boundaries don't align with loadout dates at the period edges, what overlap window is used for the §6.2 reconciliation, and how is partial overlap disclosed?

## Decisions Locked

- **Percentages are never summed.** Every cumulative/portfolio percentage is a ratio of summed quantities (`Σ(cmp−ref)/Σref × 100`) or a correctly reference-weighted average (algebraically identical); the simple mean and median are reported only as labelled per-loadout distribution statistics. (`_CARGO-SPEC.md` §7; §§2.4–2.5, §8)
- **Unit normalization precedes aggregation**; mixed units raise a `unit_mismatch` exception rather than coercing, and temperature/density/std-volume conversions are applied only where the source supports them. (§1.2, §5.3)
- **Documented, estimated, unsupported, and unexplained quantities are kept in separate buckets**; an estimate is never folded into a documented total or presented as measured fact. (`_CARGO-SPEC.md` §4.2; §2.2, §2.9)
- **Bias analytics are per physical meter** (`cargo.meter_analytics`), with the volume-weighted variance % as the bias figure and mean/median/stddev as dispersion context; before/after-calibration partitions use `calibration_date`/`replaced_by_meter_id`. (§3)
- **Vessel and terminal comparisons are size-aware** — ranked by cumulative variance *volume* and weighted variance %, with loadout count and total reference volume shown, never by simple-mean percentage alone; small samples are flagged. (§3.4, §4)
- **The drift waterfall only counts evidenced steps**; `supported_by='none'` adjustments and non-zero transfer nets remain in the unexplained residual rather than being "explained away." (§5)
- **Hire-period analytics never infer loss from incomplete information**; with consumption/transfer evidence missing, only the verified on-hire→off-hire change is shown, and undetermined residuals are counted separately, never as zero. (`_CARGO-SPEC.md` §7; §6)
- **Every finding carries supporting records, sample size, comparison/reference methods, absolute & % variance, tolerance, and data-quality limitations**; theft/fraud/tampering language is forbidden, and strong/trend conclusions are gated by a configurable minimum sample. (`_CARGO-SPEC.md` §4.9; §7)
- **Published reports read the materialized `cargo.review_aggregates` / `cargo.meter_analytics` snapshot, not live views**, guaranteeing reproducibility; corrections create a new version, never a silent change. Live views serve only draft/in-review. (`_CARGO-SPEC.md` §4.7; §9)
- **Publish is blocked unless the aggregates reconcile** — view↔snapshot identity, waterfall closure, transfer neutrality, no-double-count, and findings↔aggregates agreement — mirroring the accounting reconciliation backstop. (§9.3)

---

*Cross-references:* `_CARGO-SPEC.md` (authoritative module spec — canonical `cargo` schema §6, calculation invariants §7, non-negotiable principles §4, delivery workflow §9, document conventions §10). `_ARCHITECTURE-SPEC.md` (platform core — database conventions §4, RLS/RBAC §7, non-negotiables §10, document conventions §11). Sibling Cargo Assurance docs (extraction/ingestion, reconciliation engine, client reports & dashboards, security, settings — named in `_CARGO-SPEC.md` §2 navigation) supply the loadouts, results, adjustments, findings UI, and configuration that this aggregation layer consumes and feeds. `accounting-engine.md` §9 and `reporting-and-dashboards.md` §9 are the precedent for the reconcile-or-escalate discipline applied in §9.3.*
