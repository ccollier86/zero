---
id: zero.frontend.components.charts
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

# Zero Charts and Sankey Flow

[Charts index](./index.md) · [Components](../components/index.md) · [Frontend](../index.md) · [Documentation](../../index.md)

`SankeyChart` displays aggregate flows as responsive ribbons with source colors,
proportional tracing, sparse particles and a value/share inspector. It is the
first Zero-owned chart, alongside [Race Bar](race-bar.md),
[Funnel](funnel.md) and the compatible
[Recharts composition](../components/primitives/charts.md). It does not fetch or persist data.
The separate [Arc family](arc.md) adds twelve trend, proportion,
calendar, distribution and hierarchy organisms. The [handmade extension](native.md)
adds quantitative/mixed Cartesian, statistical, polar and observed-time charts
and the typed `ZeroChart` dispatcher. Both reuse the existing authorized query
bridge rather than introducing renderer-owned subscriptions.

Use three public entries according to responsibility:

| Entry | Responsibility |
| --- | --- |
| `@zero/framework/components/charts` | React chart organisms and their presentation contracts. |
| `@zero/framework/charts` | Browser-independent types, validated flow/ranking/cohort models, math and layout. |
| `@zero/framework/charts/react` | Bounded reactive projection through existing Zero collection hooks. |

Import the existing `@zero/framework/styles.css` once; it includes the chart
skin. `zero add components/charts` copies the presentation pieces and their
shared component dependencies. An app that uses the copied skin should include
`components/charts/chart-tokens.css` before its
`components/charts/sankey/sankey.css` in the app stylesheet. Synthetic test
fixtures and backend services are not part of that copy.
The same target includes Race Bar and Funnel; import their individual skins
when using that organism. Its [guide](race-bar.md) documents playback,
controlled state, history admission and inspector customization.

