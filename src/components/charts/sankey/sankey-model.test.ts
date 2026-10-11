/** Pure model validation, graph identity and mixing contracts; no live data access. */
import { expect, test } from 'bun:test';
import { buildSankeyModel, SANKEY_LIMITS, sankeyNodeHue, sankeyPairId } from './sankey-model';
import type { SankeyData } from './sankey-types';

const simple = (): SankeyData => ({ nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b', value: 10 }] });
const total = (values: Float64Array): number => values.reduce((sum, value) => sum + value, 0);

test('build preserves immutable inputs and assigns longest-path columns independent of declaration order', () => {
  const data: SankeyData = { nodes: [{ id: 'sink' }, { id: 'source', column: 0 }, { id: 'middle' }],
    links: [{ source: 'source', target: 'middle', value: 10 }, { source: 'middle', target: 'sink', value: 10 }] };
  data.nodes.forEach(Object.freeze); data.links.forEach(Object.freeze); Object.freeze(data.nodes); Object.freeze(data.links); Object.freeze(data);
  const model = buildSankeyModel(data);
  expect(model.nodes.map(node => node.c)).toEqual([2, 0, 1]);
  expect(model.cols.map(column => column.map(node => node.id))).toEqual([['source'], ['middle'], ['sink']]);
  expect(model.total).toBe(10); expect(model.ncol).toBe(3); expect(model.byId.get('source')!.given).toBe(0);
  expect(sankeyNodeHue(model.byId.get('source')!)).toBe(1); expect(sankeyNodeHue(model.byId.get('middle')!)).toBe(0);
  expect(Object.keys(data.nodes[0]!)).toEqual(['id']); expect(model.nodes.every(node => total(node.comp) === 10)).toBe(true);
});

test('anonymous duplicates aggregate while explicitly identified parallel links stay separate', () => {
  const model = buildSankeyModel({ nodes: [{ id: 'a' }, { id: 'b' }], links: [
    { source: 'a', target: 'b', value: 2 }, { source: 'a', target: 'b', value: 3 },
    { id: 'cohort-1', source: 'a', target: 'b', value: 4 }, { id: 'cohort-2', source: 'a', target: 'b', value: 1 },
  ] });
  expect(model.links.map(link => [link.id, link.value])).toEqual([[sankeyPairId('a', 'b'), 5], ['cohort-1', 4], ['cohort-2', 1]]);
  expect(model.byId.get('a')!.out).toBe(10); expect(model.byId.get('b')!.inL).toHaveLength(3); expect(model.total).toBe(10);
});

test('zero links reserve IDs, aggregate with later values and do not create visible data', () => {
  const model = buildSankeyModel({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'unused' }], links: [
    { source: 'a', target: 'b', value: 0 }, { source: 'a', target: 'b', value: 2 },
  ] });
  expect(model.all).toHaveLength(3); expect(model.nodes).toHaveLength(2); expect(model.links).toHaveLength(1); expect(model.byId.has('unused')).toBe(false);
  const empty = buildSankeyModel({ ...simple(), links: [{ source: 'a', target: 'b', value: 0 }] });
  expect(empty.nodes).toHaveLength(0); expect(empty.links).toHaveLength(0); expect(empty.total).toBe(0); expect(empty.ncol).toBe(0);
});

test('canonical pair IDs cannot collide on arrow characters, JSON characters or prototype-like names', () => {
  const pairs = [['a→b', 'c'], ['a', 'b→c'], ['["a"', '__proto__'], ['constructor', '"x"]']] as const;
  const nodes = Array.from(new Set(pairs.flat())).map(id => ({ id }));
  const model = buildSankeyModel({ nodes, links: pairs.map(([source, target]) => ({ source, target, value: 1 })) });
  expect(new Set(model.links.map(link => link.id)).size).toBe(4);
  expect(model.byId.get('__proto__')!.value).toBe(1); expect(model.byId.get('constructor')!.value).toBe(1);
});

test('duplicate explicit IDs and explicit collisions with generated pair IDs reject in either order', () => {
  const ordinary = { source: 'a', target: 'b', value: 1 }, explicit = { ...ordinary, id: sankeyPairId('a', 'b') };
  for (const links of [[ordinary, explicit], [explicit, ordinary], [{ ...ordinary, id: 'same', value: 0 }, { ...ordinary, id: 'same' }]]) {
    expect(() => buildSankeyModel({ ...simple(), links })).toThrow(/Duplicate or colliding/);
  }
});

test('cycles including currently zero edges and disconnected cycles reject instead of growing phantom stages', () => {
  for (const value of [0, 1]) {
    expect(() => buildSankeyModel({ ...simple(), links: [{ source: 'a', target: 'b', value }, { source: 'b', target: 'a', value }] })).toThrow(/acyclic/);
  }
  expect(() => buildSankeyModel({ nodes: [...simple().nodes, { id: 'c' }, { id: 'd' }], links: [
    ...simple().links, { source: 'c', target: 'd', value: 0 }, { source: 'd', target: 'c', value: 0 },
  ] })).toThrow(/acyclic/);
});

