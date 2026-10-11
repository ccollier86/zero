---
id: zero.frontend.components.native-charts
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

# Handmade Charts

[Charts index](./index.md) · [Components](../components/index.md) · [Zero Charts](sankey.md) · [Arc Charts](arc.md) · [Theme ledger](../../_work/design-token-theme-evolution-plan.md#handmade-chart-coverage-extension)

These original SVG/DOM organisms fill the common analytical gaps in Zero Charts:
quantitative and mixed Cartesian charts, statistical distributions, polar
comparisons, hierarchy partitions and observed-time streams. They share Zero's
analytical typography, named series palette, motion and portaled inspection.
They do not embed Recharts, D3 or another chart engine. Motion is a presentation
dependency, not a source of data or a chart renderer.

The installed Recharts source informed mathematical behavior and capability
coverage only. Its renderer, provider, data types and theme are not copied into
this family. The existing [Recharts composition](../components/primitives/charts.md) remains
supported; adopting a handmade chart is an explicit application choice.

## Public Entries

| Entry | Responsibility |
| --- | --- |
| `@zero/framework/components/charts/native` | Nineteen named React exports: the generic Cartesian composer, eight Cartesian presets and ten other organisms. |
| `@zero/framework/components/charts` | Existing custom charts, the native exports, and the typed `ZeroChart` dispatcher. |
| `@zero/framework/charts/native` | Browser-independent admission, models, scales, geometry and statistics; also available from `/charts`. |
| `@zero/framework/charts/react` | The existing authorization-aware reactive collection projector, `useChartQuery`. |

Import `@zero/framework/styles.css` once. Source-copy consumers can run
`zero add components/charts/native`, then import the copied
`components/charts/native/native-charts.css`. The broader
`zero add components/charts` target includes the native folder too. Tests,
browser fixtures and backend services are not copied into presentation.

`ZeroChart` chooses an organism using a typed `kind`, preserving that organism's
actual input and settings contract. It is not a universal data object, fetcher,
subscription manager or automatic chart recommendation engine. It also dispatches
the existing Sankey, Race Bar, Funnel and twelve Arc charts. Use `arc-line` and
`arc-bar` for the Arc variants; `line` is the native XY line.

## Choose the Geometry

| Component / `kind` | Input and distinct capability |
| --- | --- |
| `CartesianChart` / `cartesian` | Identified observations and series; compose lines, areas, bars and points on named axes. |
| `XYLineChart` / `line` | Category, numeric or epoch-time X with linear, smooth or step curves; gaps, exact intervals and optional dashed series. |
| `AreaChart` / `area` | Independent baselines, signed measures, interval bands and stacked/percent areas. |
| `GroupedBarChart` / `grouped-bar` | Side-by-side category comparisons. |
| `StackedBarChart` / `stacked-bar` | Separate positive/negative accumulators by default; explicit stack groups and percentage mode. |
| `HorizontalBarChart` / `horizontal-bar` | Horizontal comparisons with the same signed/grouped/stacked data semantics. |
| `ComposedChart` / `composed` | Mixed marks, named dual axes, reference lines and bands. |
| `ScatterChart` / `scatter` | Genuine numeric XY coordinates, exact intervals and individual point inspection. |
| `BubbleChart` / `bubble` | Scatter with nonnegative measured size mapped to circle area, not radius. Zero size draws no bubble. |
| `HistogramChart` / `histogram` | Real observed bin membership, explicit or counted bins, endpoint policy, count/proportion/density. |
| `MatrixHeatmap` / `matrix-heatmap` | Arbitrary row/column measures; absent/null cells remain missing, distinct from a real zero. |
| `BoxPlotChart` / `box-plot` | Observations or explicitly supplied summaries; type-7 quartiles, Tukey/min–max whiskers and actual outliers. |
| `WaterfallChart` / `waterfall` | Signed contributions, computed subtotals and explicit absolute balance resets. |
| `CandlestickChart` / `candlestick` | Strictly ordered, validated OHLC and optional volume; uniform or genuine timestamp spacing. |
| `RadarChart` / `radar` | Multiple profiles with a genuine range per axis; raw overflow remains disclosed. |
| `RadialBarChart` / `radial-bar` | Independent measured rings with real minima/maxima, offset ranges and overflow disclosure. |
| `PieChart` / `pie` | A solid pie whose positive slices are proportional to the visible total; no invented minimum angle. |
| `SunburstChart` / `sunburst` | Additive hierarchy partition, branch drill, stable colors and breadcrumbs. |
| `RealtimeChart` / `realtime` | Ordered retained observations with null gaps, genuine event timestamps, anomalies and a held inspection window. |

These exports are presets and organisms, not nineteen independent mathematical
families. Start with the smallest preset that expresses the measurement.

## Static Composition

Stable IDs identify records and series independently of display labels. Keep the
parent shrinkable (`min-width: 0`) and replace data immutably when it changes.
The following complete example uses only synthetic observations.

```tsx
import { ZeroChart } from '@zero/framework/components/charts';
import type { RadarAxis } from '@zero/framework/charts/native';

const series = [{ id: 'requests', label: 'Requests' }, { id: 'retries', label: 'Retries' }];
const data = [
  { id: 'mon', label: 'Monday', x: 1, values: { requests: 30, retries: 4 } },
  { id: 'tue', label: 'Tuesday', x: 2, values: { requests: 42, retries: 6 } },
  { id: 'wed', label: 'Wednesday', x: 4, values: { requests: 36, retries: 2 } },
];
const axes: readonly RadarAxis[] = [
  { id: 'speed', label: 'Speed', max: 100 },
  { id: 'quality', label: 'Quality', max: 100 },
  { id: 'capacity', label: 'Capacity', max: 100 },
];

export function HandmadeExamples() {
  return <div style={{ display: 'grid', gap: 32, minWidth: 0 }}>
    <ZeroChart kind="line" label="Requests over time" data={data} series={series} xAxis={{ type: 'linear' }} />
    <ZeroChart kind="stacked-bar" label="Requests and retries" data={data} series={series} stack="percent" />
    <ZeroChart kind="histogram" label="Observed latency" observations={[4, 8, 12, 12, 18, 25].map((value, i) => ({ id: String(i), value }))} binning={{ edges: [0, 10, 20, 30] }} />
    <ZeroChart kind="matrix-heatmap" label="Regional requests" data={{
      rows: [{ id: 'api', label: 'API' }], columns: [{ id: 'us', label: 'US' }, { id: 'eu', label: 'Europe' }],
      cells: [{ id: 'us-api', rowId: 'api', columnId: 'us', value: 42 }, { id: 'eu-api', rowId: 'api', columnId: 'eu', value: null }],
    }} />
    <ZeroChart kind="box-plot" label="Latency distribution" series={[{ id: 'api', label: 'API', values: [4, 8, 12, 12, 18, 25, 90] }]} />
    <ZeroChart kind="waterfall" label="Balance" startingValue={20} steps={[
      { id: 'sales', label: 'Sales', kind: 'contribution', value: 80 },
      { id: 'costs', label: 'Costs', kind: 'contribution', value: -30 },
      { id: 'balance', label: 'Balance', kind: 'subtotal' },
    ]} />
    <ZeroChart kind="candlestick" label="Observed price" showVolume data={[
      { id: 'open', label: 'Opening', time: 1000, open: 20, low: 18, high: 25, close: 24, volume: 100 },
      { id: 'close', label: 'Closing', time: 2000, open: 24, low: 19, high: 26, close: 21, volume: 120 },
    ]} />
    <ZeroChart kind="radar" label="Service profile" axes={axes} profiles={[{ id: 'api', label: 'API', values: [{ id: 'speed', value: 80 }, { id: 'quality', value: 90 }, { id: 'capacity', value: 70 }] }]} />
    <ZeroChart kind="radial-bar" label="Range use" data={[{ id: 'capacity', label: 'Capacity', value: 60, min: 20, max: 100 }]} />
    <ZeroChart kind="pie" label="Source share" data={[{ id: 'direct', label: 'Direct', value: 65 }, { id: 'referral', label: 'Referral', value: 35 }]} />
    <ZeroChart kind="sunburst" label="Source hierarchy" data={{ id: 'root', label: 'All sources', children: [{ id: 'direct', label: 'Direct', value: 65 }, { id: 'referral', label: 'Referral', value: 35 }] }} />
  </div>;
}
```

## Cartesian Settings

Each datum has `id`, `label`, optional `x`, and a `values` record indexed by series
ID. A cell is a number, `null`, or `{ value, low?, high?, size? }`. Interval
endpoints are exact measurements, not standard errors inferred by the renderer.
Use `missing="zero"` only when absence genuinely means zero; the default is a gap.
`connectNulls` is an explicit series-level presentation choice.

| Setting | Meaning / default |
| --- | --- |
| `xAxis` | `type="category"` by default, or `linear` / `time`; optional domain and label. Numeric/time records are sorted by genuine X in the detached model. |
| `yAxes` | Up to two identified axes with left/right side, linear/log scale, domain, zero inclusion and label. Every series refers to an existing axis. |
| `layout` | `vertical` by default; `horizontal` transposes the independent and measured axes. |
| `stack` | `none` on the composer; `signed` on Stacked Bar. `stacked`, `signed` and nonnegative `percent` are explicit modes. Groups never combine across axes. |
| Series | `mark`, `curve`, `axisId`, `stackId`, `baseline`, `connectNulls`, `bubble`, `dashed`, and optional safe paint color. Presets select their own marks. |
| References | Identified `references` and `bands` use real X/Y quantities and optional axis/label/color, not pixel positions. |
| Presentation | `height=300`, grid enabled, automatic multi-series legend, optional `brush` window controls, `emptyLabel`, formatting and `motion`. |
| Inspection | `active` / `defaultActive` / `onActiveChange`; selection is `{ datumId, seriesId? }`. |
| Visibility | `hiddenSeriesIds` / `defaultHiddenSeriesIds` / `onHiddenSeriesChange`. |
| Window | `window` / `defaultWindow` / `onWindowChange`; category indexes or real numeric/time X coordinates, not offsets in a changing dataset. |

Log axes require positive measured domains and quantities; a zero baseline cannot
be silently plotted on a logarithmic scale. Percent stacks reject negative input
and normalize by the relevant axis/stack group. A zero total remains zero, not an
equal allocation. Explicit domains clip geometry while exact raw data stays in
the accessible companion. Automatic numeric/time layouts reserve space for the
complete endpoint bar groups and scatter/bubble circles without changing raw X
domains or spacing. Explicit domains remain authoritative clipping boundaries.
Bubble area is proportional to admitted `size`; only visible bubble series
contribute to its size domain, not unrelated line/bar metadata.
Raw low/high intervals cannot be combined on normalized percent-stacked series: those axes have
different units. This combination is rejected, not silently reinterpreted as a
normalized confidence interval. Ordinary and signed/arithmetic stack intervals
remain absolute measured-axis bounds, not cumulative offsets.
Area marks render supplied low/high measurements as filled interval bands using
the same series paint and area-opacity token. Missing measurements or bounds
split a band unless that series explicitly requests `connectNulls`; isolated
intervals remain whiskers. Other marks retain their point-wise whiskers. Bounds
are supplied facts, not inferred confidence levels or cumulative stack offsets.
Numerically indistinguishable smooth-curve neighbors use a finite straight
segment rather than emitting an invalid SVG path.

```tsx
import { useState } from 'react';
import { ComposedChart } from '@zero/framework/components/charts/native';
import type { CartesianActive, CartesianDatum } from '@zero/framework/charts/native';

export function ControlledMeasures({ data }: { data: readonly CartesianDatum[] }) {
  const [active, setActive] = useState<CartesianActive | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [window, setWindow] = useState<[number, number]>([0, 6]);
  return <ComposedChart label="Volume and latency" data={data} series={[
    { id: 'volume', label: 'Volume', mark: 'bar', axisId: 'count' },
    { id: 'latency', label: 'Latency', mark: 'line', axisId: 'ms', curve: 'smooth' },
  ]} yAxes={[{ id: 'count', label: 'Count' }, { id: 'ms', label: 'Milliseconds', side: 'right' }]}
    references={[{ id: 'budget', axis: 'y', axisId: 'ms', value: 200, label: 'Latency budget' }]}
    active={active} onActiveChange={setActive} hiddenSeriesIds={hidden} onHiddenSeriesChange={setHidden}
    brush window={window} onWindowChange={setWindow} />;
}
```

Controlled callbacks request a change; they do not alter accepted props. Retired
IDs are masked, and uncontrolled retired IDs do not resurrect on reinsertion.
Keep application-controlled selections tied to the authorized data scope.
Keyboard traversal skips missing cells in a selected series instead of clearing
its position; observation-level inspection still exposes missing measurements,
and changing series skips unavailable cells at that observation.

## Statistical and Polar Settings

The five statistical charts share `label`, optional title/subtitle, `height=300`,
class/motion/formatting, and `activeId` / `defaultActiveId` / `onActiveChange`.
They always provide their exact server-rendered data companion.

| Organism | Additional settings and mathematical policy |
| --- | --- |
| Histogram | `binning` has `count`, optional domain, and `closed="left"` by default; explicit `edges` exclude count/domain settings. `measure="count"`, `proportion` or `density`. The final left-closed endpoint and first right-closed endpoint are included. Underflow/overflow are explicit; proportions/densities use all supplied observations as the population. |
| Matrix | Ordered row/column IDs and explicitly identified cells; the admitted domain derives from real measured cells. Formatting and scoped color roles control presentation. Null/absent cells never become zero. |
| Box Plot | `whiskers="tukey"` or `"min-max"`; exactly one of observations (`values`) or a validated `summary` per series. No synthetic population is reconstructed from summaries. Empty statistics are null. |
| Waterfall | `startingValue=0`; `contribution` adds a signed delta, `subtotal` reports the derived running balance, and `total` supplies an absolute balance reset. Scoped positive/negative/series tokens select colors. |
| Candlestick | `spacing="uniform"` or `"time"`, optional `showVolume`, scoped positive/negative colors. Timestamps strictly increase; low/high contain open/close. Missing volume remains missing rather than zero. |
| Radar | Required per-axis maxima, optional minima; identified profiles must supply actual values for the axes. `levels=4`, profile visibility/selection and optional colors. |
| Radial Bar | Required per-ring maximum, optional minimum; start/end angles, inner-radius ratio, ring gap and legend. Out-of-range raw values are disclosed while paint is clipped. |
| Pie | Start angle, unit, legend and controlled/default/callback hidden IDs. Shares refer to the visible positive total; the full table retains hidden measurements. |
| Sunburst | Controlled/default/callback `rootId`, stable selection, start angle and branch colors. Parent totals are additive; contradictory declared totals, cycles and shared aliases are rejected. |

Polar charts accept bounded width/height and independent profile/ring/slice/node
inspection. Their default nominal layout is 480×380; the SVG scales into its
parent while compact text remains physically legible. Sunburst drill preserves
source branch colors rather than changing a surviving ID's meaning.
Keyboard inspection has a persistent, atomic live readout linked to the focused
plot, independently of visual/custom tooltip visibility. Enter/Space acts on the
currently inspected identity even after a pointer leaves the plot.
Sunburst uses compensated additive sums and a small floating-point roundoff
allowance, not an absolute near-zero tolerance: a declared zero cannot represent
positive descendants. Exact declared and derived values remain in its companion.
Raw-series whisker policies apply to observations; a supplied Box Plot summary
retains its validated stated whiskers rather than fabricating new ones.

## Reactive Zero Data

Use `useChartQuery` to project an existing bounded, authorized **full-sync**
collection. Do not introduce a subscription in each chart. The projector admits
data before render and masks stale data when a projection fails or authority/scope
is retired. A connected transport alone does not prove a complete baseline.

```tsx
import { XYLineChart } from '@zero/framework/components/charts/native';
import { buildCartesianModel } from '@zero/framework/charts/native';
import { useChartQuery } from '@zero/framework/charts/react';
import type { Row } from '@zero/framework/sync';

type MetricRow = Row & { id: string; label: string; time: number; count: number };
const series = [{ id: 'requests', label: 'Requests' }];
const project = (rows: readonly MetricRow[]) => {
  const data = rows.map(row => ({ id: row.id, label: row.label, x: row.time, values: { requests: row.count } }));
  buildCartesianModel(data, series, { xAxis: { type: 'time' } });
  return { data, series };
};

export function ReactiveRequests({ baselineReady }: { baselineReady: boolean }) {
  const query = useChartQuery<MetricRow, ReturnType<typeof project>>({ table: 'analytics_requests', maxRows: 4096, project });
  if (query.error) return <p role="alert">Chart unavailable: {query.error.message}</p>;
  if (!query.readable || !baselineReady || !query.data) return <p role="status">Waiting for the authorized baseline.</p>;
  return <XYLineChart label="Requests over time" data={query.data.data} series={query.data.series} xAxis={{ type: 'time' }}
    formatX={value => new Date(Number(value)).toISOString()} />;
}
```

Existing database functions, triggers or Fabric can maintain the aggregate rows.
Their authorization, receipt, measurement-window and consistency contracts own
correctness. This component layer does not register a new server metric service,
query arbitrary paginated rows as a complete population, or acknowledge writes
through animation. Lazy/auto collections and oversized snapshots fail closed.
The [named aggregate service](../../_work/charts-system-plan.md#later-chart-data-services)
is separate roadmap work.

## Observed-Time Streams and Inspection

Realtime input is a strictly increasing list of identified epochs and signed
values. `null` creates a real gap. `windowMs=60000`; its endpoint follows the
latest **supplied observation**, not `Date.now()`. Every observation remains a
line vertex, so brief irregular spikes are not erased by uniform resampling.
An isolated observation is a dot, not an invented multi-point line.
Overlapping observed identities keep a continuous segment mounted when the
rolling window advances. Gap corrections can split or merge paths without
replaying the entrance over already visible measurements. Retired segments do
not retain animation identity for unrelated replacement data.

Pointer/keyboard inspection holds the view endpoint while new records arrive;
corrections to retained observations still render. Clearing inspection resumes
the latest observed window unless explicitly paused. `paused` / `defaultPaused` /
`onPausedChange` control the hold button; a rejected controlled resume cannot move
the held endpoint. Selection retirement releases a temporary inspection hold.
`endTime` explicitly fixes the caller's endpoint. Width is the nominal SSR width;
the browser measures its parent, while `height=220` remains physically stable.

`formatTime` controls full inspector text, `formatTimeTick` controls compact axis
labels, and `formatValue` / `unit` control readouts. These do not round away raw
values in the exact retained-sample table. Anomaly labels and semantic severity
are caller-supplied facts, not inferred alerts.

All native organisms accept a typed `renderTooltip`: return `undefined` for the
standard analytical body or `null` to suppress it. Inspectors reuse Zero Tooltip
for portals, collision/edge handling and overlay stacking. They are display-only;
actions/editors require an explicit popover rather than interactive tooltip text.

```tsx
import { useState, type CSSProperties } from 'react';
import { RealtimeChart } from '@zero/framework/components/charts/native';
import type { RealtimeSample } from '@zero/framework/charts/native';

const chartTheme = { '--zero-chart-inspector-radius': '10px', '--zero-chart-blue': '#3987e5' } as CSSProperties;
export function ObservedStream({ samples }: { samples: readonly RealtimeSample[] }) {
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  return <section style={chartTheme}><RealtimeChart label="Observed latency" data={samples} unit="ms"
    paused={paused} onPausedChange={setPaused} activeId={active} onActiveChange={setActive}
    renderTooltip={({ sample, formatTime }) => <>
      <div>{formatTime(sample.time)}</div><strong>{sample.value ?? 'Missing'} ms</strong>
      {sample.anomaly && <p>{sample.anomaly.label}</p>}
    </>} /></section>;
}
```

## Headless Math, Integrity and Budgets

Builders accept bounded own-data records/arrays, reject getters, coercion, sparse
arrays and duplicate IDs, and detach/freeze their outputs. Ordinary measurements
and derived totals are bounded to magnitude `1e12`; epochs have their separate
valid-date domain. Rescale/aggregate larger measurements upstream and name the
unit. These are presentation work budgets, not database storage limits.

| Family | Work budget |
| --- | --- |
| Cartesian | 4096 observations, 16 series, 65,536 cells, two axes, bounded reference/band lists. |
| Histogram / Box Plot | 16,384 supplied observations/population; 128 bins or 64 box series. |
| Matrix | 64 rows/columns and at most 4096 cells. |
| Waterfall / Candlestick | 1024 steps/observations. |
| Polar | Bounded axes/profiles/rings/slices; Sunburst at most 2048 nodes and depth 16. |
| Realtime | 4096 retained observations; window at most 365 days. No internal retention transport or generator. |

Use model builders when admission belongs in a query projector or error boundary.
Cartesian and polar model-to-layout helpers accept models produced by their
builders, not serialized/forged model-shaped objects. Public scalar geometry
helpers also validate their own inputs. Exact SSR companions survive missing
data, hidden series, normalized stacks, clipping and formatter rounding.
Color overrides use the bounded pure grammar described in the
[shared chart guide](sankey.md#safe-color-overrides); images and arbitrary CSS
property values are rejected before paint, including resource-valued fallbacks.

```ts
import { buildCartesianModel, computeCartesianLayout, buildHistogramModel,
  buildBoxPlotModel, buildPieModel, computePieLayout, buildRealtimeModel,
  computeRealtimeWindow, computeRealtimePaths } from '@zero/framework/charts/native';

const model = buildCartesianModel([
  { id: 'first', label: 'First', x: 1, values: { count: 10 } },
  { id: 'second', label: 'Second', x: 4, values: { count: 20 } },
], [{ id: 'count', label: 'Count', mark: 'line' }], { xAxis: { type: 'linear' } });
export const geometry = computeCartesianLayout(model, 640, 300);
export const bins = buildHistogramModel([{ id: 'a', value: 3 }, { id: 'b', value: 12 }], { edges: [0, 10, 20] });
export const boxes = buildBoxPlotModel([{ id: 'service', label: 'Service', values: [3, 8, 12, 15, 20] }]);
export const pie = computePieLayout(buildPieModel([{ id: 'a', label: 'A', value: 60 }, { id: 'b', label: 'B', value: 40 }]));
export const stream = computeRealtimePaths(computeRealtimeWindow(buildRealtimeModel([
  { id: 'first', time: 1000, value: 10 }, { id: 'second', time: 2000, value: null }, { id: 'third', time: 4000, value: 20 },
])));
```

## Tokens, Motion and Verification

Paint resolves local `--zero-native-*` overrides, then shared `--zero-chart-*`
roles, then the active Zero theme. Family titles are 14px, ordinary labels 12.5px,
metadata 11.5px, and analytical inspector totals 17px. The shared inspector has
10px rounding, 9×12px padding and 120ms feedback. SVG numerical readouts use
ordinary platform fonts with tabular numerals. Named categorical colors preserve
existing family meaning; the global legacy `--chart-1`…`-5` are not reordered.
Default readouts share `formatNativeChartNumber`: ordinary compact decimals, with
scientific notation for tiny nonzero measurements rather than a false zero.
Explicit caller formatting remains a presentation choice; raw companions stay exact.

New reveals and physical morphs use the already qualified Arc motion vocabulary,
not a second spring library/theme. `motion={false}`, reduced-motion preferences,
hidden documents and offscreen containers suspend decorative work. Unmounts
retire observers, animation controls and inspector portals. Animation never
changes exact measurements, confirms ingestion or proves query completeness.

Working-source qualification covers model extremes, exact SSR tables, actual
public entries and source-copy builds, reactive inserts/updates/deletes and
authority retirement, keyboard/touch/controlled inspection, custom/hidden
inspectors, interrupted motion, and synthetic light/dark/narrow layouts. This is
not a published-package or live-provider guarantee. The missing original Realtime
Stream HTML is not claimed as a pixel-identical reference.

See the [execution evidence](../../_work/charts-system-plan.md#handmade-chart-coverage-extension)
and [token inventory](../../_work/design-token-theme-evolution-plan.md#handmade-chart-coverage-extension)
for shared roles, local exceptions and the wider theme/server-service boundary.
