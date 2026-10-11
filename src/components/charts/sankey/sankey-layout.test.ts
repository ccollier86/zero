/** Responsive reference geometry and finite bounded layout contracts, without DOM. */
import { expect, test } from 'bun:test';
import { buildSankeyModel, sankeyPairId } from './sankey-model';
import { computeSankeyLayout } from './sankey-layout';

const model = () => buildSankeyModel({ nodes: ['a', 'b', 'middle', 'sink'].map(id => ({ id })), links: [
  { source: 'a', target: 'middle', value: 60 }, { source: 'b', target: 'middle', value: 40 }, { source: 'middle', target: 'sink', value: 100 },
] });

test('horizontal layout preserves common scale, reference widths and column headings', () => {
  const value = model(), layout = computeSankeyLayout(value, { width: 960, columns: ['Source', 'Activation', 'Plan'], measureText: () => 40 });
  expect(layout.upright).toBe(false); expect(layout.H).toBe(366); expect(layout.W).toBe(960); expect(layout.nodeW).toBe(12);
  expect(layout.P(10, 20)).toEqual([10, 46]); expect(layout.heads.map(head => [head.x, head.y])).toEqual([[0, 14], [439, 14], [878, 14]]);
  const a = layout.nodes.get('a')!, b = layout.nodes.get('b')!, middle = layout.nodes.get('middle')!;
  expect((a.c1 - a.c0) / (b.c1 - b.c0)).toBeCloseTo(1.5, 10);
  expect(middle.c1 - middle.c0).toBeCloseTo((a.c1 - a.c0) + (b.c1 - b.c0), 10);
  for (const link of value.links) expect(layout.links.get(link.id)!.w).toBeCloseTo(link.value * layout.k, 10);
  expect(layout.nodes.get('sink')!.a0).toBe(878);
});

test('upright switches below420 and accepts a real narrow container without forced horizontal width', () => {
  for (const width of [419, 390, 200, 80, 1]) {
    const layout = computeSankeyLayout(model(), { width, columns: ['Source', 'Activation', 'Plan'] });
    expect(layout.upright).toBe(true); expect(layout.W).toBe(width); expect(layout.H).toBe(480); expect(layout.nodeW).toBe(10);
    expect(layout.P(10, 20)).toEqual([20, 10]); expect(layout.heads.map(head => head.x)).toEqual([0, 0, 0]);
    for (const geometry of layout.nodes.values()) {
      expect(geometry.c0).toBeGreaterThanOrEqual(-1e-10); expect(geometry.c1).toBeLessThanOrEqual(width + 1e-10); expect(geometry.lw!).toBeLessThanOrEqual(width);
    }
  }
  expect(computeSankeyLayout(model(), { width: 420 }).upright).toBe(false);
  expect(computeSankeyLayout(model(), { width: 300, orientation: 'horizontal' }).upright).toBe(false);
  expect(computeSankeyLayout(model(), { width: 800, orientation: 'vertical', height: 720 }).H).toBe(720);
});

test('target-before-source declaration does not erase either ribbon offset', () => {
  const data = { nodes: [{ id: 'sink' }, { id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'sink', value: 60 }, { source: 'b', target: 'sink', value: 40 }] };
  const first = computeSankeyLayout(buildSankeyModel(data), { width: 900 });
  const second = computeSankeyLayout(buildSankeyModel({ ...data, nodes: [data.nodes[1]!, data.nodes[2]!, data.nodes[0]!] }), { width: 900 });
  expect(first.links.get(sankeyPairId('a', 'sink'))).toEqual(second.links.get(sankeyPairId('a', 'sink')));
  expect(first.links.get(sankeyPairId('b', 'sink'))).toEqual(second.links.get(sankeyPairId('b', 'sink')));
  expect(first.links.get(sankeyPairId('a', 'sink'))!.t0).toBeGreaterThan(0);
  expect(first.links.get(sankeyPairId('b', 'sink'))!.t0).toBeGreaterThan(first.links.get(sankeyPairId('a', 'sink'))!.t0);
});

test('sparse pinned stages have finite geometry without phantom nodes', () => {
  const value = buildSankeyModel({ nodes: [{ id: 'a', column: 0 }, { id: 'b', column: 4 }], links: [{ source: 'a', target: 'b', value: 1 }] });
  const layout = computeSankeyLayout(value, { width: 800 });
  expect(layout.nodes.size).toBe(2); expect(layout.k).toBe(340); expect(layout.links.size).toBe(1);
  expect(layout.nodes.get('b')!.a0).toBeGreaterThan(layout.nodes.get('a')!.a1);
});

test('headings hide together when they cannot all fit and browser fonts can be injected safely', () => {
  expect(computeSankeyLayout(model(), { width: 500, columns: ['Source', 'Activation', 'Plan'], measureText: () => 1000 }).heads).toHaveLength(0);
  const calls: Array<[string, string]> = [];
  const layout = computeSankeyLayout(model(), { width: 800, formatValue: value => `custom:${value}`, columns: ['Source', 'Activation', 'Plan'],
    measureText: (text, kind) => { calls.push([text, kind]); return kind === 'label' ? NaN : 40; } });
  expect(calls).toContainEqual(['custom:100', 'value']); expect(calls).toContainEqual(['Source', 'column']);
  expect(layout.nodes.size).toBe(4); expect(Number.isFinite(layout.k)).toBe(true);
});

test('empty models are finite and useful in either orientation', () => {
  const empty = buildSankeyModel({ nodes: [], links: [] });
  for (const width of [300, 800]) {
    const layout = computeSankeyLayout(empty, { width });
    expect(layout.nodes.size).toBe(0); expect(layout.links.size).toBe(0); expect(layout.heads).toHaveLength(0); expect(layout.k).toBe(0);
    expect(Number.isFinite(layout.H)).toBe(true);
  }
});

test('dense allowed inputs never produce negative, infinite or NaN ribbon and node geometry', () => {
  const sources = Array.from({ length: 200 }, (_, index) => ({ id: `s${index}` }));
  const value = buildSankeyModel({ nodes: [...sources, { id: 'sink' }], links: sources.map(source => ({ source: source.id, target: 'sink', value: 1 })) });
  for (const width of [1, 200, 500, 960]) {
    const layout = computeSankeyLayout(value, { width });
    for (const geometry of [...layout.nodes.values(), ...layout.links.values()]) {
      for (const field of Object.values(geometry)) if (typeof field === 'number') expect(Number.isFinite(field)).toBe(true);
    }
    for (const geometry of layout.nodes.values()) expect(geometry.c1).toBeGreaterThanOrEqual(geometry.c0);
    for (const geometry of layout.links.values()) expect(geometry.w).toBeGreaterThanOrEqual(0);
  }
});

test('very large and subnormal finite values have stable finite normalized geometry', () => {
  for (const amount of [1e308, Number.MIN_VALUE]) {
    const value = buildSankeyModel({ nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b', value: amount }] });
    const layout = computeSankeyLayout(value, { width: 960 });
    expect(layout.nodes.get('a')!.c1 - layout.nodes.get('a')!.c0).toBe(340); expect(layout.links.values().next().value!.w).toBe(340);
    expect(Number.isFinite(layout.k)).toBe(true);
  }
});

test('invalid or unbounded layout dimensions reject before rendering allocations', () => {
  for (const width of [0, -1, NaN, Infinity, 20_001]) expect(() => computeSankeyLayout(model(), { width })).toThrow(/layout width/);
  for (const height of [0, -1, NaN, Infinity, 10_001]) expect(() => computeSankeyLayout(model(), { width: 800, height })).toThrow(/layout height/);
});
