---
id: zero.frontend.components.funnel-chart
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: funnel-chart
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

# Funnel Chart

[Charts index](./index.md) · [Zero charts](sankey.md) · [Components](../components/index.md) · [Documentation](../../index.md)

`FunnelChart` presents ordered conversion stages as one smoothly tapered band,
split cohort bands, or an isolated segment. Counts settle on springs, a quiet
column follows the inspected stage and optional particles illustrate retention
and departure. Narrow containers turn the chart vertically. It belongs to the
same Zero chart family as [Sankey](sankey.md) and [Race Bar](race-bar.md);
the existing [Recharts composition](../components/primitives/charts.md) remains supported.

The data must describe one consistent conversion cohort. Counts cannot increase
between stages, including within an individual segment. Flow dots are an
aggregate illustration, not observed people, writes or business-event traces.

## Start with a Conversion Cohort

Declare ordered stages and optional stable segment IDs. With segments, each
stage has a `values` record keyed by segment ID; without segments, each stage has
a `value`. Missing own counts explicitly mean zero. Supply new immutable arrays
and records when updating data instead of mutating existing inputs.

```tsx
import { FunnelChart } from '@zero/framework/components/charts';
import type { FunnelData } from '@zero/framework/charts';

const data: FunnelData = {
  segments: [{ id: 'organic', label: 'Organic' }, { id: 'paid', label: 'Paid' }],
  stages: [
    { id: 'visit', label: 'Visited', values: { organic: 10000, paid: 8000 } },
    { id: 'signup', label: 'Signed up', values: { organic: 4200, paid: 2400 } },
    { id: 'activate', label: 'Activated', values: { organic: 2300, paid: 900 } },
    { id: 'pay', label: 'Paid', values: { organic: 1200, paid: 400 } },
  ],
};

export function SignupConversion() {
  return <FunnelChart data={data} label="Signup conversion by acquisition source"
    title="Signup funnel" period="September 2026" unit="people"
    defaultView={{ kind: 'total' }} defaultFlow height={170} />;
}
```

This example is synthetic. The application owns the population, stage
definitions, reporting window and completeness of the supplied aggregate.
Independent daily stage totals or unrelated traffic windows are not a coherent
conversion funnel.

Import `@zero/framework/styles.css` once for the shared family and component
skins. Components live at `@zero/framework/components/charts`, pure contracts
and math at `@zero/framework/charts`, and the reactive projection bridge at
`@zero/framework/charts/react`. `zero add components/charts` copies the chart
family and shared presentation dependencies, excluding tests and backend
services. Copied-source applications must include `components/charts/chart-tokens.css`
before the individual chart styles, including `components/charts/funnel/funnel.css`.

### Identity and Admission

The model supports at most 32 stages, 16 segments and 512 stage-by-segment cells.
IDs must be unique nonempty strings of at most 256 characters; labels are limited
to 4096. Segment IDs such as `total` and `split` are valid because view choices
are tagged objects rather than reserved string IDs. Order follows the declared
arrays, not a label sort.

Counts must be own finite nonnegative numbers. Plain and null-prototype records
are accepted; coercible strings, accessors, inherited counts, unknown segment
keys, duplicate identities and overflowing stage totals are rejected. A stage
cannot mix unsegmented `value` with segmented `values`. An increase in any
segment is rejected even when the aggregate total decreases.

The model copies and freezes ordinary numeric arrays. Outputs are derived
read-only presentation state, not writable business records. Stable IDs preserve
in-flight stage and segment coordinates during replacement. A removed selected
segment falls back to the total view; a removed active stage clears inspection.

## Settings and Defaults

| Setting | Default | Contract |
| --- | --- | --- |
| `data`, `label` | Required | Bounded cohort counts and accessible chart name. |
| `title`, `period`, `unit` | Empty | Header title falls back to `label`; period accompanies conversion; unit appears in inspection/table. |
| `height` | `170` | Horizontal band height, finite greater than zero and at most 4096. Vertical layout derives stage spacing instead. |
| `orientation` | `"auto"` | `auto`, `horizontal` or `vertical`; auto turns vertically below 420px. |
| `view`, `defaultView` | Uncontrolled, `{ kind: 'total' }` | Total, split, or `{ kind: 'segment', id }`; split requires declared segments. |
| `flow`, `defaultFlow` | Uncontrolled, `true` | Particle intent; hidden/offscreen/reduced-motion rendering may suspend the actual illustration. |
| `activeStageId`, `defaultActiveStageId` | Uncontrolled, `null` | Controlled stage inspection or initial selection. Unknown/removed stages do not retain stale inspectors. |
| `controls` | `true` | Show the chart's segment/view and flow controls. |
| `showViewControl`, `showFlowControl`, `showDropOff` | `true` | Independent optional chrome; hiding it does not change data. |
| `motion` | `true` | Transition motion; reduced motion also settles coordinates and removes particles. |
| `formatValue`, `formatCompact` | Rounded `en-US` number, compact K/M | Pure synchronous exact-inspector/table and animated-heading formatters. |
| `emptyLabel` | `"No data"` | Empty state when there are no stages or the selected entry cohort is zero. |
| `renderStageTooltip` | Default inspector | Pure React extension; undefined falls back, null hides it. |
| `className`, `style`, figure attributes | Inherited | Scoped presentation customization without installing a global theme. |

