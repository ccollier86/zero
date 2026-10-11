---
id: zero.frontend.charts.index
type: index
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: zero-charts
maturity: supported
applies_to: ["2.6.0 working source; publication qualification pending"]
modes: [browser, SSR, light, dark, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Zero Charts API and Chart Families

[UI reference](../ui-reference.md) · [Components](../components/index.md) · [Frontend index](../index.md)

Zero Charts is the shared entry point for handmade analytical charts: typed React
organisms, browser-independent data models and geometry, a bounded reactive query
bridge, and a common visual language. Start with an assembled chart and its family
manual; compose exported parts when the default assembly does not fit the task.

The handmade renderers do not embed Recharts, D3 or another chart engine. The
existing [Recharts composition API](../components/primitives/charts.md) remains
supported alongside them. This overview does not authorize removing that API,
its consumers or the retained theme.

## Choose a Family, Then Read Its Manual

| Family and full manual | Use it for |
| --- | --- |
| [Sankey flow](sankey.md) | Weighted flows through stages, source mixing and end-to-end share tracing. Aggregate flows imply proportional mixing, not exact per-person journeys. |
| [Race Bar](race-bar.md) | Rankings across supplied historical periods, animated overtakes, play/pause and timeline scrubbing. Playback is a presentation clock, not a stream of new business events. |
| [Funnel](funnel.md) | Ordered, nonincreasing counts from a consistent cohort; total, split and isolated-segment views. Conversion meaning belongs to the supplied cohort definition. |
| [Arc family](arc.md) | Twelve focused organisms: Line, Bar, Donut, Streamgraph, Brush, Waffle, Slope, Sparkline, Gauge, Activity Heatmap, Ridgeline and Treemap. |
| [Native analytical family](native.md) | Quantitative/mixed Cartesian charts; histogram, matrix heatmap, box plot, waterfall and candlestick; radar, radial bars, pie and sunburst; actual observed-time streams. |

Use the native XY line for category, quantitative or timestamp X coordinates;
choose Arc Line for its focused series presentation. Likewise, an activity
calendar is not an arbitrary matrix heatmap, a donut is not a funnel, and a
historical race is not a realtime stream. Each manual owns the actual data
contract, settings, defaults, interaction options and complete examples.

## Public API Layers

| Public entry | Responsibility |
| --- | --- |
| `@zero/framework/components/charts` | `ZeroChart`, Sankey/Race Bar/Funnel organisms and their exported parts, plus the native analytical exports. |
| `@zero/framework/components/charts/arc` | The twelve named Arc organisms and their React prop/context types. Arc `LineChart` and `BarChart` do not become competing names in the broader component entry. |
| `@zero/framework/components/charts/native` | The generic Cartesian composer, eight Cartesian presets, ten other native organisms and shared frame/inspector/data-table/legend parts. |
| `@zero/framework/charts` | Browser-independent Sankey/Race Bar/Funnel models, admission, layout and math, plus native model exports. No React provider, transport or database authority. |
| `@zero/framework/charts/arc` and `/charts/native` | Focused pure model, geometry and statistics entries. Arc models use their separate entry; they are not all re-exported by `/charts`. |
| `@zero/framework/charts/react` | `useChartQuery`, its projection helper, typed errors and budgets; reuse of the existing authorized client collection lifecycle. |

`ZeroChart` selects a renderer through its typed `kind`, retaining that renderer's
own input and settings contract. It is not a universal `data` object, automatic
chart recommendation, fetcher or subscription manager. The dispatcher supports
all five families: `sankey`, `race-bar`, `funnel`, native kinds such as `line` and
`composed`, and Arc kinds such as `arc-line`, `arc-bar`, `donut` and `treemap`.
In particular, `line` is the native `XYLineChart`; `arc-line` is Arc `LineChart`.
The [native manual](native.md#choose-the-geometry) maps its
kinds to components; the other family manuals own their focused prop contracts.

These responsibilities are implemented by the
[React facade](../../../src/components/charts/zero-chart.tsx),
[pure facade](../../../src/charts/index.ts) and
[reactive bridge](../../../src/frontend/client/chart-query.ts). They are separate
layers so rendering cannot select credentials, raw SQL or database topology.

## Defaults First; Compose Deliberately

The assembled organisms provide the standard layout, inspection, keyboard/touch
behavior, bounded model admission and exact accessible companions described in
their manuals. Supply stable IDs, an informative accessible label, real measured
values and immutable input snapshots. Use the family-owned formatters, controlled
state and callback options instead of rewriting the runtime to change a label or
selection rule.

Composition stays within those contracts:

- Sankey exports `SankeyInspection`, node/link tooltip bodies and
  `SankeyFlowTable` for deliberate inspection and exact-value presentation.
- Race Bar exports playback/timeline controls, its legend, item inspector and
  `RaceBarHistoryTable`; Funnel exports its controls, stage inspector and
  `FunnelDataTable`.
- Native exports `NativeChartFrame`, `NativeChartInspector`,
  `NativeChartDataTable` and `NativeChartLegend`. Geometry and interaction logic
  still belong to the chosen chart; these parts do not create a chart controller.
- Pure model and layout functions support testing or custom rendering without
  mounting React. Their admission and semantic limits still apply.

Use a documented render callback for a custom inspector body. Several families
distinguish `undefined` (use the default body) from `null` (suppress inspection);
follow that family's signature rather than assuming every chart has one generic
`renderTooltip` prop. Analytical inspectors are noninteractive descriptions.
Put focusable actions in an explicit [Popover](../components/overlays/popover.md)
or managed [modal](../modals/index.md), not inside tooltip content.

Controlled callbacks request state changes; the application accepts them by
updating its props. They are not accepted database writes. Likewise, clearing an
unavailable selected ID or changing a visible series does not mutate supplied
measurements. Keep exact values in the chart's accessible companion even when
plot labels are sampled, shortened or still animating.

## Shared Runtime, Theme and Motion

Import `@zero/framework/styles.css` once for installed components. The shared
[chart-token skin](../../../src/components/charts/chart-tokens.css) normalizes
compact title/label/metadata hierarchy, tabular readouts, inspection spacing,
border/elevation, focus and short feedback. Named categorical colors inherit
light/dark and scoped theme roles at the consuming paint site. Source/series
identity must stay stable across sorting, filtering and live updates.

Families keep their different palette mappings and motion recipes. A Sankey
trace, Race Bar spring, period label roll and realtime sample reveal are not the
same task. Chart-specific geometry, clocks and decorative particles remain with
the organism. Shared analytical inspection reuses Zero Tooltip's portal,
collision and overlay-owner behavior with scoped 120ms feedback; it does not
change the ordinary Tooltip's Grow/400ms default or install another popup stack.

Browser runtimes own resize, visibility, reduced-motion and cleanup behavior.
They suspend decorative work when hidden/offscreen and settle or remove
decorative motion under reduced-motion settings, according to the family manual.
Unmounting retires observers, listeners and animation work. SSR must not start
browser clocks or manufacture observations; accessible admitted values remain
independent of animation.

The [UI reference](../ui-reference.md#which-motion-belongs-to-which-action) owns
cross-component motion routing. The
[theme evolution ledger](../../_work/design-token-theme-evolution-plan.md#shared-chart-language-convergence)
records reference differences and shared-token decisions. It is planning
evidence, not a second runtime theme or permission to reorder legacy Recharts
colors.

## Real Data: Acceptance Before Animation

Charts consume measured snapshots. Existing server data systems can maintain and
deliver those snapshots; a chart does not turn an animation into a successful
write, complete baseline or proven aggregate.

```text
Authorized source mutation
  → accepted transaction and any registered atomic rollup
  → authorized aggregate rows through managed Sync
  → bounded, pure useChartQuery projection
  → family model admission
  → chart geometry, inspection and exact data companion
```

For a small rollup in the same physical database, existing
[transaction functions](../../backend/database-automations/transaction-functions.md)
can update the source and aggregate atomically. An
[AFTER trigger](../../backend/database-automations/triggers.md) matches registered
insert/update/delete operations and invokes registered functions. Its declaration
alone does not install or execute them. On correction or deletion, the handler
must reverse the previous contribution; on insert/update, apply the accepted new
contribution. Rejected transactions must not appear as successful chart changes.

For external or deferred work, use the existing
[durable function/outbox](../../backend/database-automations/delivery.md) lifecycle.
At-least-once external delivery requires business idempotency. Expose an authorized
result/progress resource for the chart rather than reading the private outbox or
running a chart-owned retry timer. An expensive background job's progress and
completion must come from that job's actual accepted state.

[Fabric realtime](../../backend/fabric/realtime.md) preserves tracked, source-owned
changes, authorized delivery and managed replay/reset. Resource policy and live
principal/tenant authority govern what reaches the client. Neither a chart
predicate nor a selected series establishes authorization. Raw privileged SQL is
not guaranteed to produce tracked automation or Sync changes.

### The Current Reactive Bridge

`useChartQuery({ table, predicate?, project, maxRows? })` projects an already
authorized client collection through existing `useQuery` and scope-boundary
hooks. Use a bounded full-sync aggregate collection, not one page of a DataTable
or a partially cached event history. Resolved lazy/auto sources fail with
`CHART_QUERY_SOURCE_PARTIAL`; the hook does not infer completeness when source
metadata is unresolved.

Keep `predicate` and `project` pure, synchronous and stable. A predicate must
return an actual boolean. The whole available collection is checked against
`maxRows` before filtering: the default is 1000, the hard cap 10000. Invalid
budgets, excess rows, callback failures and async callback results produce typed
`ChartQueryError` results with `data: null`, not silent truncation or a retained
successful projection. `projectChartQueryRows` provides the same bounded pure
projection for rows the caller already holds; it does not fetch or authorize them.

The result exposes `data`, `error`, `rowCount`, `connected` and `readable`.
`rowCount` counts available source rows before the optional predicate, not an
exact database total. `connected` means transport connectivity, not baseline
completion or freshness. `readable` gates the current client authority; during
SSR or authority/scope retirement, data/errors are masked and the count is zero.
When disconnected but still readable, a cached projection may remain available;
the application must label its actual freshness and decide whether to display it.

Define aggregate-baseline readiness, period/window semantics and empty states
with the application's data contract. A connected empty cache is not evidence of
zero business activity. The [Sankey manual's reactive example](sankey.md#reactive-aggregate-collections)
shows explicit baseline gating; the other family manuals provide their own
measured-data projections. Rates, distinct counts, percentiles, missing values
and event timestamps need explicit definitions rather than sums of arbitrary
cached rows.

### Planned Server Aggregate Services

The current bridge is not the future named server aggregate API. The
[chart system plan](../../_work/charts-system-plan.md#later-chart-data-services)
tracks authorized snapshot requests with metric/window/filter definitions,
scope identity, revision and freshness; registered query-handler integration;
correction/deletion ownership; and reconnect/backpressure qualification. Those
are planned contracts, not callable `ZeroChart` options. Existing query,
automation, Fabric and job systems remain their authority owners; do not add a
parallel websocket, database selector or scheduler to a chart component.

## Distribution and Upgrade Checks

Installed entry points and source-copy are different delivery paths. For copied
components, use `zero add components/charts` for the full chart tree, or the
documented focused `components/charts/arc` / `components/charts/native` targets.
Keep the copied shared helpers and CSS dependency closure; each family manual
states its stylesheet/import requirements. Copying presentation does not copy or
create backend resources, providers or aggregate services.

Check the installed package's actual exports before using a working-source
addition. Qualify models, component/SSR builds, theme/overlay behavior, keyboard
and touch, live scope retirement and the real consumer path you changed. Source
organization work must preserve public imports and context identity; compatibility
files and the retained theme are not obsolete merely because a new family exists.

The [chart system plan](../../_work/charts-system-plan.md) records implementation
and qualification evidence separately from this API overview. It is also the
entry point for remaining data-service work; the five full manuals above own
individual chart contracts and examples.
