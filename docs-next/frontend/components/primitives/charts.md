---
id: zero.frontend.components.primitives.charts
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: charts-statistics
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Charts And Statistics

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

The `@zero/framework/components/ui/chart` module exports ChartContainer,
ChartStyle, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
useChart and ChartConfig. It styles Recharts composition; it is not a metric
collector, query engine or provider cost catalog.

ChartConfig maps series keys to optional label, icon, color and theme. Use stable
keys matching dataKey/name. ChartContainer requires config and a compatible
Recharts child, plus native div props. It supplies context, responsive sizing,
a unique data-chart identifier and scoped CSS variables --color-<series>.
Give its container a usable height/aspect ratio. ChartStyle can be rendered
explicitly with id/config, but the container already owns its style emission.
theme.light supplies the base rule and theme.dark the .dark descendant rule;
an explicit shared color takes precedence in both lanes.
Use trusted developer-owned config, not unvalidated public CSS/series identifiers.

ChartTooltip and ChartLegend are Recharts exports. ChartTooltipContent requires
its container context and renders only with active/nonempty payload. Optional
props include hideLabel, hideIndicator, indicator dot|line|dashed (dot default),
nameKey, labelKey, labelFormatter and formatter. labelKey selects a named
ChartConfig entry's label for the heading, falling back to the raw label when
missing. hideLabel suppresses it; an explicit labelFormatter takes precedence
and still receives the raw label/payload.
Formatter receives value, resolved key, item, index and its payload. Missing
numbers do not become a zero sample automatically. ChartLegendContent uses
payload, hideIcon and nameKey plus div props; empty payload renders nothing.
useChart outside a container throws; it returns the config context.

```tsx
import { ChartContainer } from '@zero/framework/components/ui/chart';
import { LineChart, Line } from 'recharts';

export function ExampleSeries() {
  return <ChartContainer config={{ count: { label: 'Count', color: 'var(--primary)' } }}>
    <LineChart data={[{ count: 2 }, { count: 4 }]}>
      <Line dataKey="count" stroke="var(--color-count)" />
    </LineChart>
  </ChartContainer>;
}
```

This display example needs Recharts in the app and a sized parent. It does not
claim an observability query or live subscription.

## StatCard

The `/stat-card` module exports StatCard/StatCardProps. label and numeric value
are required. Optional prefix/suffix, trend {value,direction:up|down|flat}, icon,
decimalPlaces=0 and className control presentation. The caller computes the
metric/rate/window and decides whether a change is good or bad; direction drives
source styling, not business interpretation. It does not aggregate periods,
prices, token components or non-additive measures.

## Related Guides And Next Steps

- [Observability](../../../backend/observability/index.md) owns events/sinks.
- [Design tokens](../../design-system/tokens.md) supplies coherent chart color choices.
- [Tables](./tables-and-pagination.md) provides exact accessible data companions.
