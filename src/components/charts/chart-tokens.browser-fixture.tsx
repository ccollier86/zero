'use client';
/** Synthetic chart-family fixture: common scope overrides and portal inheritance, without provider/config execution. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SankeyChart } from './sankey/sankey-chart';
import { RaceBarChart } from './race-bar/race-bar-chart';
import { FunnelChart } from './funnel/funnel-chart';
import type { SankeyTraceTarget } from './sankey/sankey-types';

function ChartFamilyFixture() {
  const [trace, setTrace] = React.useState<SankeyTraceTarget | null>({ kind: 'node', id: 'source' });
  return <main style={{ padding: 24 }}>
    <h1>Chart family fixture</h1>
    <section data-testid="family-scope" style={{ display: 'grid', gap: 48, maxWidth: 700 }}>
      <SankeyChart label="Family flow" data={{ nodes: [{ id: 'source', label: 'Source' }, { id: 'end', label: 'Destination label' }],
        links: [{ source: 'source', target: 'end', value: 100 }] }} height={160} particleToggle={false}
        trace={trace} onTraceChange={next => setTrace(next ? { kind: next.kind, id: next.id } : null)} />
      <RaceBarChart label="Family ranking" title="Family ranking" data={{ groups: [{ id: 'first', label: 'First' }],
        items: [{ id: 'item', label: 'An identifiable product', group: 'first' }], frames: [{ id: 'today', period: 'Today', values: { item: 100 } }] }}
        selectedId="item" autoPlay={false} />
      <FunnelChart label="Family cohort" data={{ segments: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }],
        stages: [{ id: 'visit', label: 'Visited store', values: { first: 100, second: 50 } }, { id: 'buy', label: 'Purchased', values: { first: 50, second: 25 } }] }}
        controls={false} height={100} activeStageId="visit" view={{ kind: 'split' }} />
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<ChartFamilyFixture />);
