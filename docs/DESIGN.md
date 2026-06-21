# TEAL Enterprise — Design System

**Register:** Product (design serves the work, not the brand). Enterprise B2B platform.
**Scene:** A senior accountant / operations admin at a Trinidad maritime-services firm, working in
this all day on a desktop in an office, occasionally checking it on a phone or tablet on-site at a
fuel terminal. The mood must be **trustworthy, precise, calm** — dense financial and operational
data that stays legible for hours. Not flashy; quietly excellent.

## Theme & color

- **Light theme** is the default — long data sessions, print/export parity, the norm for accounting
  tools. (A dark theme may come later via the same tokens.)
- **Strategy: Restrained** — tinted neutrals + the teal brand as the single accent (≤ ~10% of surface).
- **Brand color is preserved:** teal `#0f766e` (≈ `oklch(0.52 0.09 180)`). Identity wins; we build a
  proper ramp around it rather than reinventing.
- Neutrals are tinted a hair toward the brand hue (cool, ~200) — **not** the warm cream/sand AI default.
- Semantic colors for finance: `success` (posted/positive), `warning` (draft/attention), `danger`
  (void/negative/errors). Debit/credit and positive/negative variance lean on ink weight + these.
- **Contrast is non-negotiable:** body text uses the dark ink ramp (≥4.5:1), never muted gray on
  tinted white. Muted is for de-emphasized labels only, and still clears 4.5:1.

## Typography

- One family, multiple weights: **Inter** (variable, self-hosted via `next/font`). Clean neo-grotesque,
  excellent for dense data; no font pairing (avoids the similar-but-not-identical trap).
- **Tabular figures** (`font-variant-numeric: tabular-nums`) on all money/quantity columns so digits
  align — essential for ledgers and reconciliation tables.
- Type scale (rem): xs .75 · sm .8125 · base **.9375 (15px)** · lg 1.0625 · xl 1.25 · 2xl 1.5 · 3xl 1.875.
  Headings use `text-wrap: balance`; long prose uses `text-wrap: pretty`. Body line length capped 65–75ch.

## Motion (Emil's framework)

- Subtle, fast, purposeful. UI transitions < 300ms; press feedback 100–160ms.
- Custom curves only: `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-drawer: cubic-bezier(0.32,0.72,0,1)`.
  Never `ease-in` on UI; never `transition: all`.
- Pressable elements get `:active { transform: scale(0.97) }`. Enter from `scale(0.97)+opacity`, never
  `scale(0)`. Animate only `transform`/`opacity`.
- Full `prefers-reduced-motion` fallback (crossfade/instant, no movement).

## Layout & responsive

- **Desktop:** global header (brand · company switcher · user) + a left module sidebar (`ModuleShell`).
- **Mobile:** header wraps; the module sidebar collapses to a sticky **horizontal scrolling nav** above
  the content (no fragile JS drawer). Everything is usable thumb-first.
- Grid for 2D, flex for 1D. Responsive grids use `repeat(auto-fit, minmax(…, 1fr))`. Tables scroll
  horizontally on small screens rather than reflowing into unreadable stacks.
- Cards are used sparingly (module launcher, summary tiles) — never nested, never an endless identical grid.

## Tokens

All defined in `app/globals.css` as CSS custom properties: color ramp, type scale, spacing, radius
(`--r-sm/--r/--r-lg`), subtle layered shadows, a **semantic z-index scale** (dropdown → sticky →
drawer → modal → toast → tooltip), and the motion curves/durations. Components consume tokens +
a small set of utility classes (`.btn`, `.input`, `.card`, `.badge`, `.nav-link`, `.num`, …).

## Anti-slop guardrails (enforced)

No side-stripe accent borders, no gradient text, no decorative glassmorphism, no hero-metric template,
no per-section uppercase eyebrows, no identical-card grids, no text overflow at any breakpoint. If an
interface could be flagged "AI made that," rework it.