The total view centers the combined cohort and paints one blue band. Split view
separates segment bands with a small gap and their categorical colors. Isolating
a segment scales it against its own first-stage count, not the total cohort.
Column headings and inspectors follow the selected view. Rates with a zero
denominator are `null` in the API and shown as an em dash, never as fabricated
zero or infinite conversion.

The reference uses cubic transitions across 30% of each stage cell, spring
frequencies 11 for thickness/gap, 6 for initial growth, 10 for counts and 14 for
column/inspector position. Analytical normalized critical damping preserves
velocity during interruptions and keeps very large finite counts representable.
`FUNNEL_LAYOUT_DEFAULTS` and `FUNNEL_MOTION_DEFAULTS` expose these defaults.
Geometry follows actual container width, including widths below the prototype's
demo minimum; grid parents should allow shrinking with `min-width: 0`.

The renderer owns one animation clock, pauses offscreen and in hidden documents,
and stops when nothing needs to move. A zero-entry or empty funnel paints no
particles. Reduced motion preserves counts and interaction without animated
flow. Observers, captured gestures, timers and the clock are retired on unmount.

## Controlled State and Commands

Control view, flow intent and stage inspection independently. `onViewChange`
and `onFlowChange` request new app-owned values. `onActiveStageChange(id, { via })`
identifies `pointer`, `touch`, `keyboard` or `api` interactions.

```tsx
import { useRef, useState } from 'react';
import { FunnelChart, type FunnelChartHandle } from '@zero/framework/components/charts';
import type { FunnelData, FunnelView } from '@zero/framework/charts';

export function ControlledFunnel({ data }: { data: FunnelData }) {
  const chart = useRef<FunnelChartHandle>(null);
  const [view, setView] = useState<FunnelView>({ kind: 'split' });
  const [flow, setFlow] = useState(true);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  return <section>
    <button type="button" onClick={() => chart.current?.clear()}>Clear inspection</button>
    <FunnelChart ref={chart} data={data} label="Controlled conversion cohort"
      view={view} onViewChange={setView} flow={flow} onFlowChange={setFlow}
      activeStageId={activeStageId} onActiveStageChange={setActiveStageId} />
  </section>;
}
```

The ref offers `setView`, `setFlow`, `inspect(stageId)` and `clear`, plus current
`view`, `flow` and `activeStageId` getters. Commands request the same state changes
as built-in controls. In controlled mode, accept their callbacks into props.
Replace the `data` prop for updates; there is no separate transport, mutable
imperative data store or competing `.update()` API.

## Inspector and Accessible Data

The default stage inspector displays exact counts, not intermediate animated
heading values. Split view lists segment counts and their total; isolated view
shows the selected segment. Previous-step retention names its denominator.

```tsx
import { FunnelChart, FunnelStageTooltip } from '@zero/framework/components/charts';
import type { FunnelData } from '@zero/framework/charts';

export function ExplainedFunnel({ data }: { data: FunnelData }) {
  return <FunnelChart data={data} label="Explained signup funnel"
    renderStageTooltip={context => <>
      <FunnelStageTooltip {...context} />
      <p>These are aggregate cohort counts, not individual event traces.</p>
    </>} />;
}
```

The context includes `stage`, `previousStage`, selected `view`, `value`,
all-segment `total`, `rows`, `fromStart`, `keptFromPrevious`, `dropOff`,
`conversionRate`, the model, formatter and unit. Each row retains its segment
identity and nullable retention rates. `FunnelInspector`, `FunnelControls`,
`FunnelStageTooltip` and `FunnelDataTable` are exported composable pieces.

Zero Tooltip owns the portal, inherited theme, collision handling and Escape
dismissal. Chart inspectors share a quiet opaque card, 10px rounding, 9px × 12px
spacing and 120ms feedback. The anchor spans the inspected stage, so an inspector
flips to the other stage boundary and remains within the plot when it fits,
while still respecting viewport edges. Strings are React-escaped. Interactive actions need
an explicit popover composition rather than focusable elements inside a tooltip.

