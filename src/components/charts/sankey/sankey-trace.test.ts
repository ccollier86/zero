/** Proportional trace conservation, reconvergence and explicit identity contracts. */
import { expect, test } from 'bun:test';
import { buildSankeyModel, sankeyPairId } from './sankey-model';
import { computeSankeyTrace } from './sankey-trace';

const build = () => buildSankeyModel({ nodes: ['a', 'b', 'mix', 'free', 'paid', 'keep', 'gone'].map(id => ({ id })), links: [
  { source: 'a', target: 'mix', value: 60 }, { source: 'b', target: 'mix', value: 40 },
  { source: 'mix', target: 'free', value: 70 }, { source: 'mix', target: 'paid', value: 30 },
  { source: 'free', target: 'keep', value: 35 }, { source: 'free', target: 'gone', value: 35 },
  { source: 'paid', target: 'keep', value: 20 }, { source: 'paid', target: 'gone', value: 10 },
] });

test('source tracing follows only its proportional share end to end through mixing and reconvergence', () => {
  const model = build(), trace = computeSankeyTrace(model, { kind: 'node', id: 'a' })!;
  expect(trace.kind).toBe('node'); expect(trace.value).toBe(60); expect(trace.share).toBe(.6); expect(trace.hue).toBe(1);
  expect(trace.links.get(sankeyPairId('mix', 'free'))!.amt).toBe(42);
  expect(trace.links.get(sankeyPairId('mix', 'paid'))!.amt).toBe(18);
  expect(trace.nodes.get('keep')!.amt).toBe(33); expect(trace.nodes.get('gone')!.amt).toBe(27);
  expect(trace.nodes.get('keep')!.comp).toEqual(new Float64Array([33, 0])); expect(trace.nodes.has('b')).toBe(false);
  expect(trace.nodes.get('mix')!.d).toBe(1); expect(trace.nodes.get('keep')!.d).toBe(3);
});

test('later nodes trace upstream in neutral ink with honest mixed source amounts', () => {
  const model = build(), trace = computeSankeyTrace(model, { kind: 'node', id: 'free' })!;
  expect(trace.hue).toBe(0); expect(trace.value).toBe(70); expect(trace.share).toBe(.7);
  expect(trace.nodes.get('a')!.amt).toBe(42); expect(trace.nodes.get('b')!.amt).toBe(28);
  expect(trace.nodes.get('keep')!.amt).toBe(35); expect(trace.nodes.get('gone')!.amt).toBe(35);
  expect(trace.nodes.has('paid')).toBe(false);
  expect(trace.links.get(sankeyPairId('mix', 'free'))).toMatchObject({ amt: 70, dir: 'up' });
  expect(trace.links.get(sankeyPairId('free', 'keep'))).toMatchObject({ amt: 35, dir: 'down' });
  expect(trace.nodes.get('free')!.self).toBe(true);
});

test('a selected link retains self geometry and .75 endpoint distances while tracing both directions', () => {
  const model = build(), id = sankeyPairId('mix', 'paid'), trace = computeSankeyTrace(model, { kind: 'link', id })!;
  expect(trace.links.get(id)).toMatchObject({ amt: 30, dir: 'self', d: 0, self: true });
  expect(trace.nodes.get('mix')!.d).toBe(.75); expect(trace.nodes.get('paid')!.d).toBe(.75);
  expect(trace.nodes.get('a')!.amt).toBe(18); expect(trace.nodes.get('b')!.amt).toBe(12);
  expect(trace.nodes.get('keep')!.amt).toBe(20); expect(trace.nodes.get('gone')!.amt).toBe(10);
  expect(trace.nodes.has('free')).toBe(false);
});

test('explicit parallel links and node/link IDs that coincide remain independently traceable', () => {
  const model = buildSankeyModel({ nodes: [{ id: 'same' }, { id: 'sink' }], links: [
    { id: 'same', source: 'same', target: 'sink', value: 4 }, { id: 'other', source: 'same', target: 'sink', value: 6 },
  ] });
  expect(computeSankeyTrace(model, { kind: 'node', id: 'same' })!.value).toBe(10);
  const link = computeSankeyTrace(model, { kind: 'link', id: 'same' })!;
  expect(link.value).toBe(4); expect(link.nodes.get('same')!.amt).toBe(4); expect(link.links.has('other')).toBe(false);
});

test('absorbed flow and midstream additions preserve origin mix without creating missing upstream units', () => {
  const model = buildSankeyModel({ nodes: ['source', 'add', 'absorb', 'sink'].map(id => ({ id })), links: [
    { source: 'source', target: 'add', value: 80 }, { source: 'add', target: 'absorb', value: 100 }, { source: 'absorb', target: 'sink', value: 50 },
  ] });
  const forward = computeSankeyTrace(model, { kind: 'node', id: 'source' })!;
  expect(forward.nodes.get('add')!.amt).toBe(80); expect(forward.nodes.get('sink')!.amt).toBe(40);
  const backward = computeSankeyTrace(model, { kind: 'node', id: 'sink' })!;
  expect(backward.nodes.get('source')!.amt).toBe(40); expect(backward.nodes.get('add')!.amt).toBe(50);
  expect(backward.cv).toEqual(new Float64Array([.8, .2]));
});

test('every trace amount and composition stays finite and within its real aggregate on a branching DAG', () => {
  const model = build();
  for (const target of [...model.nodes.map(node => ({ kind: 'node' as const, id: node.id })), ...model.links.map(link => ({ kind: 'link' as const, id: link.id }))]) {
    const trace = computeSankeyTrace(model, target)!;
    for (const [id, node] of trace.nodes) {
      expect(Number.isFinite(node.amt)).toBe(true); expect(node.amt).toBeGreaterThanOrEqual(0); expect(node.amt).toBeLessThanOrEqual(model.byId.get(id)!.value);
      expect(node.comp.reduce((sum, value) => sum + value, 0)).toBeCloseTo(node.amt, 10);
    }
    for (const [id, link] of trace.links) {
      expect(Number.isFinite(link.amt)).toBe(true); expect(link.amt).toBeGreaterThanOrEqual(0); expect(link.amt).toBeLessThanOrEqual(model.linkBy.get(id)!.value);
      expect(link.comp.reduce((sum, value) => sum + value, 0)).toBeCloseTo(link.amt, 10);
    }
  }
});

test('unknown, cleared and empty traces return null without changing the model', () => {
  const model = build(), before = model.nodes.map(node => Array.from(node.comp));
  expect(computeSankeyTrace(model, null)).toBeNull(); expect(computeSankeyTrace(model, { kind: 'node', id: 'missing' })).toBeNull();
  expect(computeSankeyTrace(model, { kind: 'link', id: 'missing' })).toBeNull();
  expect(computeSankeyTrace(buildSankeyModel({ nodes: [], links: [] }), { kind: 'node', id: 'missing' })).toBeNull();
  expect(model.nodes.map(node => Array.from(node.comp))).toEqual(before);
});
