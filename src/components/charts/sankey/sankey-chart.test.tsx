/** SSR/pure rendering contracts for the aggregate Sankey organism and its React inspector extension points. */
import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SankeyChart, SankeyFlowTable } from './sankey-chart';
import { SankeyNodeTooltip, SankeyLinkTooltip } from './sankey-inspection';
import { buildSankeyModel } from './sankey-model';
import { computeSankeyTrace } from './sankey-trace';
import { SANKEY_MOTION_DEFAULTS, validateSankeyPaintBudget } from './sankey-runtime';
const data = { nodes: [{ id: 'a', label: 'Search' }, { id: 'b', label: 'Activated' }, { id: 'c', label: 'Free' }],
  links: [{ id: 'ab', source: 'a', target: 'b', value: 10 }, { id: 'bc', source: 'b', target: 'c', value: 10 }] };

test('chart renders a truthful accessible aggregate table without browser globals or DB clients', () => {
  const html = renderToStaticMarkup(<SankeyChart data={data} label="Acquisition" unit="people" totalLabel="signups" />);
  expect(html).toContain('data-slot="sankey-chart"'); expect(html).toContain('<caption>Acquisition</caption>');
  expect(html).toContain('10 people'); expect(html).toContain('proportional mixing, not exact individual journeys');
  expect(html).not.toContain('foreignObject'); expect(html).not.toContain('<script');
});
test('all reference motion defaults are explicit and exact', () => {
  expect(SANKEY_MOTION_DEFAULTS).toEqual({ enter: 1000, stagger: 130, morph: 700, traceStep: 140, pour: 440, fade: 260 });
});
test('default inspectors use actual totals and shares while custom React content is escaped', () => {
  const model = buildSankeyModel(data), node = model.byId.get('b')!, link = model.linkBy.get('ab')!, formatValue = (n: number) => '$' + n;
  const common = { model, formatValue, unit: 'units', totalLabel: 'signups' };
  expect(renderToStaticMarkup(<SankeyNodeTooltip {...common} node={node} trace={computeSankeyTrace(model, { kind: 'node', id: 'b' })!} />)).toContain('100% of signups');
  const html = renderToStaticMarkup(<SankeyLinkTooltip {...common} link={link} trace={computeSankeyTrace(model, { kind: 'link', id: 'ab' })!} />);
  expect(html).toContain('$10 units'); expect(html).toContain('Search to Activated');
  const escaped = renderToStaticMarkup(<SankeyFlowTable model={buildSankeyModel({ ...data, nodes: [{ id: 'a', label: '<img onerror=oops>' }, ...data.nodes.slice(1)] })} label="Safe" />);
  expect(escaped).toContain('&lt;img onerror=oops&gt;'); expect(escaped).not.toContain('<img');
});
test('dense split-origin graphs fail explicitly instead of allocating unbounded SVG bands', () => {
  const nodes = Array.from({ length: 64 }, (_, i) => ({ id: 'a' + i })).concat(Array.from({ length: 64 }, (_, i) => ({ id: 'b' + i })));
  const links = Array.from({ length: 64 }, (_, i) => Array.from({ length: 64 }, (_, j) => ({ source: 'a' + i, target: 'b' + j, value: 1 }))).flat().slice(0, 2048);
  const model = buildSankeyModel({ nodes, links });
  expect(() => validateSankeyPaintBudget(model, 'mix')).toThrow('origin-element budget');
  expect(() => validateSankeyPaintBudget(model, 'source')).not.toThrow();
});
test('invalid particle speed is rejected before a presentation clock can start', () => {
  expect(() => renderToStaticMarkup(<SankeyChart data={data} label="Invalid" particleSpeed={Infinity} />)).toThrow('particleSpeed');
});
