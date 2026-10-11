/**
 * Validates bounded acyclic Sankey aggregates and computes their proportional
 * source mix. Pure presentation math: no database, transport or browser access.
 */
import type { SankeyData, SankeyModel, SankeyModelLink, SankeyModelNode } from './sankey-types';

/** Conservative rendering/composition bounds; never allocate from raw values. */
export const SANKEY_LIMITS = Object.freeze({ nodes: 256, links: 2048, columns: 64, idLength: 256, labelLength: 4096 });

/** Collision-proof identity for anonymous endpoint pairs (not a delimiter join). */
export function sankeyPairId(source: string, target: string): string {
  return `pair:${JSON.stringify([source, target])}`;
}

function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > SANKEY_LIMITS.idLength) {
    throw new Error(`Sankey ${label} must be a nonempty string of at most ${SANKEY_LIMITS.idLength} characters.`);
  }
}

function add(a: number, b: number): number {
  const value = a + b;
  if (!Number.isFinite(value)) throw new Error('Sankey aggregate values overflow a finite number.');
  return value;
}

/** Source nodes carry their own series; downstream aggregate nodes stay neutral. */
export function sankeyNodeHue(node: SankeyModelNode): number {
  return node.origin !== undefined && node.in === 0 ? node.hue : 0;
}

/**
 * Build a validated model without mutating inputs. Anonymous duplicate pairs
 * aggregate; explicitly identified parallel links remain independently traceable.
 * Cycles and column conflicts are rejected even when their links are currently 0.
 */
export function buildSankeyModel(data: SankeyData): SankeyModel {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('Sankey data requires nodes and links arrays.');
  if (data.nodes.length > SANKEY_LIMITS.nodes || data.links.length > SANKEY_LIMITS.links) {
    throw new Error(`Sankey data is limited to ${SANKEY_LIMITS.nodes} nodes and ${SANKEY_LIMITS.links} links.`);
  }
  const all: SankeyModelNode[] = [], declared = new Map<string, SankeyModelNode>();
  for (const [order, input] of data.nodes.entries()) {
    identifier(input?.id, 'node id');
    if (declared.has(input.id)) throw new Error(`Duplicate Sankey node id: ${input.id}`);
    if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > SANKEY_LIMITS.labelLength)) {
      throw new Error(`Sankey node labels must be strings of at most ${SANKEY_LIMITS.labelLength} characters.`);
    }
    if (input.column !== undefined && (!Number.isInteger(input.column) || input.column < 0 || input.column >= SANKEY_LIMITS.columns)) {
      throw new Error(`Sankey column pins must be integers from 0 to ${SANKEY_LIMITS.columns - 1}.`);
    }
    const node: SankeyModelNode = { id: input.id, label: input.label ?? input.id, given: input.column ?? null,
      order, in: 0, out: 0, value: 0, c: input.column ?? 0, inL: [], outL: [], hue: 0, comp: new Float64Array(0) };
    all.push(node); declared.set(node.id, node);
  }

  const links: SankeyModelLink[] = [], identities = new Set<string>(), anonymous = new Map<string, SankeyModelLink>();
  // Declared topology includes zero-valued edges so invalid graphs cannot hide
  // until a later reactive update changes a value from zero to positive.
  const successors = new Map(all.map(node => [node, new Set<SankeyModelNode>()]));
  const predecessors = new Map(all.map(node => [node, new Set<SankeyModelNode>()]));
  for (const input of data.links) {
    identifier(input?.source, 'source id'); identifier(input?.target, 'target id');
    if (input.id !== undefined) identifier(input.id, 'link id');
    if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0) throw new Error('Sankey link values must be finite nonnegative numbers.');
    const s = declared.get(input.source), t = declared.get(input.target);
    if (!s || !t) throw new Error(`Sankey link endpoints must name declared nodes: ${input.source} to ${input.target}`);
    if (s === t) throw new Error('Sankey links cannot point to their own node.');
    const pair = sankeyPairId(s.id, t.id), id = input.id ?? pair;
    // All IDs reserve their identity even when the corresponding value is zero.
    if (input.id !== undefined) {
      if (identities.has(id)) throw new Error(`Duplicate or colliding Sankey link id: ${id}`);
      identities.add(id);
    } else if (!anonymous.has(pair)) {
      if (identities.has(id)) throw new Error(`Duplicate or colliding Sankey link id: ${id}`);
      identities.add(id);
      const placeholder: SankeyModelLink = { id, key: id, s, t, value: 0, comp: new Float64Array(0) };
      anonymous.set(pair, placeholder);
    }
    successors.get(s)!.add(t); predecessors.get(t)!.add(s);
    if (input.value === 0) continue;
    if (input.id === undefined) {
      const link = anonymous.get(pair)!;
      if (link.value === 0) { links.push(link); s.outL.push(link); t.inL.push(link); }
      link.value = add(link.value, input.value);
    } else {
      const link: SankeyModelLink = { id, key: id, s, t, value: input.value, comp: new Float64Array(0) };
      links.push(link); s.outL.push(link); t.inL.push(link);
    }
    s.out = add(s.out, input.value); t.in = add(t.in, input.value);
  }

  const incoming = new Map(all.map(node => [node, predecessors.get(node)!.size]));
  const queue = all.filter(node => incoming.get(node) === 0), topological: SankeyModelNode[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor]!;
    let earliest = 0;
    for (const source of predecessors.get(node)!) earliest = Math.max(earliest, source.c + 1);
    if (node.given !== null && node.given < earliest) throw new Error(`Sankey column pin conflicts with forward flow at node: ${node.id}`);
    node.c = node.given ?? earliest;
    if (node.c >= SANKEY_LIMITS.columns) throw new Error(`Sankey paths may cross at most ${SANKEY_LIMITS.columns} columns.`);
    topological.push(node);
    for (const target of successors.get(node)!) {
      const count = incoming.get(target)! - 1; incoming.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  if (topological.length !== all.length) throw new Error('Sankey data must be acyclic.');

  all.forEach(node => { node.value = Math.max(node.in, node.out); });
  const nodes = all.filter(node => node.value > 0), origins = nodes.filter(node => node.out > node.in);
  let sourceSeries = 0;
  origins.forEach((node, origin) => { node.origin = origin; node.hue = node.in === 0 ? (sourceSeries++ % 6) + 1 : 0; });
  const O = origins.length;
  for (const node of topological) {
    const comp = new Float64Array(O);
    for (const link of node.inL) for (let origin = 0; origin < O; origin++) comp[origin] = add(comp[origin]!, link.comp[origin]!);
    if (node.origin !== undefined) comp[node.origin] = add(comp[node.origin]!, node.out - node.in);
    let total = 0; for (const value of comp) total = add(total, value);
    node.comp = comp.map(value => total > 0 ? value / total * node.value : 0);
    for (const link of node.outL) link.comp = node.comp.map(value => node.value > 0 ? value / node.value * link.value : 0);
  }
  let total = 0; for (const origin of origins) total = add(total, origin.out - origin.in);
  const ncol = nodes.length ? Math.max(...nodes.map(node => node.c)) + 1 : 0;
  const cols = Array.from({ length: ncol }, (_, column) => nodes.filter(node => node.c === column));
  return { nodes, all, byId: new Map(nodes.map(node => [node.id, node])), links, linkBy: new Map(links.map(link => [link.id, link])), cols, ncol, origins, O, total };
}
