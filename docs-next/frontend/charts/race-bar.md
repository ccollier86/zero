---
id: zero.frontend.components.race-bar-chart
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: race-bar-chart
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

# Race Bar Chart

[Charts index](./index.md) · [Zero charts](sankey.md) · [Components](../components/index.md) · [Documentation](../../index.md)

`RaceBarChart` displays a ranking over an ordered aggregate history. Values
blend between periods, rows spring toward their current ranks, the period label
rolls into place and a timeline supports playback, stepping and scrubbing. It is
a Zero-owned organism alongside [Sankey](sankey.md); the existing
[Recharts composition](../components/primitives/charts.md) remains supported.

The chart consumes data; it does not query, persist or generate history. Its
playback clock is presentation, not evidence that business events occurred at
that speed. Server functions/triggers remain responsible for durable rollups,
corrections and monthly or cumulative measurement semantics.

## Start with an Ordered History

Use immutable `RaceBarData` with declared `items`, ordered `frames` and optional
legend `groups`. Each frame supplies a `period` label and a value record keyed by
item ID. A missing own item key explicitly means zero. Update the data prop with
new arrays/records instead of mutating existing inputs.

```tsx
import { RaceBarChart } from '@zero/framework/components/charts';
import type { RaceBarData } from '@zero/framework/charts';

const data: RaceBarData = {
  groups: [{ id: 'furniture', label: 'Furniture' }, { id: 'textiles', label: 'Textiles' }],
  items: [{ id: 'oak', label: 'Oak dining table', group: 'furniture' },
    { id: 'throw', label: 'Linen throw', group: 'textiles' }],
  frames: [
    { id: '2026-01', period: 'January', values: { oak: 30000, throw: 52000 } },
    { id: '2026-02', period: 'February', values: { oak: 31000, throw: 46000 } },
    { id: '2026-03', period: 'March', values: { oak: 33000, throw: 32000 } },
  ],
};
const money = (value: number) => `$${Math.round(value / 1000)}K`;

export function ProductRevenue() {
  return <RaceBarChart data={data} label="Monthly product revenue, January to March 2026"
    title="Revenue by product" subtitle="Each month, 2026" formatValue={money}
    bars={8} frameDuration={1400} autoPlay loop={false} highlight="oak" />;
}
```

This example is synthetic. A production history must already define its unit,
population, ordering and measurement window. The component does not convert
monthly values into year-to-date values automatically.

Import `@zero/framework/styles.css` once for the chart skin. The public component
entry is `@zero/framework/components/charts`; browser-independent contracts and
math live at `@zero/framework/charts`. `zero add components/charts` copies the
chart organisms and shared presentation dependencies. When using copied source,
include `components/charts/chart-tokens.css` before
`components/charts/race-bar/race-bar.css` in the app stylesheet. Browser
fixtures, test data and backend services are excluded from source copying.

### Identity, Admission and Updates

Item/group IDs must be unique nonempty strings. A frame uses `id ?? period` as
its identity; repeated display labels therefore require distinct explicit IDs.
Frames remain in the caller's declared order, not alphabetic label order. Equal
values retain item declaration order, avoiding accidental rank flicker.

The model admits at most 256 items, 1024 frames, 32 groups and 65,536
item-by-frame cells. IDs are limited to 256 characters and labels to 4096.
Values must be own finite nonnegative numbers in a plain or null-prototype
record. Unknown item keys, duplicate identities, undeclared group references,
accessors, coercible strings and overflowing all-item totals are errors. Invalid
input is rejected rather than truncated or silently repaired.

Models copy input values into owned numeric vectors. Treat model/snapshot
outputs as derived read-only presentation state, not writable business records.

Uncontrolled playback preserves the current period's identity when histories
are prepended or trimmed, where that period remains available. Adjacent bounding
periods preserve fractional progress; otherwise the rounded period is retained
or the old index is clamped. Removed items cannot leave a stale inspector open.
Controlled `frame` is an app-owned numeric index: update that index yourself if
your controlled history inserts periods before it.

## Settings and Defaults

| Setting | Default | Contract |
| --- | --- | --- |
| `data`, `label` | Required | Bounded aggregate history and accessible chart name. |
| `title`, `subtitle` | Empty | Optional visible chart header; no demo-page chrome is included. |
| `bars` | `8` | Integer from 1 to 64; displays at most the item count. Total/share still include all items. |
| `frameDuration` | `1400` | Milliseconds per period, finite from 100 to 600,000. Controls playback pacing, not measured event timing. |
| `autoPlay`, `loop` | `true`, `false` | Autoplay starts when first visible; looping sweeps the presentation clock back to the start. |
| `defaultFrame` | `0` | Initial uncontrolled frame; finite and clamped to the history. |
| `frame`, `playing` | Uncontrolled | Controlled requested fractional position and playback intent. |
| `selectedId`, `defaultSelectedId` | Uncontrolled, `null` | Controlled selection or initial item inspection. |
| `highlight` | `null` | Always emphasizes the named item's label without forcing inspection. |
| `totalLabel`, `showTotal` | `"Total"`, `true` | All-item aggregate readout, not a total of the visible top N. |
| `showLegend`, `showControls`, `showTimeline` | `true` | Optional chrome. Timeline is shown within controls; hiding chrome does not alter the supplied data. |
| `formatValue`, `formatTick` | Rounded `en-US` number; same formatter | Pure synchronous number formatters for readouts and axis ticks. |
| `motion` | `true` | Disable transition motion explicitly; reduced motion also settles geometry and prevents autoplay. |
| `emptyLabel` | `"No rankings yet"` | Visible empty-state text for missing items or periods. |
| `renderItemTooltip` | Default inspector | Pure React renderer; undefined falls back, null hides the inspector. |
| `className`, `style`, figure attributes | Inherited | Scoped layout/theme customization; no global theme is installed. |

