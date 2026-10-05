/** Isolated public tooltip/config composition with synthetic series only. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChartContainer, ChartTooltipContent } from './chart';

const payload = [{ dataKey: 'count', name: 'count', value: 3, fill: 'var(--primary)', payload: {} }];

function Case({ name, labelKey, hideLabel, formatted = false }: {
  name: string; labelKey?: string; hideLabel?: boolean; formatted?: boolean;
}) {
  return <section data-case={name}>
    <ChartContainer style={{ width: 400, height: 200 }} config={{
      count: { label: 'Count series', color: 'var(--primary)' },
      heading: { label: 'Configured heading' },
    }}>
      <div><ChartTooltipContent active payload={payload} label="Raw heading"
        labelKey={labelKey} hideLabel={hideLabel}
        labelFormatter={formatted ? label => `Formatted ${label}` : undefined} />
      </div>
    </ChartContainer>
  </section>;
}

createRoot(document.getElementById('root')!).render(<>
  <Case name="configured" labelKey="heading" />
  <Case name="unknown" labelKey="missing" />
  <Case name="default" />
  <Case name="formatter" labelKey="heading" formatted />
  <Case name="hidden" labelKey="heading" hideLabel formatted />
</>);
