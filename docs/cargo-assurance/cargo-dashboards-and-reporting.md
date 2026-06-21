# Cargo Assurance Dashboards & Reporting

**TEAL Enterprise — Cargo Assurance Module**
Owning agent: Cargo Assurance Dashboards & Reporting Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This is the definitive reference for how the Cargo Assurance module *presents* a completed review: the **primary Assurance Dashboard** (the nine panels of `_CARGO-SPEC.md`, each backed by a real computed aggregate), the supporting **individual-record drilldown**, the **portfolio overview** across reviews/clients, and the **published client report** (read-only dashboard + audit-ready PDF/Excel). It specifies the widget/layout model, the data source behind every panel, the snapshot/reproducibility model (`cargo.review_snapshots`), and the branding/export framework. It conforms to `_CARGO-SPEC.md` and `_ARCHITECTURE-SPEC.md`, and is **read-only** over the analytics layer: it introduces no new write paths into review data and computes nothing of its own — every number it shows is read from `cargo-aggregation-and-analytics.md`'s aggregates/views or from a published snapshot.

This document is the presentation peer of `cargo-aggregation-and-analytics.md` (which is authoritative on *how each metric is computed*). Where that doc derives a figure, this doc decides *where it appears, how it is presented, and how it is exported*. It reuses the platform reporting conventions established in `reporting-and-dashboards.md` (`report_exports`-style frozen artefacts, `dashboard_configs`-style widget layouts, base-currency-by-default presentation) and adds only the Fuel-specific dashboard families.

---

## 1. The principle this layer must not violate

**The primary experience is the review period, not the daily form.** A Cargo Assurance dashboard is the executive read-out of a 6- or 12-month *Assurance Review* (`cargo.assurance_reviews`), aggregated across hundreds of loadouts. It must never look like a collection of daily operational forms (`_CARGO-SPEC.md` §1, §2: "New Loadout is NOT a primary navigation item"). The individual-loadout view exists, but as a *supporting drilldown beneath the aggregate*, reached by clicking through from a chart — never as the front door.

Three further rules, drawn straight from the spec, govern everything below:

1. **Every chart is backed by real computed data; the numbers are always available; Excel export is always permitted.** No chart is decorative. A panel with no underlying approved loadouts renders an honest **empty state** ("No approved loadouts in this period yet"), never sample numbers or a placeholder curve — the same discipline as `reporting-and-dashboards.md` §1. Behind every chart sits a "show the numbers" table reading the same aggregate, and every table exports to Excel (§8).
2. **Published reports read a frozen snapshot, never live views** (`_CARGO-SPEC.md` §4.7; `cargo-aggregation-and-analytics.md` §9). The internal dashboard reads live views while a review is `draft`/`in_review`/`reviewed`; the moment a review is `published`, the client dashboard and the PDF/Excel report read `cargo.review_snapshots` + `cargo.review_aggregates`. A later correction creates a **new version**, never a silent change.
3. **Findings language is neutral and defensible** (`_CARGO-SPEC.md` §4.9). The findings panel and report render only reviewer-approved `cargo.findings` statements, which the analytics layer has already stripped of theft/fraud/tampering language. The dashboard never editorialises beyond the stored `statement`.

If a review has no approved loadouts, this layer produces nothing but empty states. That is correct behaviour, not a gap to fill.

---

## 2. Dashboard families and how they nest

There are four presentation surfaces, nesting from broadest to narrowest. Only the first three are dashboards; the fourth is the client deliverable.

| Surface | Scope | Audience | Reads |
| --- | --- | --- | --- |
| **Portfolio Overview** (§7) | all reviews / clients for the company | Internal (`ca_admin`, `ca_analyst`, `ca_reviewer`) | live views across reviews + published snapshots |
| **Assurance Dashboard** (§3–§4) | one `assurance_review` | Internal during work; published copy for client | live views (pre-publish) → snapshot (post-publish) |
| **Record Drilldown** (§6) | one `loadout` / `hire_period` | Internal; client sees only published records | loadout/measurement/result/adjustment tables |
| **Client Report** (§8–§9) | one **published** review | External (`ca_client_admin`, `ca_client_viewer`) | `cargo.review_snapshots` only |

Navigation top-level (per `_CARGO-SPEC.md` §2) puts **Portfolio Overview** and **Assurance Reviews** first; a single review opens on its **Assurance Dashboard**, from which a reviewer drills into individual records or jumps to **Analysis** and **Client Reports**. The Assurance Dashboard is the centre of gravity of the whole module.

---

## 3. The Primary Assurance Dashboard — overview

The Assurance Dashboard is the executive read-out of one review. It opens on a single screen of nine panels (§4), arranged so an executive sees the headline KPIs and the method-comparison story above the fold, with the drift, trend, ranking, quality, and findings panels below. Every panel:

- **maps to exactly one aggregate** in `cargo-aggregation-and-analytics.md` (the period aggregate `cargo.review_aggregates` / `cargo.v_review_aggregates`, the per-meter `cargo.meter_analytics` / `cargo.v_meter_analytics`, the vessel comparison `cargo.v_vessel_comparison`, the waterfall `cargo.v_loadout_waterfall`, or the findings `cargo.findings`);
- **carries a "show numbers" table** under the chart, reading the identical aggregate, so the number in the sentence is provably the number in the chart (`cargo-aggregation-and-analytics.md` §7.1, §9.3 — findings ↔ aggregates ↔ chart share one source);
- **exports to Excel** (the panel's underlying table, §8), and contributes to the full report export;
- **states its data-completeness context** so no chart is read as more certain than its evidence (`_CARGO-SPEC.md` §4.9).

The dashboard reads the **live views** for a review in `draft`/`in_review`/`reviewed` (so analysts and reviewers see current truth), and the **materialized snapshot** once the review is `published` (so the executive copy is frozen, `cargo-aggregation-and-analytics.md` §9.2). The reference and comparison methods are **read from the review's pinned procedure**, never hard-coded (`_CARGO-SPEC.md` §7), and every panel labels which methods it used.

### 3.1 Design direction

Technical, trustworthy, restrained, executive-ready, audit-ready, and visually consistent with the rest of TEAL Enterprise (`reporting-and-dashboards.md` conventions). Concretely:

- **Charts only where they aid understanding.** A KPI is a number, not a gauge. A method comparison is a grouped bar (seven methods side by side). Drift is a waterfall. A trend is a line. A ranking is a sorted horizontal bar. Data quality is a small-multiples bar/heat strip. Findings are prose. Nothing is a chart for decoration's sake.
- **Numbers first, always.** Every chart has a number table one click (or scroll) away; the report leads with figures and uses charts to make the figures legible, never to replace them.
- **Restrained palette and typography.** Neutral, technical, audit-ready; directional colour used sparingly and consistently (e.g. a single accent for "comparison reports more", its complement for "reports less"), never a rainbow. Sign convention printed everywhere (positive ⇒ comparison reports more, `_CARGO-SPEC.md` §7).
- **Does not look like daily forms.** No grid of per-loadout cards on the landing surface; the loadout list is a drilldown table reached from a chart, not the hero.

---

## 4. The nine panels

Each subsection gives the panel's **data source** (the aggregate/view it reads, per `cargo-aggregation-and-analytics.md`), its **presentation**, and the SQL sketch where it sharpens the source query. All queries are parameterised by `review_id` (`$1`) and read the review's pinned reference/comparison layers (`$ref_layer`, `$cmp_layer`).

### 4.1 Panel 1 — Executive KPI summary

**Data source.** `cargo.review_aggregates.metrics` (post-publish) / `cargo.v_review_aggregates` (live) — the §2 period metric set of `cargo-aggregation-and-analytics.md`. No new computation; the panel selects KPI fields from the one `metrics jsonb` blob.

**Presentation.** A row of KPI tiles, each a single number with its unit, sign, and a one-line context. The canonical tiles:

| KPI tile | Metric (from `metrics`) |
| --- | --- |
| Loadouts reviewed | `total_loadouts` (+ excluded/needs-review counts) |
| Total corrected receipt | `total_taylor_corrected` (review unit) |
| Cumulative claimed-over-received | `cumulative_claimed_over_received_qty` + `_pct` |
| Procedural apparent loss | `procedural_apparent_loss_qty` (Taylor − client procedure) |
| Unexplained residual | `unexplained_residual_qty` + `_pct` |
| Weighted variance % | `weighted_variance_pct` (cmp vs ref, the defensible figure) |
| Within tolerance | `within_tolerance_pct` (with the tolerance value cited) |
| Data completeness | `data_completeness_pct` |
| Estimated exposure (optional) | `estimated_exposure` in `reporting_currency`, shown only if defined (§4.9 of analytics) |

Each tile shows the cumulative figure (a quantity ratio, never a summed percentage, `cargo-aggregation-and-analytics.md` §8) and links to the panel that explains it. The exposure tile is **omitted** when `reporting_currency` is null or no defensible price exists (`_CARGO-SPEC.md` §8; analytics §2.9).

### 4.2 Panel 2 — Cumulative method comparison

**Data source.** The §2.1 quantity-totals query of `cargo-aggregation-and-analytics.md` — `total_nominated`, client-procedure result, corrected vessel soundings (Taylor-corrected receipt), vessel meter, shore meter, shore tank, FuelTrax — all unit-normalized period sums over approved loadouts. (The seven methods of `_CARGO-SPEC.md` §1: nominated, client procedure, corrected vessel soundings, vessel meter, shore meter, shore tank, FuelTrax.)

**Presentation.** A grouped/sorted horizontal bar chart, one bar per method, all in the review's aggregation unit, with the **reference method visually anchored** (a baseline line) so the reader sees each method's cumulative deviation from the reference at a glance. Under it, the "show numbers" table gives each method's total quantity, its delta versus reference (quantity), and its weighted variance % (`Σ(method − ref)/Σ ref × 100`, computed last). The panel never sums percentages.

```sql
-- Panel 2: cumulative method totals (period), unit-normalized, one row per method.
with mq as (
  select
    sum(l.nominated_quantity)                                                as nominated,
    sum(r.quantity) filter (where r.layer='client_procedure')                as client_procedure,
    sum(r.quantity) filter (where r.layer='taylor_corrected')                as corrected_soundings,
    sum(m.calculated_quantity) filter (where m.method='vessel_meter' and m.included) as vessel_meter,
    sum(m.calculated_quantity) filter (where m.method='shore_meter'  and m.included) as shore_meter,
    sum(m.calculated_quantity) filter (where m.method='shore_tank'   and m.included) as shore_tank,
    sum(m.calculated_quantity) filter (where m.method='fueltrax'     and m.included) as fueltrax
  from cargo.loadouts l
  left join cargo.loadout_results      r on r.loadout_id = l.id
  left join cargo.loadout_measurements m on m.loadout_id = l.id
  where l.review_id = $1 and l.status = 'approved'
)
select * from mq;   -- bar = each column; baseline = the configured reference column
```

### 4.3 Panel 3 — Procedural drift waterfall

**Data source.** The §5.2 period-waterfall query of `cargo-aggregation-and-analytics.md` over `cargo.v_loadout_waterfall` (which assembles per-loadout bands from `cargo.loadout_adjustments` by `type`). The bands are exactly the `cargo.loadout_adjustments.type` enum (`_CARGO-SPEC.md` §6): non-receiving tank, consumption, internal transfer, temperature/density, meter correction, other.

**Presentation.** A waterfall from **client procedure result → … → Taylor corrected**, with the spec's ordered bands (`_CARGO-SPEC.md` §1):

```
client_procedure_result
  → non_receiving_tanks            (read as loss, never received)
  → day/service consumption        (documented day-tank burn)
  → internal_transfers             (mis-attribution removed; nets to zero across tanks)
  → temperature/density            (std-volume basis differences)
  → meter_corrections              (calibration-factor / rollover fixes)
  → other                          (evidenced residual adjustments)
  = taylor_corrected               ── the defensible receipt
```

Each band is a quantity (units), summed natively; any percentage on the chart is computed from the band over the opening total **after** summing (`cargo-aggregation-and-analytics.md` §5.2). Only **evidenced** steps appear as bands; `supported_by='none'` adjustments and non-zero transfer nets stay in the unexplained residual rather than being "explained away" (analytics §5.1). Each band carries its evidence-coverage % and links to the contributing adjustments. The "show numbers" table lists every band, its quantity, % of opening total, and evidence coverage.

```sql
-- Panel 3: period drift waterfall bands (units), client_procedure → taylor_corrected.
select
  sum(client_procedure)        as opening_client_procedure,
  sum(non_receiving)           as band_non_receiving,
  sum(documented_consumption)  as band_consumption,
  sum(internal_transfer)       as band_internal_transfer,
  sum(temp_density)            as band_conversion,
  sum(meter_correction)        as band_meter_correction,
  sum(other_adjustment)        as band_other,
  sum(taylor_corrected)        as closing_taylor_corrected
from cargo.v_loadout_waterfall
where review_id = $1;
```

### 4.4 Panel 4 — Monthly trend (absolute & %)

**Data source.** The same period aggregates re-bucketed by month of `cargo.loadouts.loadout_date`. Absolute = `Σ(cmp − ref)` per month (units); % = `Σ(cmp − ref)/Σ ref × 100` per month (the weighted figure per bucket — never a mean of per-loadout %s, `cargo-aggregation-and-analytics.md` §8). Cumulative claimed-over-received and corrected receipt can each be trended.

**Presentation.** A dual-axis line chart: an absolute-quantity line (cumulative variance volume per month) and a weighted-% line, with month on the x-axis. A small toggle switches the % between weighted (default) and mean/median distribution lines (clearly labelled as distribution stats, not the cumulative figure). The "show numbers" table is month × {loadout count, Σ ref, Σ cmp, abs variance, weighted %}.

```sql
-- Panel 4: monthly trend, weighted % computed within each month bucket.
with v as (
  select date_trunc('month', l.loadout_date)::date as month,
         cmp.q as cmp, ref.q as ref
  from cargo.loadouts l
  join lateral (select quantity q from cargo.loadout_results where loadout_id=l.id and layer=$cmp_layer) cmp on true
  join lateral (select quantity q from cargo.loadout_results where loadout_id=l.id and layer=$ref_layer) ref on true
  where l.review_id=$1 and l.status='approved'
)
select month,
       count(*)                                  as loadout_count,
       sum(ref)                                  as ref_total,
       sum(cmp - ref)                            as abs_variance,
       sum(cmp - ref)/nullif(sum(ref),0)*100     as weighted_variance_pct
from v group by month order by month;
```

### 4.5 Panel 5 — Terminal & meter comparison ranking

**Data source.** `cargo.meter_analytics` / `cargo.v_meter_analytics` (the §3 per-physical-meter bias analytics of `cargo-aggregation-and-analytics.md`), rolled up to terminals (§3.4). Each physical meter (`cargo.meters.physical_id`) carries `weighted_variance_pct` (the bias figure), `cumulative_variance` (signed volume bias), `same_direction_pct`, `stddev`, and `loadout_count`.

**Presentation.** A sorted horizontal bar ranking of meters (and a terminal rollup view), ranked by **cumulative variance volume** and by **weighted variance %** side by side — never by simple-mean % alone (analytics §3.4, §4). Each bar shows the meter's sample size; a small-sample flag suppresses strong ranking language below `min_sample_strong_trend` (analytics §3.3). Bars are coloured by direction (consistently positive/negative). The terminal rollup re-sums from underlying quantities (`Σ(meas−ref)/Σ ref`, analytics §3.4), surfacing *which* meter dominates a terminal's bias so a single rogue instrument is not laundered into a "terminal is fine on average" statement. The "show numbers" table is the full `meter_analytics` row set.

```sql
-- Panel 5: meter ranking (reads the materialized/live per-meter analytics).
select m.physical_id, m.name, t.name as terminal,
       ma.loadout_count, ma.total_volume,
       ma.weighted_variance_pct, ma.cumulative_variance,
       ma.same_direction_pct, ma.stddev
from cargo.meter_analytics ma
join cargo.meters m   on m.id = ma.meter_id
left join cargo.terminals t on t.id = m.terminal_id
where ma.review_id = $1
order by abs(ma.cumulative_variance) desc;   -- secondary sort by weighted_variance_pct in UI
```

### 4.6 Panel 6 — Vessel comparison

**Data source.** `cargo.v_vessel_comparison` (the §4 vessel query of `cargo-aggregation-and-analytics.md`): per `cargo.loadouts.vessel_id`, `loadout_count`, `total_reference_volume`, `weighted_variance_pct`, `cumulative_variance_volume`, mean/median per-loadout %, `same_direction_pct`.

**Presentation.** A size-aware ranking (sorted horizontal bars) by **cumulative variance volume** and **weighted variance %**, with each vessel's loadout count and total reference volume shown so the reader weights the comparison (analytics §4). A note flags any vessel whose ranking is driven by one or two loadouts (`loadout_count < min_sample`). Never ranked by simple-mean % alone. The "show numbers" table carries all columns including the distribution stats.

```sql
-- Panel 6: vessel comparison (size-aware).
select v.name as vessel, vc.*
from cargo.v_vessel_comparison vc
join cargo.vessels v on v.id = vc.vessel_id
where vc.review_id = $1
order by abs(vc.cumulative_variance_volume) desc;
```

### 4.7 Panel 7 — Procedural-effect analysis

**Data source.** The procedural-effect aggregates of `cargo-aggregation-and-analytics.md` §2.2–§2.3 and §5: `procedural_apparent_loss` (`Σ(taylor_corrected − client_procedure)`), the explained-by-type breakdown (`explained_by_type`), the non-receiving-tank procedural effect (`Σ cargo.loadout_tank_readings.procedural_effect`), documented consumption, and the unexplained residual.

**Presentation.** This is the *assurance argument*, presented as a composition: a stacked/segmented bar (or donut) showing how much of the apparent gap is **procedural** (each evidenced `type`) versus the **unexplained residual**, with the headline framing "*X% of the apparent loss is attributable to documented procedural effects; the unexplained residual is Y%*" (the spec's worked finding, `_CARGO-SPEC.md`-aligned via `cargo-aggregation-and-analytics.md` §7.2). It ties directly to Panel 3 (the waterfall is the *walk*; this panel is the *composition*). The "show numbers" table is the explained-by-type breakdown with evidence coverage and the residual.

```sql
-- Panel 7: procedural-effect composition (explained-by-type vs residual).
with gap as (
  select sum(r.quantity) filter (where r.layer='taylor_corrected')
       - sum(r.quantity) filter (where r.layer='client_procedure') as procedural_apparent_loss
  from cargo.loadout_results r
  join cargo.loadouts l on l.id = r.loadout_id
  where l.review_id=$1 and l.status='approved'
),
expl as (
  select a.type, sum(a.quantity) as q
  from cargo.loadout_adjustments a join cargo.loadouts l on l.id=a.loadout_id
  where l.review_id=$1 and l.status='approved' and a.supported_by <> 'none'
  group by a.type
)
select (select procedural_apparent_loss from gap)        as procedural_apparent_loss,
       (select jsonb_object_agg(type, q) from expl)       as explained_by_type;
```

### 4.8 Panel 8 — Data-quality panel

**Data source.** The data-completeness aggregates of `cargo-aggregation-and-analytics.md` §2.8 plus the exception queue `cargo.data_exceptions` and extraction confidence on `cargo.documents` / `cargo.extracted_fields`. Components: loadout-level completeness, field-level completeness, methods-available-per-loadout, count of open exceptions by `type`/`severity`, and low-confidence extraction counts.

**Presentation.** The honesty gauge that gates every strong conclusion (`_CARGO-SPEC.md` §4.9). A compact panel of: a completeness % with breakdown (documents present, fields ok, methods available), a bar of open exceptions by type/severity (`missing_reading`, `duplicate_certificate`, `unmatched_document`, `undocumented_transfer`, `expired_calibration`, `low_confidence`, …), and the count of loadouts excluded/needs-review. Every other panel reads its completeness context from here; the report repeats it as a limitation on each finding. The "show numbers" table is the exception list with links to the offending document/loadout.

```sql
-- Panel 8: open exceptions by type/severity (the data-quality queue).
select type, severity, count(*) as open_count
from cargo.data_exceptions
where review_id=$1 and status='open'
group by type, severity
order by severity desc, open_count desc;
-- completeness % comes from cargo.v_review_aggregates (analytics §2.8).
```

### 4.9 Panel 9 — Findings summary

**Data source.** `cargo.findings` for the review — reviewer-approved, neutrally-phrased statements, each carrying `supporting_record_ids`, `sample_size`, `comparison_method`, `reference_method`, `absolute_variance`, `variance_pct`, `tolerance`, `data_quality_notes`, `severity`, `category` (`cargo-aggregation-and-analytics.md` §7). The statistics on each finding are read from the same materialized aggregates the dashboard shows, so the sentence and the chart cannot disagree (analytics §7.1, §9.3).

**Presentation.** Plain-language statements grouped by `category` and ordered by `severity`, each a short paragraph with its supporting figures inline and a link to the records it rests on. This is prose, not a chart. Using the spec's worked example (`cargo-aggregation-and-analytics.md` §7.2, which renders `_CARGO-SPEC.md`'s 86-loadout / Chaguaramas Shore Meter 02 examples):

> **Directional variance (period).** "Across the **86 loadouts** reviewed (data completeness **96%**), shore-reported delivery exceeded the Taylor-corrected vessel receipt in **63 of the 84 directional loadouts (75%)**. The cumulative claimed-over-received quantity was **1,240.6 m³**, equal to **+0.82%** of total corrected receipt (151,300 m³). Comparison method: shore-reported delivery; reference method: Taylor-corrected receipt. Tolerance: ±0.50%. **Note:** two loadouts lacked vessel-meter corroboration and are flagged in the data-quality appendix."

> **Procedural effect (period).** "Of the **1,240.6 m³** apparent gap between shore-reported delivery and Taylor-corrected receipt, **910.2 m³ (73%)** is attributable to documented procedural effects — **612.0 m³** to non-receiving tanks read as loss, **210.5 m³** to documented day-tank consumption, and **87.7 m³** to temperature/density conversion basis differences — leaving an **unexplained residual of 330.4 m³ (0.22% of corrected receipt)**."

Below-minimum-sample categories show only the informational note ("insufficient sample (n=8) for a trend conclusion; figures shown for completeness", analytics §7.4), never a conclusion. The panel never renders a finding that is not reviewer-approved, and the forbidden-language denylist (`_CARGO-SPEC.md` §4.9, analytics §7.3) has already been enforced upstream.

```sql
-- Panel 9: approved findings for the review, grouped & ordered for display.
select category, severity, title, statement, sample_size,
       comparison_method, reference_method,
       absolute_variance, variance_pct, tolerance,
       data_quality_notes, supporting_record_ids
from cargo.findings
where review_id=$1 and status='approved'
order by array_position(array['error','warning','info']::text[], severity), category;
```

---

## 5. The widget / layout model and a JSON example

The Assurance Dashboard layout reuses the platform widget contract from `reporting-and-dashboards.md` §6.2: a dashboard is an array of typed, parameterised widgets, each a **reference to a real query** (never a static figure), stored as `jsonb`. Cargo Assurance stores layouts in **`cargo.dashboard_configs(id, company_id, user_id null, scope enum[review,portfolio,client], name, layout jsonb, is_default, created_by, created_at, updated_at)`** — the direct analogue of `accounting.dashboard_configs`, scoped additionally by `scope` (review vs portfolio vs published-client) and respecting RLS + client-portal policies (`_CARGO-SPEC.md` §3, §5). The default review layout is company-wide; a reviewer may save a personal arrangement.

Each widget declares: `id`, `type` (`kpi`, `method_bar`, `waterfall`, `trend_line`, `meter_rank`, `vessel_rank`, `procedural_composition`, `data_quality`, `findings`, `record_table`), `source` (the aggregate/view key it draws from), `params` (inheriting the review's pinned reference/comparison methods, aggregation unit, and `reporting_currency`), `layout` (grid `x/y/w/h`), `title`, and optional `format` hints. Widgets render **empty states** without approved data (§1). The `source` keys map one-to-one to the panels in §4.

```json
{
  "version": 1,
  "scope": "review",
  "review_id": "$REVIEW_ID",
  "unit": "m3",
  "reference_method": "taylor_corrected",
  "comparison_method": "client_procedure",
  "reporting_currency": "USD",
  "widgets": [
    {
      "id": "p1-kpi", "type": "kpi", "title": "Executive Summary",
      "source": "review_aggregates",
      "params": { "tiles": ["total_loadouts","total_taylor_corrected",
                  "cumulative_claimed_over_received","procedural_apparent_loss",
                  "unexplained_residual","weighted_variance_pct",
                  "within_tolerance_pct","data_completeness_pct","estimated_exposure"] },
      "layout": { "x": 0, "y": 0, "w": 12, "h": 2 }
    },
    {
      "id": "p2-methods", "type": "method_bar", "title": "Cumulative Method Comparison",
      "source": "method_totals",
      "params": { "methods": ["nominated","client_procedure","corrected_soundings",
                  "vessel_meter","shore_meter","shore_tank","fueltrax"],
                  "baseline": "reference" },
      "layout": { "x": 0, "y": 2, "w": 6, "h": 4 }
    },
    {
      "id": "p3-drift", "type": "waterfall", "title": "Procedural Drift",
      "source": "loadout_waterfall",
      "params": { "from": "client_procedure", "to": "taylor_corrected",
                  "bands": ["non_receiving_tank","consumption","internal_transfer",
                            "temperature_density","meter_correction","other"] },
      "layout": { "x": 6, "y": 2, "w": 6, "h": 4 }
    },
    {
      "id": "p4-trend", "type": "trend_line", "title": "Monthly Trend",
      "source": "review_aggregates_monthly",
      "params": { "bucket": "month", "series": ["abs_variance","weighted_variance_pct"] },
      "layout": { "x": 0, "y": 6, "w": 12, "h": 3 }
    },
    {
      "id": "p5-meters", "type": "meter_rank", "title": "Terminal & Meter Comparison",
      "source": "meter_analytics",
      "params": { "rank_by": ["cumulative_variance","weighted_variance_pct"],
                  "rollup": "terminal", "min_sample_flag": true },
      "layout": { "x": 0, "y": 9, "w": 6, "h": 4 }
    },
    {
      "id": "p6-vessels", "type": "vessel_rank", "title": "Vessel Comparison",
      "source": "vessel_comparison",
      "params": { "rank_by": ["cumulative_variance_volume","weighted_variance_pct"],
                  "min_sample_flag": true },
      "layout": { "x": 6, "y": 9, "w": 6, "h": 4 }
    },
    {
      "id": "p7-proc", "type": "procedural_composition", "title": "Procedural-Effect Analysis",
      "source": "procedural_composition",
      "params": { "show_residual": true },
      "layout": { "x": 0, "y": 13, "w": 6, "h": 4 }
    },
    {
      "id": "p8-dq", "type": "data_quality", "title": "Data Quality",
      "source": "data_quality",
      "params": { "by": ["exception_type","severity"], "completeness": true },
      "layout": { "x": 6, "y": 13, "w": 6, "h": 4 }
    },
    {
      "id": "p9-findings", "type": "findings", "title": "Findings",
      "source": "findings",
      "params": { "status": "approved", "group_by": "category", "order_by": "severity" },
      "layout": { "x": 0, "y": 17, "w": 12, "h": 5 }
    }
  ]
}
```

Every widget's `source` resolves server-side to the matching live view (pre-publish) or snapshot field (post-publish), and every widget exposes its underlying rows for the "show numbers" table and Excel export (§8). Adding/removing/resizing widgets saves the edited `layout` back to the user's personal `cargo.dashboard_configs` row, leaving the company default untouched — exactly the `reporting-and-dashboards.md` §6.3 pattern.

---

## 6. Individual record drilldown (supporting, not primary)

The record drilldown is reached **by clicking through from a chart** (a vessel bar, a meter, a waterfall band, a flagged exception) — it is never the landing surface (`_CARGO-SPEC.md` §2). It is the auditor's deep view of one `cargo.loadouts` row (or one `cargo.hire_periods` row, which uses the same view shape). It exists to make every aggregate *traceable down to evidence*, satisfying the source-traceability principle (`_CARGO-SPEC.md` §4.3).

A loadout drilldown presents, in order:

1. **Matched source documents** — the `cargo.loadout_documents` set with each `cargo.documents` row's `original_filename`, `detected_document_type`, `classification_confidence`, `extraction_status`, and a link to the stored original in Storage (never deleted, `_CARGO-SPEC.md` §4.1). The unique `loadout_documents.document_id` guarantees no document is double-counted.
2. **Extracted values** — `cargo.extracted_fields` (raw + normalized, `unit`, `confidence`, `status`), with **source-page references** (`source_page`, `source_table`, `source_cell`, `source_worksheet`) and any `cargo.field_corrections` (original + corrected + reason + who/when), so every value links back to where it came from.
3. **Tank-level reconciliation** — `cargo.loadout_tank_readings`: per tank, `tank_role`, `received_flag`, opening/closing soundings & quantities, temperature/density/API, `std_volume_basis`, `raw_difference`, `corrected_receipt_difference`, and `procedural_effect`, with the invariant made visible (a non-receiving tank shows `corrected_receipt_difference = 0` with its `raw_difference` preserved as evidence, `_CARGO-SPEC.md` §7).
4. **Method comparison** — `cargo.loadout_measurements` per method (vessel sounding, vessel meter, shore meter, shore tank, FuelTrax, client-reported), each with its `calculated_quantity`, `formula`, `formula_version`, `included` flag, and source document — the per-loadout analogue of Panel 2.
5. **Client vs Taylor calculation** — the three `cargo.loadout_results` layers (`raw_evidence`, `client_procedure`, `taylor_corrected`) side by side, with the per-loadout waterfall (`cargo.loadout_adjustments`) walking client → Taylor, mirroring Panel 3 at the record level.
6. **Adjustments** — every `cargo.loadout_adjustments` row (`type`, `quantity`, `supported_by`, `evidence_document_id`, `explanation`) and any `cargo.internal_transfers` (which must net to zero), each linked to its supporting evidence.
7. **Confidence & data quality** — `match_confidence`, extraction confidences, and any `cargo.data_exceptions` raised against this loadout, with status.
8. **Approval history** — the loadout's `status` transitions (`extracted → needs_review → approved`/`excluded`, with `exclusion_reason`), the reviewer and timestamps, sourced from `core.audit_logs` (`entity_schema = 'cargo'`, `_CARGO-SPEC.md` §5).

The drilldown is read-only in the published client view and shows **only published records** for the client's `client_id` (`_CARGO-SPEC.md` §3 isolation). Internally, it is where an analyst corrects extraction or re-classifies a tank role — but those writes belong to the ingestion/calculation docs, not here; this layer only *presents* the record.

```sql
-- Record drilldown spine: one loadout, its results layers, adjustments, and documents.
select l.*,
  (select jsonb_agg(r.* order by r.layer) from cargo.loadout_results r where r.loadout_id=l.id) as results,
  (select jsonb_agg(a.* order by a.type)  from cargo.loadout_adjustments a where a.loadout_id=l.id) as adjustments,
  (select jsonb_agg(tr.* order by tr.tank_role) from cargo.loadout_tank_readings tr where tr.loadout_id=l.id) as tank_readings,
  (select jsonb_agg(m.* order by m.method) from cargo.loadout_measurements m where m.loadout_id=l.id) as measurements,
  (select jsonb_agg(jsonb_build_object('document_id', ld.document_id, 'role', ld.role))
     from cargo.loadout_documents ld where ld.loadout_id=l.id) as documents
from cargo.loadouts l
where l.id = $1;
```

---

## 7. Portfolio Overview (across reviews / clients)

The Portfolio Overview is the company-level surface above any single review (`_CARGO-SPEC.md` §2, first nav item). It answers "what is happening across all our assurance work?" without flattening clients together (strict multi-client isolation still applies — an internal user sees all the company's clients; a client user never reaches this surface).

It presents, per **review** and rolled up per **client / vessel / terminal / meter across reviews**:

- a **reviews table** — each `cargo.assurance_reviews` with client, period, status, loadout count, cumulative claimed-over-received, weighted variance %, unexplained residual, data completeness, and publish state, reading `cargo.review_aggregates` for published reviews and live views for in-progress ones (clearly badged: provisional vs published, mirroring `reporting-and-dashboards.md` §5.3 period-state cues);
- **cross-review meter bias** — a physical meter (`cargo.meters.physical_id`) tracked *across* reviews (its `replaced_by_meter_id` chain honoured), so a persistent instrument bias visible over two years is not lost when each review resets; this is the multi-review extension of Panel 5, re-summed from underlying quantities, never averaged across reviews;
- **client comparison** — per client, the portfolio cumulative figures, with each client's reviews listed; never a cross-client total that mixes currencies or procedures (each client has its own pinned procedure/methodology version);
- **status & workload** — counts of reviews by `status`, open exceptions across reviews, and reviews awaiting approval/publish.

Every portfolio figure is a re-sum of the underlying quantities (a portfolio % is `Σ(cmp−ref)/Σ ref` across the included reviews, never an average of review-level %s, `cargo-aggregation-and-analytics.md` §8), and every cell drills into its review's Assurance Dashboard. The portfolio surface reads only data the user is entitled to via `core.company_memberships` (`_CARGO-SPEC.md` §3, §5).

---

## 8. Client reporting: published dashboard + audit-ready PDF/Excel

After a reviewer approves and publishes a review (`cargo.assurance_reviews.status='published'`), the client receives **two** deliverables, both reading the **frozen snapshot** (`cargo.review_snapshots`, §9), never live data:

1. **A published read-only client dashboard** — the same nine panels of §4, rendered from the snapshot, scoped to the client's `client_id`, accessible to `ca_client_admin` / `ca_client_viewer` via `cargo.client_access` (`_CARGO-SPEC.md` §3). It is read-only: no edit affordances, no draft/needs-review records, only the approved, published figures. Drilldown (§6) is available but shows only published records.
2. **An audit-ready PDF report and an Excel report** — frozen artefacts stored in Supabase Storage and indexed on the snapshot (`cargo.review_snapshots.report_pdf_path`, `report_xlsx_path`, `_CARGO-SPEC.md` §6).

### 8.1 Required report contents (from the spec)

The PDF/Excel report contains, at minimum (the spine of `_CARGO-SPEC.md` §9 plus the §4 principles, rendered for an external audit reader):

- **Cover & scope** — client, review title, period (`start_date`–`end_date`), pinned procedure name + **version**, methodology name + **version** (`_CARGO-SPEC.md` §4.5), included terminals/vessels/products, and the branding block (§8.3).
- **Executive summary** — the Panel 1 KPIs with the cumulative claimed-over-received, procedural apparent loss, and unexplained residual stated plainly.
- **Method comparison** — Panel 2 (the seven methods) with the numbers table.
- **Procedural drift** — Panel 3 waterfall and Panel 7 composition, with evidence coverage per band.
- **Trend** — Panel 4 monthly absolute & %.
- **Terminal/meter and vessel analysis** — Panels 5 & 6, ranked, with sample sizes and small-sample flags.
- **Findings** — Panel 9 statements, each with supporting records, sample size, comparison/reference methods, absolute & % variance, tolerance, and **data-quality limitations** (`_CARGO-SPEC.md` §4.9; analytics §7).
- **Data-quality appendix** — Panel 8: completeness %, the exception list, and which loadouts were excluded/needs-review and why; every finding cites its completeness context.
- **Methodology & sign conventions** — the variance definitions and sign convention (`_CARGO-SPEC.md` §7), so the report is self-explanatory to an auditor.
- **Estimated financial exposure (optional)** — only if `reporting_currency` is set and a defensible price exists, presented as a clearly-bounded range with its price source cited, tagged estimated, excluded from any documented total (`_CARGO-SPEC.md` §8; analytics §2.9).
- **Reproducibility footer** — the snapshot version, `computed_at`, procedure/methodology versions, and the reconciliation attestation (§9.3 of analytics: the report reconciles or it is not published).

Every table in the report is also available as an **Excel sheet** (one sheet per panel + a data-quality sheet + a raw-records sheet), because the numbers must always be downloadable (§1). Charts in the PDF are rendered from the same snapshot rows as their Excel tables.

### 8.2 Export framework (reusing platform conventions)

The export framework mirrors `reporting-and-dashboards.md` §4.3 (`accounting.report_exports`) exactly, in the `cargo` schema. A generated PDF/Excel is a **frozen, parameter-stamped artefact**, stored in Supabase Storage under a company-scoped path and indexed by **`cargo.report_exports(id, company_id, review_id, snapshot_version, report_key, params jsonb, format check ('pdf','xlsx','csv'), file_path, status check ('pending','generating','ready','failed'), base_or_reporting_currency char(3) null, generated_by, created_at, completed_at)`**. Storage path convention follows the platform: `fuel-report-exports/{company_id}/{review_id}/{snapshot_version}/{report_key}.{format}`; objects are never world-readable and are governed by the same membership + client-access rules. An export is **immutable once `ready`** — re-running produces a new export row, never an overwrite, so a figure sent to a client is always retrievable. The published snapshot's `report_pdf_path` / `report_xlsx_path` point at the canonical `ready` exports for that version.

CSV/Excel always available for any panel table (per-panel "download numbers"); PDF for the laid-out audit report. Phase 1 keeps generation simple/synchronous; an async worker/queue is a later optimization, swapped in behind the same export records (`reporting-and-dashboards.md` §4.3 note).

### 8.3 Branding and co-branding

The report and the published dashboard carry the fixed brand line **"TEAL Cargo Assurance — Powered by Taylor Engineering Limited"**, with **optional client co-branding** (the client's name/logo alongside, configured per client). The brand block is part of the snapshot (so a re-issue reproduces the exact branding of the published version) and is rendered consistently across the PDF cover, the Excel header block, and the published dashboard header. Co-branding never alters the figures or the findings; it is presentation only.

### 8.4 Multi-currency / financial exposure presentation (optional)

Following the platform multi-currency convention (`_ARCHITECTURE-SPEC.md` §8; `reporting-and-dashboards.md` §7), fuel **quantities** are the primary axis (review aggregation unit, e.g. m³); **financial exposure** is the optional secondary presentation. When `cargo.assurance_reviews.reporting_currency` is set, the exposure figure (analytics §2.9) is shown in that **reporting currency**, with its price source cited and a base-currency equivalent (`core.companies.base_currency_code`) available for internal portfolio rollups. Exposure is never mixed across currencies in one figure, never presented as an established loss, and omitted entirely when no `reporting_currency` or defensible price exists. This is the natural seam for the future Accounting link (credit/shortage claims) without making Accounting a dependency (`_CARGO-SPEC.md` §8).

---

## 9. Published snapshots: reproducibility

Reproducibility is non-negotiable (`_CARGO-SPEC.md` §4.7): a published report must be reconstructable byte-for-figure long after it was sent, immune to later edits. The mechanism is **`cargo.review_snapshots(id, review_id, company_id, version, snapshot jsonb, report_pdf_path, report_xlsx_path, created_by, created_at)`** with `(review_id, version)` unique (`_CARGO-SPEC.md` §6).

### 9.1 What the snapshot captures

At publish, the snapshot's `snapshot jsonb` freezes everything the published dashboard and report need, so they read **only the snapshot, never live views** (`cargo-aggregation-and-analytics.md` §9.2):

- **included records** — the exact set of approved `loadout` / `hire_period` ids (and their excluded siblings with reasons);
- **source-document versions** — the `cargo.documents` ids + `checksum`s of every contributing document, so the evidence base is pinned;
- **extracted / corrected values** — the `extracted_fields` + applied `field_corrections` as used at publish (later corrections do not mutate this);
- **template / methodology versions** — the pinned `client_procedures` version and `calculation_methodologies` version (`_CARGO-SPEC.md` §4.5);
- **results** — the period `review_aggregates.metrics` and the per-meter `meter_analytics` rows;
- **findings** — the approved `cargo.findings` statements with their statistics;
- **charts** — the panel/widget layout and the chart-backing rows (so a re-render produces the identical chart);
- **approval state** — who approved/published and when (`approved_by/at`, `published_by/at`), plus the §9.3 reconciliation attestation.

The snapshot is **self-describing**: it carries the reference/comparison method selections, the aggregation unit, the reporting currency, and the branding block, so nothing about its presentation depends on current configuration.

### 9.2 Revisions, never silent change

A later correction (a re-extracted document, a re-classified tank, a reversed exclusion) **never silently changes a published report** (`_CARGO-SPEC.md` §4.7). Instead it produces a **new snapshot version** (`version = previous + 1`) with its own PDF/Excel exports; the prior version remains retrievable and is what was sent. The published client dashboard shows the latest published version and offers prior versions for audit, with a clear "revised on / what changed" note. This mirrors the accounting discipline that posted history is corrected by new entries, never edits (`_ARCHITECTURE-SPEC.md` §6; `reporting-and-dashboards.md` §4.3).

### 9.3 Reconcile-or-don't-publish

A snapshot is only written if the review **reconciles** at publish (`cargo-aggregation-and-analytics.md` §9.3): view↔snapshot identity, waterfall closure (`Σ rep − Σ tc = Σ explained_bands + unexplained_residual`), transfer neutrality, no-double-count (unique `loadout_documents.document_id`), and findings↔aggregates agreement. An open `error`-severity exception blocks publish. The report therefore carries its own proof of integrity, exactly as accounting statements print their balance-check line (`reporting-and-dashboards.md` §9). A review that cannot reconcile is escalated, never cosmetically published.

---

## Open Questions

- **Live-view vs snapshot toggle in the internal dashboard.** After publish, an internal reviewer can see both the frozen published snapshot and the current live view (which may have drifted if records changed pending a revision). What is the default, and how is the "live differs from published" delta surfaced without implying the published figure is wrong?
- **Portfolio cross-review meter identity.** A physical meter tracked across reviews relies on `replaced_by_meter_id` chains and consistent `physical_id`. When a meter is re-registered or a terminal renames it, how is identity preserved so cross-review bias isn't broken — and is that a data-model concern or a presentation reconciliation here?
- **Co-branding scope.** Is client co-branding a single logo/name, or a fuller palette/footer set? And does any client ever require *their* branding to lead over the TEAL/Taylor line — which the fixed brand string currently forbids?
- **Excel report shape.** One workbook with a sheet per panel plus raw-records, or separate per-panel workbooks? And how much of the raw `loadout`/`measurement` detail belongs in the client Excel versus the internal-only export?
- **Snapshot size & storage.** A 12-month review with hundreds of loadouts, all documents/fields/charts, could make `snapshot jsonb` large. Do chart-backing rows live inline in `snapshot`, or as referenced export rows the snapshot points at, to keep the jsonb bounded?
- **Published-dashboard versioning UX.** How prominently are prior snapshot versions shown to a client viewer — a version dropdown, an "audit history" tab — without confusing the everyday reader who just wants the latest report?
- **Exposure price provenance.** Coordinated with `cargo-aggregation-and-analytics.md`'s open question: where the defensible `unit_price` for the reporting-currency exposure comes from, and how intra-period price variation is shown as a range on the client report.

## Decisions Locked

- **The primary surface is the period-level Assurance Dashboard**, not daily forms; the individual record is a *supporting drilldown* reached from a chart, never the landing page. (`_CARGO-SPEC.md` §1, §2; §1, §6)
- **Every chart is backed by a real computed aggregate**, every chart has a "show numbers" table reading the identical aggregate, and every table exports to Excel; panels with no approved data render honest empty states. (`_CARGO-SPEC.md` §4; §1, §4)
- **The nine panels map one-to-one to the analytics aggregates** — `review_aggregates`, `meter_analytics`, vessel comparison, the drift waterfall, and `findings` — and label their reference/comparison methods and data-completeness context; percentages are never summed (`Σ(cmp−ref)/Σ ref`). (`cargo-aggregation-and-analytics.md` §2–§8; §4)
- **Internal dashboards read live views (pre-publish); the client dashboard and PDF/Excel report read the frozen snapshot (post-publish)** — reproducibility over freshness once published. (`_CARGO-SPEC.md` §4.7; `cargo-aggregation-and-analytics.md` §9; §3, §8, §9)
- **The widget/layout model reuses the platform `dashboard_configs` contract** (`cargo.dashboard_configs`, scoped review/portfolio/client), every widget a reference to a real query, configurable and RLS-scoped. (`reporting-and-dashboards.md` §6; §5)
- **The drilldown exposes full source traceability** — matched documents, extracted/corrected values with source-page references, tank-level reconciliation, the three result layers, adjustments, confidence, and approval history — read-only for clients and showing only published records. (`_CARGO-SPEC.md` §4.1–§4.4; §6)
- **Client deliverables carry the fixed brand line "TEAL Cargo Assurance — Powered by Taylor Engineering Limited" with optional client co-branding**, frozen in the snapshot so re-issues reproduce exact branding. (§8.3, §9.1)
- **Exports are immutable, parameter-stamped artefacts** in Supabase Storage indexed by `cargo.report_exports`, mirroring `accounting.report_exports`; re-running creates a new export, never an overwrite; published PDF/Excel are the snapshot's canonical exports. (`reporting-and-dashboards.md` §4.3; §8.2)
- **A correction creates a new snapshot version, never a silent change** to a published report; prior versions remain retrievable with a "what changed" note. (`_CARGO-SPEC.md` §4.7; §9.2)
- **Publish is blocked unless the review reconciles** (view↔snapshot identity, waterfall closure, transfer neutrality, no-double-count, findings↔aggregates), and the report renders its own integrity attestation. (`cargo-aggregation-and-analytics.md` §9.3; §9.3)
- **Quantities are the primary axis; financial exposure is optional**, shown in `reporting_currency` with a base-currency equivalent for internal rollups, never mixed across currencies, never presented as an established loss, omitted when undefined. (`_CARGO-SPEC.md` §8; `reporting-and-dashboards.md` §7; §8.4)

---

*Cross-references:* `_CARGO-SPEC.md` (authoritative module spec — Assurance Review as primary record §2, roles & client isolation §3, non-negotiable principles §4, canonical `cargo` schema §6 incl. `review_snapshots`/`findings`/`dashboard` data, calculation invariants & sign conventions §7, future Accounting/exposure §8, delivery workflow §9, document conventions §10). `_ARCHITECTURE-SPEC.md` (platform core — database conventions §4, RLS/RBAC §7, multi-currency §8, non-negotiables §10, document conventions §11). `cargo-aggregation-and-analytics.md` (authoritative on *how every panel's number is computed* — period aggregates §2, meter bias §3, vessel comparison §4, drift waterfall §5, hire-period analytics §6, findings §7, weighted-% formulas §8, live-views-vs-snapshot materialization & reconciliation §9). `reporting-and-dashboards.md` (the platform precedent reused here — report definitions/parameters §4, `report_exports` frozen-artefact framework §4.3, `dashboard_configs` widget/layout model §6, multi-currency presentation §7, reconcile-in-report governance §9). Sibling Cargo Assurance docs (ingestion/extraction, calculation engine, data model, security, settings — named in `_CARGO-SPEC.md` §2) supply the documents, results, adjustments, findings, configuration, and client-access policies this presentation layer reads.*