At widths below 400px, names move inside bars with clipped long labels and full
values available through inspection and the exact history table. Wide rows use
26px spacing/18px bars; narrow rows use 30px spacing/22px bars. The actual parent
width determines layout. Grid parents should allow shrinking with `min-width: 0`.

The reference value blend mixes linear progress with 55% smoothstep. Clock,
scrub, rank, opacity and tick springs retain independent frequencies of
9/22/11/13/14. Analytical critical damping preserves velocity during interruptions
without unstable delayed-frame integration. Period labels enter in 420ms and
retire in 300ms. `RACE_BAR_DEFAULTS` and `RACE_BAR_MOTION_DEFAULTS` expose the
reference values; CSS period timing tokens can override label animation.

Offscreen or hidden-document playback suspends without advancing through
invisible elapsed time. Requested playback intent survives suspension, while an
explicit pause stays paused. Empty or single-period histories disable playback
and scrubbing. Reduced motion disables automatic playback and settles transitions
immediately; deliberate stepping remains usable. Explicit Play is still allowed
in reduced motion and advances discrete periods without animated transitions.

## Controlled State and Callbacks

`onFrameChange(position, { reason })` requests a new target, including fractional
playback/scrub positions. Reasons are `seek`, `step`, `scrub`, `playback` and
`replay`. Accept this callback into `frame` when controlling the position.
`onFrame(index, snapshot)` observes a rounded **displayed** period; do not feed
it back into the target, which would round away smooth progress.

`onPlayingChange(boolean)` requests playback intent. Visibility suspension is
not a user pause and does not change that intent. `onSelectionChange(id,
{ via })` requests selection, with `pointer`, `touch` or `keyboard` origin.

```tsx
import { useState } from 'react';
import { RaceBarChart } from '@zero/framework/components/charts';
import type { RaceBarData } from '@zero/framework/charts';

export function ControlledRanking({ data }: { data: RaceBarData }) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <RaceBarChart data={data} label="Controlled product ranking"
    frame={frame} onFrameChange={setFrame} playing={playing} onPlayingChange={setPlaying}
    selectedId={selectedId} onSelectionChange={setSelectedId} autoPlay={false} />;
}
```

## Commands and Inspector Composition

`RaceBarChartHandle` exposes `play`, `pause`, `toggle`, `replay`, `seek`, `next`
and `prev`. Commands request the same controlled state changes as built-in
controls. `seek` requires a finite frame and snaps to the nearest period. The
handle's `frame` getter reports the rounded painted period; `playing` reports
requested intent, not whether the chart is currently visible.

```tsx
import { useRef } from 'react';
import { RaceBarChart, RaceBarItemTooltip, type RaceBarChartHandle } from '@zero/framework/components/charts';
import type { RaceBarData } from '@zero/framework/charts';

export function ExplainedRanking({ data }: { data: RaceBarData }) {
  const chart = useRef<RaceBarChartHandle>(null);
  return <section>
    <button type="button" onClick={() => chart.current?.replay()}>Replay history</button>
    <RaceBarChart ref={chart} data={data} label="Explained product ranking" autoPlay={false}
      renderItemTooltip={context => <>
        <RaceBarItemTooltip {...context} />
        {context.interpolated && <p>Value is blending between recorded periods.</p>}
      </>} />
  </section>;
}
```

The inspector context includes `item`, `model`, displayed `value`, zero-based
`rank`, `itemCount`, all-item `total`/`share`, `position`, `fraction`,
`interpolated`, bounding frames and the rounded `frame`. Its `frameValue`,
`previousValue`, `change` and `changeRatio` compare exact recorded periods.
The ratio is null when there is no preceding period or its value is zero; no
infinite percentage is invented. While animating, the default inspector names
the rounded period used for its previous-period comparison.
Extremely large finite relative changes use scientific percentage notation
instead of overflowing the displayed percentage to Infinity.

Zero Tooltip owns portal layering, theme inheritance, collision handling and
Escape dismissal. Race Bar supplies a non-interactive inspector body with the
reference's quiet surface and 120ms fade. Strings are React-escaped, not injected
HTML. Interactive inspector actions require an explicit popover composition.
`RaceBarItemTooltip`, `RaceBarInspector`, `RaceBarLegend`,
`RaceBarHistoryTable`, `RaceBarPlaybackButton` and `RaceBarTimeline` are exported
pieces for composition.

