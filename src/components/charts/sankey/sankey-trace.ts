/**
 * Computes proportional bidirectional Sankey traces from validated aggregates.
 * This is honest mixing math, not reconstructed per-record journey attribution.
 */
import type { SankeyModel, SankeyModelNode, SankeyTrace, SankeyTraceTarget, SankeyNodeTrace, SankeyLinkTrace } from './sankey-types';
import { sankeyNodeHue } from './sankey-model';

const sum = (values: Float64Array): number => values.reduce((total, value) => total + value, 0);

/** Trace a node or stable link ID; unknown identities return null without mutation. */
export function computeSankeyTrace(model: SankeyModel, target: SankeyTraceTarget | null): SankeyTrace | null {
  if (!target) return null;
  const nodes = new Map<string, SankeyNodeTrace>(), links = new Map<string, SankeyLinkTrace>();
  const asc = model.nodes.slice().sort((a, b) => a.c - b.c || a.order - b.order);
  const down = new Map<SankeyModelNode, { amt: number; d: number }>(), up = new Map<SankeyModelNode, { amt: number; d: number }>();
  let value: number, hue: number, cv: Float64Array;
  if (target.kind === 'node') {
    const node = model.byId.get(target.id); if (!node) return null;
    value = node.value; hue = sankeyNodeHue(node); cv = node.comp.map(amount => amount / (sum(node.comp) || 1));
    nodes.set(node.id, { amt: value, comp: node.comp.slice(), d: 0, self: true });
    down.set(node, { amt: value, d: 0 }); up.set(node, { amt: value, d: 0 });
  } else {
    const link = model.linkBy.get(target.id); if (!link) return null;
    value = link.value; hue = sankeyNodeHue(link.s); cv = link.comp.map(amount => amount / (sum(link.comp) || 1));
    links.set(link.id, { amt: value, comp: link.comp.slice(), d: 0, dir: 'self', self: true });
    down.set(link.t, { amt: value, d: .75 }); up.set(link.s, { amt: value, d: .75 });
    nodes.set(link.t.id, { amt: value, comp: link.comp.slice(), d: .75 });
    nodes.set(link.s.id, { amt: value, comp: link.comp.slice(), d: .75 });
  }
  for (const node of asc) {
    const state = down.get(node); if (!state) continue;
    const share = Math.min(1, state.amt / node.value);
    for (const link of node.outL) {
      const amount = link.value * share; if (amount <= 0) continue;
      links.set(link.id, { amt: amount, comp: cv.map(component => component * amount), d: state.d, dir: 'down' });
      const prior = down.get(link.t), amt = Math.min(link.t.value, (prior?.amt ?? 0) + amount), d = Math.max(prior?.d ?? 0, state.d + 1);
      down.set(link.t, { amt, d }); nodes.set(link.t.id, { amt, comp: cv.map(component => component * amt), d });
    }
  }
  for (const node of asc.reverse()) {
    const state = up.get(node); if (!state) continue;
    const share = Math.min(1, state.amt / node.value);
    for (const link of node.inL) {
      const amount = link.value * share; if (amount <= 0) continue;
      links.set(link.id, { amt: amount, comp: link.comp.map(component => component * share), d: state.d, dir: 'up' });
      const prior = up.get(link.s), amt = Math.min(link.s.value, (prior?.amt ?? 0) + amount), d = Math.max(prior?.d ?? 0, state.d + 1);
      up.set(link.s, { amt, d });
      const total = sum(link.s.comp) || 1;
      nodes.set(link.s.id, { amt, comp: link.s.comp.map(component => component / total * amt), d });
    }
  }
  return { target: { ...target }, kind: target.kind, id: target.id, value, share: value / (model.total || 1), hue, nodes, links, cv };
}