Mouse hover inspects stages. Touch press/drag selects along the chart while
retaining page pan behavior. Keyboard focus begins inspection; arrows move one
stage, Home/End jump and Escape clears. Discrete live announcements explain the
selected stage without narrating animation frames. A complete exact table is
available in SSR and to assistive technology, independently of visible animated
paint. It includes every segment, stage total and total-cohort retention rate.

## Reactive Cohort Aggregates

Use the existing `useChartQuery` bridge for a bounded authorized full-sync
aggregate collection. The server owns cohort generation, corrections, tenant
policy and consistent revisions; client projection does not authorize data or
derive a reliable multi-stage cohort from unrelated events.

```tsx
import { FunnelChart } from '@zero/framework/components/charts';
import { buildFunnelModel, type FunnelData } from '@zero/framework/charts';
import { useChartQuery } from '@zero/framework/charts/react';

type CohortStage = { id: string; label: string; ordinal: number; organic: number; paid: number };
const segments = [{ id: 'organic', label: 'Organic' }, { id: 'paid', label: 'Paid' }];
function project(rows: readonly CohortStage[]): FunnelData {
  if (rows.some(row => !Number.isFinite(row.ordinal))) throw new Error('Invalid stage order.');
  const data: FunnelData = { segments, stages: [...rows]
    .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
    .map(row => ({ id: row.id, label: row.label, values: { organic: row.organic, paid: row.paid } })) };
  buildFunnelModel(data);
  return data;
}

// baselineReady also certifies a consistent cohort revision, not just connectivity.
export function LiveSignupFunnel({ baselineReady }: { baselineReady: boolean }) {
  const query = useChartQuery<CohortStage, FunnelData>({ table: 'signup_cohort_stages', project, maxRows: 32 });
  if (!query.readable || !baselineReady) return <p>Waiting for a consistent cohort baseline…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return null;
  return <section>
    {!query.connected && <p role="status">Offline — showing readable cached cohort counts.</p>}
    <FunnelChart data={query.data} label="Recorded signup cohort" defaultView={{ kind: 'split' }} />
  </section>;
}
```

The projection is pure and synchronous. A readable empty cache does not prove
an empty database; connectivity does not prove a complete or consistent
baseline. Reject or withhold intermediate inconsistent revisions rather than
silently relaxing the model. Lazy page queries are not whole-cohort aggregates.
The bridge masks data on authority retirement and reports admission/projection
errors instead of retaining a stale chart. Named server aggregate services are
[planned](../../_work/charts-system-plan.md#later-chart-data-services), not a new
implemented backend API in this component release.

## Headless Cohort Math

Pure validation, inspection, geometry and illustrative particle sampling require
no React, browser globals, timers or transport.

```ts
import { buildFunnelModel, computeFunnelSnapshot, inspectFunnelStage,
  computeFunnelLayout, computeFunnelTargets, computeFunnelEdges, funnelBandPath,
  type FunnelData, type FunnelView } from '@zero/framework/charts';

export function inspectCohort(data: FunnelData, view: FunnelView = { kind: 'total' }) {
  const model = buildFunnelModel(data);
  const layout = computeFunnelLayout(model.stageCount, { width: 375 });
  const targets = computeFunnelTargets(model, layout, view);
  const edges = computeFunnelEdges(targets, layout.cross, view.kind === 'split' ? 2 : 0);
  return { snapshot: computeFunnelSnapshot(model, view), layout,
    paths: edges.map(edge => funnelBandPath(edge, layout)),
    inspection: model.stages[0] ? inspectFunnelStage(model, view, model.stages[0].id) : null };
}
```

`computeFunnelParticleDistribution` derives entry weights and departure shares;
`sampleFunnelParticle` samples these using a caller-supplied RNG. Finite dots
approximate those proportions. `createFunnelRandom` is reproducible illustration
math, never a security primitive or sampler of actual business events.

## Shared Design Language

The family owns surface/content/font roles, analytical-inspector elevation,
label/value/metadata roles, focus and feedback. Funnel and Race Bar use named
blue/orange/green/amber colors; Sankey retains its six-source order mapped into
the same named palette. `--zero-funnel-series-1` through `-4` remain local paint
overrides; shared `--zero-chart-*` overrides inherit into SVG, canvas and the
portalled inspector. Funnel keeps only intentional band tint and geometry
specifics. See the [token convergence ledger](../../_work/design-token-theme-evolution-plan.md#shared-chart-language-convergence).

## Qualification

The implementation is split into pure model/layout/geometry/particle/math
modules, an owned browser paint runtime, React controls/inspection and the chart
organism. Qualification uses synthetic data, public-entry browser builds,
source-copy builds, exact SSR tables, reactive-scope tests and isolated browser
fixtures. It does not read application configuration or connect to production
databases/providers. The guide's complete code examples are typechecked from
these actual fences.