Mouse hover inspects a bar; touch taps toggle inspection. On the plot, Up/Down
inspect current ranks, Left/Right step periods, Home/End jump, Space/Enter toggle
playback and Escape clears. The timeline is an accessible range with captured
pointer scrubbing and nearest-period snap on release. A labeled complete
item-by-period table is server rendered for assistive technology; exact values
are not trapped in hover-only content. Live announcements support inspection
without narrating every intermediate animation value.
Visual rows and the animated readouts are painted after browser mounting; the
exact history companion does not require browser animation to expose its values.

## Reactive Rollup History

Use `useChartQuery` to project a bounded, authorized full-sync aggregate
collection. The hook uses Zero's existing collection transport and scope
retirement; it does not execute server analytics or authorize client filters.

```tsx
import { RaceBarChart } from '@zero/framework/components/charts';
import { buildRaceBarModel, type RaceBarData } from '@zero/framework/charts';
import { useChartQuery } from '@zero/framework/charts/react';

type RevenuePeriod = { id: string; period: string; ordinal: number; oak: number; throw: number };
const items: RaceBarData['items'] = [{ id: 'oak', label: 'Oak dining table' },
  { id: 'throw', label: 'Linen throw' }];
function project(rows: readonly RevenuePeriod[]): RaceBarData {
  if (rows.some(row => !Number.isFinite(row.ordinal))) throw new Error('Invalid period order.');
  const ordered = [...rows].sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const data: RaceBarData = { items, frames: ordered.map(row => ({
    id: row.id, period: row.period, values: { oak: row.oak, throw: row.throw },
  })) };
  buildRaceBarModel(data);
  return data;
}

// The existing provider supplies authorized collections. The application must
// establish the aggregate baseline; connectivity alone does not prove readiness.
export function LiveRevenueHistory({ baselineReady }: { baselineReady: boolean }) {
  const query = useChartQuery<RevenuePeriod, RaceBarData>({
    table: 'product_revenue_periods', project, maxRows: 256,
  });
  if (!query.readable || !baselineReady) return <p>Waiting for revenue baseline…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return null;
  return <section>
    {!query.connected && <p role="status">Offline — showing readable cached history.</p>}
    <RaceBarChart data={query.data} label="Recorded monthly product revenue" autoPlay={false} />
  </section>;
}
```

The server owns tenant/row/field policy, rollup generation, revisions and source
windows. Projection is synchronous and pure. A readable empty cache does not
prove an empty database; a connection does not prove a complete baseline. Lazy
table pages are not a whole-history chart. Label cached data explicitly when
freshness matters. See [Zero charts](sankey.md#reactive-aggregate-collections)
for hook limits, errors and scope masking, and the
[chart plan](../../_work/charts-system-plan.md#later-chart-data-services) for the
later named server-aggregate facade.

## Headless Ranking Math

The pure entry validates and prepares rankings without React, browser globals
or a data connection. `computeRaceBarSnapshot` accepts a fractional position;
inspection retains the distinction between interpolation and exact comparison.

```ts
import { buildRaceBarModel, computeRaceBarSnapshot, inspectRaceBarItem,
  computeRaceBarLayout, type RaceBarData } from '@zero/framework/charts';

export function inspectHistory(data: RaceBarData) {
  const model = buildRaceBarModel(data);
  const snapshot = computeRaceBarSnapshot(model, .5);
  const first = snapshot.rows[0];
  return { snapshot, layout: computeRaceBarLayout(model, { width: 375, bars: 8 }),
    inspection: first ? inspectRaceBarItem(model, snapshot, first.item.id) : null };
}
```

The facade also exports `raceBarValueAt`, `preserveRaceBarFramePosition`,
`raceBarBlend`, `advanceRaceBarSpring`, `raceBarNiceStep`, `raceBarTicks`,
`normalizeRaceBarPosition` and `RACE_BAR_LIMITS`. These are presentation helpers,
not authorization, billing, statistical or persistence APIs.

## Theme and Related Work

Use scoped `--zero-race-bar-*` series/tint/inspector/timing roles and optional
`--zero-chart-*` surface/content/font overrides. Defaults inherit Zero semantic
surfaces and typography; no external font is installed. Race Bar's four-series
palette does not reorder Sankey's six colors or the legacy five chart colors.
The [token ledger](../../_work/design-token-theme-evolution-plan.md#race-bar-chart-token-direction)
records the supplied design as a foundation for later shared-theme work.
Small differences between chart references are tracked in the
[shared-language convergence checklist](../../_work/design-token-theme-evolution-plan.md#shared-chart-language-convergence).
They will be reconciled into shared chart tokens, with intentional geometry and
motion retained; this implementation does not claim that normalization is finished.

- [Sankey and shared chart entries](sankey.md) describe the compatible library.
- [Tooltip](../components/overlays/tooltip.md) owns shared overlay behavior.
- [Query hooks](../sdk/data-hooks.md) own authorized collection subscriptions.
- [Reactive DB](../../backend/reactive-db/index.md), [Fabric](../../backend/fabric/index.md)
  and [database automations](../../backend/database-automations/index.md) own
  durable authorized rollups and corrections.