Shared named categorical colors, compact type roles, inspector rounding,
spacing/elevation and focus/feedback are now chart-family defaults. Local paint
aliases remain supported and resolve at the consuming SVG/canvas/DOM paint site,
so a scoped family override stays consistent across charts and their portals.
The [convergence ledger](../../_work/design-token-theme-evolution-plan.md#shared-chart-language-convergence)
records the selected roles without claiming a platform-wide theme replacement.

## Aggregate Data

Supply immutable `SankeyData`: `nodes` contain a required string `id`, optional
`label` and optional zero-based `column`; `links` contain `source`, `target`,
finite nonnegative `value` and optional stable `id`. Updating the data prop
updates the chart; do not mutate the same arrays in place.

```tsx
import { SankeyChart } from '@zero/framework/components/charts';
import type { SankeyData } from '@zero/framework/charts';

const data: SankeyData = {
  nodes: [
    { id: 'organic', label: 'Organic' },
    { id: 'paid', label: 'Paid' },
    { id: 'activated', label: 'Activated' },
    { id: 'inactive', label: 'Not activated' },
  ],
  links: [
    { source: 'organic', target: 'activated', value: 3300 },
    { source: 'organic', target: 'inactive', value: 1700 },
    { source: 'paid', target: 'activated', value: 1800 },
    { source: 'paid', target: 'inactive', value: 2000 },
  ],
};

export function SignupFlow() {
  return <SankeyChart data={data} label="Signup activation flow"
    columns={['Source', 'Activation']} unit="people" totalLabel="signups" />;
}
```

This is static synthetic data. Real aggregate inputs must already be authorized
and have a defined measurement window, unit and population. Node value is the
greater of incoming and outgoing flow; unequal totals may represent exits or
new midstream contributions. The chart does not silently fabricate a balancing
edge. A trace assumes proportional mixing at each node, not exact per-person
journeys or proven causal attribution. Particles are decorative aggregate motion,
not individual records or live ingestion acknowledgments.

The model caps inputs at 256 nodes and 2048 links, with columns from 0 to 63.
Cycles, self-links, missing endpoints, invalid values, duplicate node IDs,
conflicting column pins and numeric overflow are errors. Zero-valued edges are
not painted but still participate in topology validation. Anonymous links with
the same endpoints combine; explicitly identified parallel links remain separate.
Use `sankeyPairId(source, target)` when targeting an anonymous link. Its generated
identity is collision-safe even when a node ID contains an arrow or delimiter.

## Interaction and Presentation

The chart owns mouse hover, touch inspection and keyboard traversal. Arrow keys
walk nodes across or along stages according to orientation; Home/End move to the
first/last stage and Escape clears inspection. A labeled hidden table provides
every exact flow and its share of the total. Keyboard traces announce the inspected
node. Values are not confined to hover or canvas pixels.

Use `trace` and `onTraceChange` for application-controlled selection, or
`defaultTrace` for uncontrolled initial inspection. A trace is a typed
`{ kind: 'node' | 'link', id }`, not an ambiguous concatenated string.

```tsx
import { useState } from 'react';
import { SankeyChart } from '@zero/framework/components/charts';
import type { SankeyData, SankeyTraceTarget } from '@zero/framework/charts';

export function ControlledFlow({ data }: { data: SankeyData }) {
  const [trace, setTrace] = useState<SankeyTraceTarget | null>(null);
  return <SankeyChart data={data} label="Controlled aggregate flow"
    trace={trace} onTraceChange={next => setTrace(next?.target ?? null)} traceColor="mix" />;
}
```

The ordinary `traceColor="source"` mode follows the hovered source color;
later-stage inspection uses ink. `"mix"` splits highlighted bands by their
proportional source composition. Shared source colors remain meaningful, while
non-color labels, totals and percentages explain the flow.

Mix paint has an additional budget of 4096 origin-element combinations:
`origins × (visible nodes + visible links)`. A larger mix layer is rejected
explicitly; aggregate it further or select source tracing. This avoids allocating
hundreds of thousands of SVG elements for an otherwise bounded graph.

The default layout is horizontal at wide widths and upright below 420px.
Requested height defaults to 340px, plus horizontal headings; upright layout
uses at least 480px. Actual parent width controls the layout, not the device name.
Use a parent that can shrink (`min-width: 0`) when placing charts in grids.

`unit`, `totalLabel` and `formatValue` configure the readouts. `particles`,
`defaultParticles`, `onParticlesChange`, `particleSpeed` and `particleToggle`
configure decorative flow. Theme tokens control chart paint, typography,
inspector geometry and motion; the organism does not install a global font or
redesign unrelated controls.

`onTraceChange` receives the derived `SankeyTrace` (or null), including its
typed `target`, amount/share and proportional node/link maps. The second argument
identifies pointer, touch or keyboard interaction. `particleSpeed` accepts finite
values from 0 to 10; `motion={false}` disables decorative movement. `accent`
overrides the first source series and focus emphasis without changing other charts.

### Custom Inspectors

`renderNodeTooltip` receives `{ node, model, trace, formatValue, unit, totalLabel }`;
`renderLinkTooltip` receives the corresponding `link` context. Return undefined
to use the default body or null to hide that inspector. These are pure React
renderers, so strings are escaped normally and the chart never injects caller HTML.

```tsx
import { SankeyChart, SankeyNodeTooltip } from '@zero/framework/components/charts';
import type { SankeyData } from '@zero/framework/charts';

export function ExplainedFlow({ data }: { data: SankeyData }) {
  return <SankeyChart data={data} label="Explained flow"
    renderNodeTooltip={context => <>
      <SankeyNodeTooltip {...context} />
      <p>Shares use proportional mixing through this stage.</p>
    </>} />;
}
```

The component reuses Zero Tooltip's portal, collision and overlay-owner behavior
with a scoped 120ms fade and the reference inspector surface. The default inspector
is non-interactive. Use an explicit popover for actions or editing rather than
putting focusable controls into tooltip content. `SankeyNodeTooltip`,
`SankeyLinkTooltip`, `SankeyInspection` and `SankeyFlowTable` are reusable presentation
pieces; `SANKEY_MOTION_DEFAULTS` exposes the six primary motion timings.

The reference motion uses a 1000ms entrance with 130ms column stagger, 700ms
data morphs, 140ms trace propagation delay, 440ms pours and 260ms fades. Updates
start from current visible geometry instead of restarting the entrance. Reduced
motion settles geometry and disables particles; hidden/offscreen charts do not
keep a decorative animation loop running.

## Reactive Aggregate Collections

`useChartQuery` reuses the existing authorized `useQuery` collection subscription.
It does not create a socket, submit arbitrary SQL or authorize browser predicates.
Use a bounded full-sync aggregate collection, not raw event history or one page
of a lazy table. The server remains responsible for row/field policy and scope.

```tsx
import { SankeyChart } from '@zero/framework/components/charts';
import { buildSankeyModel, type SankeyData } from '@zero/framework/charts';
import { useChartQuery } from '@zero/framework/charts/react';

type FlowAggregate = { id: string; source: string; target: string; value: number };
const nodes: SankeyData['nodes'] = [
  { id: 'organic', label: 'Organic' }, { id: 'paid', label: 'Paid' },
  { id: 'activated', label: 'Activated' }, { id: 'inactive', label: 'Not activated' },
];
function project(rows: readonly FlowAggregate[]): SankeyData {
  const data = { nodes, links: rows.map(row => ({
    id: row.id, source: row.source, target: row.target, value: row.value,
  })) };
  buildSankeyModel(data); // Admit the aggregate before revealing it.
  return data;
}

// Render within the existing AppProvider/ClientProvider. The app supplies its
// actual aggregate-baseline readiness; connectivity alone is not readiness.
export function LiveSignupFlow({ baselineReady }: { baselineReady: boolean }) {
  const query = useChartQuery<FlowAggregate, SankeyData>({
    table: 'signup_flow_aggregates', project, maxRows: 256,
  });
  if (!query.readable || !baselineReady) return <p>Waiting for aggregate baseline…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return null;
  return <section>
    {!query.connected && <p role="status">Offline — showing the readable cached aggregate.</p>}
    <SankeyChart data={query.data} label="Live signup activation"
      columns={['Source', 'Activation']} unit="people" totalLabel="signups" />
  </section>;
}
```

The hook returns `data`, typed `error`, local `rowCount`, `connected` and
`readable`. SSR and authorization retirement return masked null data/errors;
scope replacement reuses Zero's existing boundary. A readable empty cache does
not prove zero database results. Connection loss may leave a readable cached
snapshot; explicitly label it if freshness matters.

`maxRows` defaults to 1000 and cannot exceed 10000. The budget applies before
the optional local `predicate`, so filtering cannot disguise a large source scan.
Predicates/projectors must be synchronous and pure. Predicates must return actual
booleans; JavaScript truthiness is not accepted. Async predicates return
`CHART_QUERY_PREDICATE_ASYNC`, nonboolean results return
`CHART_QUERY_PREDICATE_INVALID`, and the projector is not called for either
failure. Invalid async callback results have their rejections consumed and are
never admitted as chart data. Invalid limits, excessive
input, partial lazy/auto sources and projection failures return typed errors;
the hook never truncates an aggregate silently. `projectChartQueryRows` exposes
the pure projection helper without claiming to load missing rows.

## Safe Color Overrides

Chart paint is a color, not an arbitrary CSS background. Native and Arc data
overrides admit bounded named colors (including `transparent` / `currentColor`),
hex colors, absolute RGB/HSL/HWB/Lab/LCH/OKLab/OKLCH and standard `color()` spaces,
`color-mix()`, `light-dark()`, and theme `var()` references with validated color
fallbacks. Color strings are at most 256 characters, with bounded nesting.
Theme variables remain application-owned trusted tokens; the admission boundary
does not resolve stylesheet variables or grant them data authority.

Images, gradients, resource URLs, quoted image sources, CSS-wide keywords,
declarations, relative colors and arithmetic expressions are not paint overrides.
Use a trusted theme token or an upstream-resolved supported absolute color for
relative/arithmetic theme computations. Legend and inspector swatches use
color-only CSS properties as defense in depth; a paint value cannot become an
image load through a background shorthand.

## Headless Flow Math

The browser-independent facade supports preflight, testing and server-side
presentation preparation without React or a DOM. It is not a persistence service.

```ts
import { buildSankeyModel, computeSankeyLayout, computeSankeyTrace,
  sankeyPairId, type SankeyData } from '@zero/framework/charts';

export function inspectFlow(data: SankeyData) {
  const model = buildSankeyModel(data);
  const layout = computeSankeyLayout(model, { width: 800, height: 340 });
  const first = model.links[0];
  const trace = first ? computeSankeyTrace(model, {
    kind: 'link', id: first.id,
  }) : null;
  return { model, layout, trace, examplePairId: sankeyPairId('organic', 'activated') };
}
```

Treat model/layout outputs as derived presentation state, not writable business
records. The model does not validate server authority, billing semantics, source
measurement windows or whether an app-selected aggregate is complete.

## Related Guides and Next Steps

- [Race Bar chart](race-bar.md) adds ordered history and ranking playback
  through the same component/headless/query entries.
- [Funnel chart](funnel.md) adds ordered conversion cohorts, split/isolated
  bands and exact stage retention through those same entries.
- [Existing charts](../components/primitives/charts.md) remain supported and are not removed.
- [Query hooks](../sdk/data-hooks.md) own collection subscription semantics.
- [Design tokens](../design-system/tokens.md) own the active semantic theme.
- [Tooltips](../components/overlays/tooltip.md) own positioning and portal behavior.
- [Fabric](../../backend/fabric/index.md),
  [Reactive DB](../../backend/reactive-db/index.md) and
  [database automations](../../backend/database-automations/index.md) remain the
  owners of scoped reads, persistence and aggregate maintenance. A named chart
  aggregate service is a later integration, not implied by the component.
