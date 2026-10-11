---
id: zero.frontend.components.arc-charts
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: zero-charts
maturity: supported
applies_to: ["2.6.0 working source"]
modes: [browser, SSR, light, dark]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Arc Charts

[Charts index](./index.md) · [Components](../components/index.md) · [Zero Charts](sankey.md) · [Theme ledger](../../_work/design-token-theme-evolution-plan.md#arc-chart-extension)

Twelve Arc-derived charts extend Zero Charts with animated trends, proportions,
calendar activity, distributions and hierarchical drill-down. They retain the
source chart geometry and interactions, but use Zero data contracts, theme roles
and overlay ownership. They do not fetch data, execute queries, or acknowledge
business events through animation.

This family is separate from the custom [Sankey](sankey.md),
[Race Bar](race-bar.md), [Funnel](funnel.md), and the supported
[Recharts composition](../components/primitives/charts.md). Import the family you need:

| Entry | Responsibility |
| --- | --- |
| `@zero/framework/components/charts/arc` | The twelve React organisms, typed props and inspector contexts. |
| `@zero/framework/charts/arc` | Browser-independent admission, detached models and geometry/statistics helpers. |
| `@zero/framework/charts/react` | The existing authorization-aware, bounded reactive collection projector. |

Import `@zero/framework/styles.css` once. Source-copy users can run
`zero add components/charts/arc` and import `components/charts/arc/arc-charts.css`
in their stylesheet; that skin includes the shared chart tokens. The broader
`zero add components/charts` target also includes this folder. Test fixtures and
backend services are excluded from the copy. No Arc global theme or external
font installation is required.

## Choosing a Chart

| Component | Input | Distinctive behavior |
| --- | --- | --- |
| `LineChart` | Ordered identified observations, identified series and per-series values | Monotone or straight curves, area/dashed series, moving crosshair, series toggles, loading/empty states. |
| `BarChart` | Identified labeled nonnegative values; required `period` | Animated average readout and reference line, rolling digits, spring-following scrubber. |
| `DonutChart` | Identified parts of a nonnegative total | Rounded arcs, grouped small parts, synced legend, hover preview and pinned selection, hide/select legend modes. |
| `Streamgraph` | Ordered identified observations with identified nonnegative series | Wiggle, silhouette or zero baseline; layer toggles, direct labels and exact-value inspection. |
| `BrushChart` | Strictly increasing unique timestamps and nonnegative values | Overview selection, drag/pan/resize, keyboard stepping, annotation markers and date inspection. |
| `WaffleChart` | Identified parts of a nonnegative total | Exact fixed-cell allocation, persistent category cells, animated shares, categorical focus. |
| `SlopeChart` | Identified signed start/end pairs; required moment labels | Rank changes, collision-aware labels, highlight and focus; delta is `end − start`. |
| `Sparkline` | Ordered numeric array, optionally one label per observation | Compact stroke and readout, status tone, optional pointer/keyboard scrubbing. |
| `Gauge` | Numeric value, genuine increasing `min`/`max`, optional thresholds | 270° arc, animated numeric readout, semantic threshold bands and out-of-range disclosure. |
| `ActivityHeatmap` | Gregorian UTC `YYYY-MM-DD` dates with integer counts; required `period` | Wave entrance, sweep updates, four activity levels, keyboard day/week navigation, selection and level preview. |
| `Ridgeline` | Identified series of signed raw observations | Gaussian kernel densities, empirical quartiles/median, smoothing/domain controls, lifted focus. |
| `Treemap` | A uniquely identified bounded tree with nonnegative leaf sizes | Squarified areas, branch drill-down/breadcrumbs, optional second-measure shading and keyboard navigation. |

The animated counter is not a chart organism, and Pro Split Bar is not included
in this twelve-chart family. Component source references and exact upstream token
choices are recorded in the [implementation ledger](../../_work/design-token-theme-evolution-plan.md#arc-chart-extension).

## Static Data

These complete examples use synthetic measurements. Give charts a shrinkable
parent (`min-width: 0` in grids), and update props immutably when measurements
change. The renderer validates inputs before painting them.

```tsx
import { LineChart, BarChart, DonutChart, Streamgraph, BrushChart, WaffleChart,
  SlopeChart, Sparkline, Gauge, ActivityHeatmap, Ridgeline, Treemap
} from '@zero/framework/components/charts/arc';

const series = [{ id: 'direct', label: 'Direct' }, { id: 'referral', label: 'Referral' }];
const observations = [
  { id: 'sep', label: 'September', axisLabel: 'Sep', values: { direct: 12, referral: 8 } },
  { id: 'oct', label: 'October', axisLabel: 'Oct', values: { direct: 18, referral: 6 } },
];
const parts = [{ id: 'direct', label: 'Direct', value: 60 }, { id: 'referral', label: 'Referral', value: 40 }];

export function ChartExamples() {
  return <div style={{ display: 'grid', gap: 32, minWidth: 0 }}>
    <LineChart label="Visits by source" data={observations} series={series} />
    <BarChart label="Visits" period="Sep–Oct 2026" data={[
      { id: 'sep', label: 'September', value: 20 }, { id: 'oct', label: 'October', value: 24 },
    ]} />
    <DonutChart label="Source share" data={parts} />
    <Streamgraph label="Source mix over time" data={observations} series={series} offset="wiggle" />
    <BrushChart label="Daily visits" minSpan={86_400_000} data={[
      { date: Date.UTC(2026, 9, 1), value: 20 }, { date: Date.UTC(2026, 9, 2), value: 24 },
    ]} />
    <WaffleChart label="Source units" data={parts} rows={10} columns={10} />
    <SlopeChart label="Visits changed" startLabel="September" endLabel="October" data={[
      { id: 'direct', label: 'Direct', start: 12, end: 18 },
      { id: 'referral', label: 'Referral', start: 8, end: 6 },
    ]} />
    <Sparkline label="Visit trend" data={[20, 22, 19, 24]} labels={['Mon', 'Tue', 'Wed', 'Thu']} />
    <Gauge label="Capacity used" value={62} min={0} max={100} />
    <ActivityHeatmap label="Daily contributions" period="October 2026" days={[
      { date: '2026-10-01', count: 12 }, { date: '2026-10-03', count: 24 },
    ]} />
    <Ridgeline label="Observed latency" unit="ms" series={[
      { id: 'baseline', label: 'Baseline', values: [12, 18, 20, 22, 25] },
      { id: 'current', label: 'Current', values: [10, 12, 15, 18, 20] },
    ]} />
    <Treemap label="Visits by hierarchy" data={{ id: 'root', label: 'All sources', children: parts }} />
  </div>;
}
```

## Data Integrity and Limits

IDs are explicit `id` fields, not Arc's original `key` fields. They are unique,
nonempty strings of at most 256 characters. Reordering labels must not change
identity. Brush observations use their timestamp identity; Sparkline's numeric
array uses its index. Nonempty accessible chart labels are required.

Inputs are bounded own-data records/arrays. Invalid dates, duplicate identities,
getters, sparse arrays, nonfinite numbers and unsupported shapes are rejected,
not coerced or silently truncated. Models detach admitted data. Use the exported
builders in a query projector or error boundary when rejection should become
an application error state instead of reaching the renderer.

This Arc presentation domain supports measured numeric magnitudes up to `1e12`;
relevant totals also have explicit bounds. Timestamps/calendar boundaries have
their own valid-date domain, not the measurement-value cap. Rescale or aggregate larger measurements upstream
and name the unit. The limit is not a ReactiveDB storage limit. Line, Sparkline,
Slope and Ridgeline admit signed measurements; counts, parts, areas and stacked
series are nonnegative. Missing own series values mean zero. Unknown series IDs
are errors, not hidden measurements.

| Family | Work budget |
| --- | --- |
| Line / Bar / Sparkline | At most 4096 observations; Line at most 16 series and 65,536 value cells. |
| Brush | At most 32,768 strictly increasing observations and 128 annotations. |
| Donut / Waffle | At most 256 categories; Donut at most 64 drawn segments; Waffle dimensions 1–64 and at most 4096 cells. |
| Streamgraph | At most 32 series, 1024 observations and 32,768 value cells. |
| Slope / Ridgeline | At most 64 items/ridges; Ridgeline at most 16,384 total raw observations. |
| Gauge | At most 64 ordered, uniquely positioned thresholds within its range. |
| Activity | At most 10,000 observations and a 3660-day calendar span. |
| Treemap | At most 2048 nodes and depth 16; cycles/shared-node aliases and duplicate IDs are errors. |

Donut groups retain exact member values and use collision-safe internal identities
for “Other” and the total. Waffle largest-remainder allocation fills the requested
cell count exactly when total is positive; cell counts are an approximation of
shares, while the inspector/table report original measurements. Zero total is not
invented as an equal split.

Activity dates are strictly parsed in UTC, so DST/local timezone cannot shift a
cell. Duplicate date observations aggregate, missing days inside the admitted
range are explicit zeroes, and malformed rollover dates are rejected. Ridgeline
densities are smoothed estimates; its inspected percentile is the empirical share
of actual observations, not a claim of model certainty. An empty ridge has no
quartiles, median or extrema; these statistics are null and the exact table shows
placeholders instead of fabricated zeroes. Treemap branch area sums
its leaves; second-measure color uses their size-weighted mean.

## Controls and Defaults

Every organism accepts `className` and `motion={false}`. Motion does not change
measurements. Reduced-motion preferences are honored; revealed charts settle and
stop their geometry work offscreen or in a hidden document. Accessible exact-data
companions render on the server without requiring a browser or provider.

| Component | Principal settings and defaults |
| --- | --- |
| Line | `height=220`, `curve="smooth"`; `formatValue`, `formatTick`, `unit`, `legend`, `categoryLabel`, `loading`, `emptyLabel`; `hiddenSeries` / `defaultHiddenSeries` / `onHiddenSeriesChange`; `activeDatumId` / `defaultActiveDatumId` / `onActiveChange`. |
| Bar | `height=176`; `averageLabel`, `valueLabel`, `showAverage`, `formatValue`, `unit`, `categoryLabel`, `period`; `activeDatumId` / `defaultActiveDatumId` / `onActiveChange`. |
| Donut | `size=208`, `thickness=24`, `groupBelow=.04`, `maxSegments=6`; `totalLabel`, `otherLabel`, formatting, legend and `legendAction="toggle"` or `"select"`; active and hidden IDs have controlled/default/callback forms. |
| Streamgraph | `height=260`, `offset="wiggle"`, legend/direct labels on; `hiddenSeriesIds` / `defaultHiddenSeriesIds` / `onHiddenSeriesChange`, formatting and category label. |
| Brush | `height=240`, `overviewHeight=52`, `minSpan=7 days`; `range` / `defaultRange` / `onRangeChange`, annotations, value/tick/date formatting; `activeDate` / `defaultActiveDate` / `onActiveChange`. |
| Waffle | `rows=10`, `columns=10`, `decimals=0`; `accentId`, active/default IDs, legend, unit and formatting. |
| Slope | Optional height, default at least 200 and 44px per item; `ranks=true`, `highlightId`, `activeId`, `onActiveChange`, `formatValue`, `formatChange`. |
| Sparkline | `width=160`, `height=52`; `value`, `change`, `tone`, `labels`, `area`, `interactive`, `activeIndex` / `defaultActiveIndex` / `onActiveChange`. |
| Gauge | `min=0`, `max=100`, `tone="accent"`; `detail`, thresholds and semantic success/warning/danger tones. |
| Activity | Sunday week start, `locale="en-US"`; thresholds, singular/plural unit, `selectedDate` / `onSelectDate`, caller-supplied `actions`. |
| Ridgeline | `rowHeight=30`, `overlap=2.4`, tint on; domain, bandwidth, unit/formatting and active/default series IDs. |
| Treemap | `height=420`; focus/default focus IDs and callback, color measure label/domain/formatter and value formatter. |

Callbacks request controlled changes; the component does not mutate the caller's
controlled state. Removed IDs are masked instead of inspecting a different record
at the old position. Use stable IDs in application selections and clear them when
the authorized measurement scope changes.

Line and Bar `onActiveChange(index, datum)` request inspection of the supplied
observation, or `(null, null)` to clear it. Store `datum.id` in `activeDatumId`
to accept that request; use `defaultActiveDatumId` for internally managed initial
inspection. Brush uses the observation's epoch-millisecond timestamp instead:
`onActiveChange(date, datum)` requests `activeDate`, while `defaultActiveDate`
initializes uncontrolled inspection. An observation outside the accepted Brush
window is not inspected, even if its identity remains in the supplied data.

```tsx
import { useState } from 'react';
import { LineChart } from '@zero/framework/components/charts/arc';
import type { LineChartDatum, LineChartSeries } from '@zero/framework/charts/arc';

export function ControlledTrend({ data, series }: {
  data: readonly LineChartDatum[]; series: readonly LineChartSeries[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  return <LineChart label="Authorized trend" data={data} series={series}
    activeDatumId={active} onActiveChange={(_index, datum) => setActive(datum?.id ?? null)}
    hiddenSeries={hidden} onHiddenSeriesChange={setHidden} />;
}
```

## Reactive Zero Data

Use the existing `useChartQuery` bridge, not a per-chart subscription. It projects
bounded authorized full-sync collections and masks prior data on scope or authority
retirement. It rejects lazy/auto collections and applies the row budget before a
predicate can hide excess rows. `connected` is connectivity, not proof that a
whole-dataset baseline is ready.

```tsx
import { DonutChart } from '@zero/framework/components/charts/arc';
import { buildDonutModel } from '@zero/framework/charts/arc';
import { useChartQuery } from '@zero/framework/charts/react';
import type { Row } from '@zero/framework/sync';

type PartRow = Row & { id: string; label: string; value: number };
const projectParts = (rows: readonly PartRow[]) => buildDonutModel(
  rows.map(row => ({ id: row.id, label: row.label, value: row.value }))
);

export function ReactiveSourceShare({ baselineReady }: { baselineReady: boolean }) {
  const query = useChartQuery<PartRow, ReturnType<typeof projectParts>>({
    table: 'analytics_parts', maxRows: 256, project: projectParts,
  });
  if (query.error) return <p role="alert">Unable to display this aggregate: {query.error.message}</p>;
  if (!query.readable || !baselineReady || !query.data) return <p role="status">Waiting for the authorized aggregate.</p>;
  return <DonutChart label="Visits by source" data={query.data.data} unit="visits" />;
}
```

This assumes an existing registered full-sync aggregate collection and a caller
that knows when its authorized baseline is complete. Inserts, updates and deletes
then drive immutable projections and chart transitions. If server functions,
triggers or Fabric write those aggregate rows, their existing authorization,
measurement-window and receipt contracts still own correctness. Charts do not
create a new server rollup service, query paginated rows as a complete population,
or treat a decorative spring as a successful write.

The same bridge can project a Line/Streamgraph history, Activity calendar or
Treemap tree. Normalize and authorize relationships upstream; avoid unbounded
client scans and joining partial independently loaded collections as if they were
one consistent snapshot. Named server aggregate services remain separate
[roadmap work](../../_work/charts-system-plan.md).

## Inspection and Accessibility

Pointer, touch and keyboard inspection expose exact admitted values. Charts use
appropriate arrow/Home/End/Escape traversal; Brush also supports overview stepping
and annotation focus, Activity moves by day/week, and Treemap navigates branches.
Accessible data companions report exact measurements or statistics rather than
sampled SVG geometry. Their scope follows the chart's presentation: Brush lists
observations in the accepted time window; Donut lists visible, unhidden members,
including the individual members of grouped segments. Ridgeline lists exact
descriptive statistics, not every raw observation. Other full-data companions can
include observations whose labels or geometry do not fit the current plot.

Analytical inspectors use Zero Tooltip's portal, collision and overlay-owner
behavior. They are non-interactive; use an explicit popover for editable content
or actions. The compact Bar/Sparkline/Gauge readouts need no floating panel.
Line, Streamgraph, Slope, Ridgeline and Treemap accept `renderTooltip`;
Waffle accepts `renderCategoryTooltip`, and Activity accepts `renderDayTooltip`.
Return `undefined` for the default body or `null` to suppress it. Contexts contain
actual admitted records and statistics; ordinary React escaping applies.

```tsx
import { Ridgeline } from '@zero/framework/components/charts/arc';
import type { RidgelineSeries } from '@zero/framework/charts/arc';

export function ExplainedDistribution({ series }: { series: readonly RidgelineSeries[] }) {
  return <Ridgeline label="Observed latency" series={series} unit="ms"
    renderTooltip={({ series: current, stats, empiricalShare }) => <>
      <strong>{current.label}</strong>
      <p>{stats.n} observations; median {stats.median} ms</p>
      {empiricalShare !== null && <p>{(empiricalShare * 100).toFixed(1)}% observed at or below this value</p>}
    </>} />;
}
```

## Tokens and Composition

Local `--zero-arc-*` paint overrides resolve at their consuming DOM/SVG site,
then shared `--zero-chart-*` roles, then the active Zero theme. Surfaces, text,
borders and platform font stacks are inherited. Named chart colors map the first
four categorical Arc series to blue/purple/amber/teal; Line's deliberate neutral
comparison series and neutral overflow categories remain meaningful.

Ordinary analytical inspectors inherit the shared rounding, spacing, type and
elevation. The Activity inverted calendar hint is a deliberate compact variant,
not a separate global tooltip theme. Arc's spacing/type/motion candidates remain
namespaced and are inventoried for the future theme pass; global `--chart-1`…`-5`
and existing application theme defaults are unchanged.

```tsx
import type { CSSProperties } from 'react';
import { DonutChart } from '@zero/framework/components/charts/arc';

const chartTheme = {
  '--zero-chart-purple': '#9267dc',
  '--zero-chart-inspector-radius': '10px',
  '--zero-arc-font-body': 'var(--font-platform-sans)',
} as CSSProperties;

export function ScopedChartTheme() {
  return <section style={chartTheme}>
    <DonutChart label="Scoped source share" data={[
      { id: 'direct', label: 'Direct', value: 60 }, { id: 'referral', label: 'Referral', value: 40 },
    ]} />
  </section>;
}
```

Pure model files, scoped skins, motion/environment utilities, inspector content
and organisms are separate responsibilities. Use the headless facade for
prevalidated projection or server-side calculations; it imports no renderer,
browser animation runtime, database or provider. The
[chart plan](../../_work/charts-system-plan.md#arc-free-chart-extension) records
working-source qualification and remaining service/theme work.