test('column pins remain forward and bounded, including legal zero pins and sparse columns', () => {
  const valid = buildSankeyModel({ ...simple(), nodes: [{ id: 'a', column: 0 }, { id: 'b', column: 4 }] });
  expect(valid.cols.map(column => column.length)).toEqual([1, 0, 0, 0, 1]);
  for (const column of [-1, 1.5, NaN, Infinity, SANKEY_LIMITS.columns]) expect(() => buildSankeyModel({ ...simple(), nodes: [{ id: 'a', column }, { id: 'b' }] })).toThrow(/column pins/);
  expect(() => buildSankeyModel({ ...simple(), nodes: [{ id: 'a', column: 1 }, { id: 'b', column: 1 }] })).toThrow(/column pin conflicts/);
  const long = Array.from({ length: SANKEY_LIMITS.columns + 1 }, (_, index) => ({ id: String(index) }));
  expect(() => buildSankeyModel({ nodes: long, links: long.slice(1).map((node, index) => ({ source: String(index), target: node.id, value: 1 })) })).toThrow(/at most 64 columns/);
});

test('imbalance adds midstream origins or absorbs flow without claiming exact paths', () => {
  const model = buildSankeyModel({ nodes: ['a', 'b', 'add', 'absorb', 'sink'].map(id => ({ id })), links: [
    { source: 'a', target: 'add', value: 60 }, { source: 'b', target: 'add', value: 20 },
    { source: 'add', target: 'absorb', value: 100 }, { source: 'absorb', target: 'sink', value: 50 },
  ] });
  expect(model.total).toBe(100); expect(model.origins.map(node => node.id)).toEqual(['a', 'b', 'add']);
  expect(model.byId.get('add')!.comp).toEqual(new Float64Array([60, 20, 20]));
  expect(model.byId.get('absorb')!.comp).toEqual(new Float64Array([60, 20, 20]));
  expect(model.byId.get('sink')!.comp).toEqual(new Float64Array([30, 10, 10]));
  expect(sankeyNodeHue(model.byId.get('add')!)).toBe(0);
  for (const node of model.nodes) expect(total(node.comp)).toBeCloseTo(node.value, 10);
  for (const link of model.links) expect(total(link.comp)).toBeCloseTo(link.value, 10);
});

test('malformed values, identities, endpoints, self-links and unsafe allocation sizes reject explicitly', () => {
  for (const value of [-1, NaN, Infinity, -Infinity]) expect(() => buildSankeyModel({ ...simple(), links: [{ source: 'a', target: 'b', value }] })).toThrow(/finite nonnegative/);
  expect(() => buildSankeyModel({ ...simple(), links: [{ source: 'a', target: 'missing', value: 1 }] })).toThrow(/declared nodes/);
  expect(() => buildSankeyModel({ ...simple(), links: [{ source: 'a', target: 'a', value: 0 }] })).toThrow(/own node/);
  expect(() => buildSankeyModel({ ...simple(), nodes: [{ id: 'a' }, { id: 'a' }] })).toThrow(/Duplicate Sankey node/);
  for (const id of ['', 'x'.repeat(SANKEY_LIMITS.idLength + 1)]) expect(() => buildSankeyModel({ ...simple(), nodes: [{ id }, { id: 'b' }] })).toThrow(/nonempty string/);
  expect(() => buildSankeyModel({ ...simple(), nodes: [{ id: 'a', label: 'x'.repeat(SANKEY_LIMITS.labelLength + 1) }, { id: 'b' }] })).toThrow(/labels must/);
  expect(() => buildSankeyModel({ nodes: Array.from({ length: SANKEY_LIMITS.nodes + 1 }, (_, index) => ({ id: String(index) })), links: [] })).toThrow(/limited to/);
  expect(() => buildSankeyModel({ ...simple(), links: Array.from({ length: SANKEY_LIMITS.links + 1 }, () => simple().links[0]!) })).toThrow(/limited to/);
});

test('finite input values cannot overflow node aggregates, source totals or source mixing', () => {
  expect(() => buildSankeyModel({ ...simple(), links: [{ source: 'a', target: 'b', value: 1e308 }, { source: 'a', target: 'b', value: 1e308 }] })).toThrow(/overflow/);
  expect(() => buildSankeyModel({ nodes: ['a', 'b', 'c', 'd'].map(id => ({ id })), links: [{ source: 'a', target: 'b', value: 1e308 }, { source: 'c', target: 'd', value: 1e308 }] })).toThrow(/overflow/);
  const finite = buildSankeyModel({ ...simple(), links: [{ source: 'a', target: 'b', value: 1e308 }] });
  expect(finite.total).toBe(1e308); expect(finite.byId.get('b')!.comp[0]).toBe(1e308);
});
