/**
 * Responsive abstract-axis Sankey layout. One shared value scale keeps column
 * widths comparable; injected font measurement keeps this module browser-free.
 */
import type { SankeyColumnHeading, SankeyLayout, SankeyLayoutOptions, SankeyModel, SankeyNodeGeometry } from './sankey-types';

/** Reference layout switch and upright minimum; component tokens may override height. */
export const SANKEY_LAYOUT_DEFAULTS = Object.freeze({ height: 340, uprightBelow: 420, uprightMinHeight: 480 });

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function defaultMeasure(text: string, kind: 'label' | 'value' | 'column'): number {
  const size = kind === 'value' ? 14 : kind === 'column' ? 11.5 : 12;
  // Stable SSR fallback; the browser can inject its actual theme font metrics.
  return Array.from(text).reduce((width, char) => width + (/[MW@#]/u.test(char) ? .82 : /[il.,' ]/u.test(char) ? .32 : .56) * size, 0);
}

/**
 * Compute horizontal/upright geometry without mutating the model. Actual
 * container width is respected, including widths below the reference demo's
 * 240px minimum. Sparse pinned columns remain real stages rather than collapsing.
 */
export function computeSankeyLayout(model: SankeyModel, options: SankeyLayoutOptions): SankeyLayout {
  const W = options.width, requestedHeight = options.height ?? SANKEY_LAYOUT_DEFAULTS.height;
  if (!Number.isFinite(W) || W <= 0 || W > 20_000) throw new Error('Sankey layout width must be finite, positive and at most 20000px.');
  if (!Number.isFinite(requestedHeight) || requestedHeight <= 0 || requestedHeight > 10_000) throw new Error('Sankey layout height must be finite, positive and at most 10000px.');
  const upright = options.orientation === 'vertical' || (options.orientation !== 'horizontal' && W < SANKEY_LAYOUT_DEFAULTS.uprightBelow);
  const measure = (text: string, kind: 'label' | 'value' | 'column'): number => {
    const width = (options.measureText ?? defaultMeasure)(text, kind);
    return Number.isFinite(width) && width >= 0 ? Math.min(width, 100_000) : defaultMeasure(text, kind);
  };
  const format = options.formatValue ?? (value => Math.round(value).toLocaleString());
  const formatted = new Map(model.nodes.map(node => [node.id, String(format(node.value))]));
  const nodes = new Map<string, SankeyNodeGeometry>(), links: SankeyLayout['links'] = new Map(), heads: SankeyColumnHeading[] = [];
  const hasHeadings = Boolean(options.columns?.length);
  const headH = upright ? 0 : hasHeadings ? 26 : 6;
  const H = upright ? Math.max(SANKEY_LAYOUT_DEFAULTS.uprightMinHeight, requestedHeight) : headH + requestedHeight;
  const nodeW = upright ? 10 : Math.min(12, W / 4);
  const P: SankeyLayout['P'] = upright ? (along, across) => [across, along] : (along, across) => [along, across + headH];
  if (!model.ncol) return { upright, W, H, nodes, links, heads, P, nodeW, k: 0 };

  const crossLen = upright ? W : requestedHeight;
  const last = model.cols[model.ncol - 1]!;
  const gutterWidth = Math.max(40, ...last.map(node => Math.max(measure(node.label, 'label'), measure(formatted.get(node.id)!, 'value')))) + 20;
  const gutter = clamp(gutterWidth, 70, W * .34);
  const top = hasHeadings ? 22 : 4;
  const span = upright ? H - top - 34 - nodeW : Math.max(0, W - gutter - nodeW);
  const colA = model.cols.map((_, column) => (upright ? top : 0) + (model.ncol > 1 ? column * span / (model.ncol - 1) : span / 2));
  let gap = upright ? clamp(crossLen * .035, 6, 12) : clamp(crossLen * .04, 8, 16);
  const densest = Math.max(...model.cols.map(column => column.length));
  if (densest > 1) gap = Math.min(gap, crossLen / (densest - 1) * .5);
  // Sum normalized values to avoid overflowing when a stage has several very
  // large nodes whose combined width still fits the requested geometry.
  const peakValue = Math.max(...model.nodes.map(node => node.value));
  const normalizedTotals = model.cols.map(column => sum(column.map(node => node.value / peakValue)));
  const normalizedScale = Math.min(...model.cols.map((column, index) => column.length
    ? Math.max(0, crossLen - gap * (column.length - 1)) / normalizedTotals[index]!
    : Infinity));
  // A subnormal flow can require an unrepresentably large scalar even though
  // its relative geometry is perfectly finite. Render using normalized values;
  // expose the nearest finite representable scalar instead of leaking Infinity.
  const k = Math.min(Number.MAX_VALUE, normalizedScale / peakValue);
  model.cols.forEach((column, index) => {
    const total = normalizedTotals[index]! * normalizedScale + gap * Math.max(0, column.length - 1);
    let across = (crossLen - total) / 2;
    for (const node of column) {
      const size = node.value / peakValue * normalizedScale;
      nodes.set(node.id, { a0: colA[index]!, a1: colA[index]! + nodeW, c0: across, c1: across + size, la: 0, lc: 0, two: false });
      across += size + gap;
    }
  });
  const mid = (id: string): number => { const geometry = nodes.get(id)!; return (geometry.c0 + geometry.c1) / 2; };
  for (const node of model.nodes) {
    const geometry = nodes.get(node.id)!;
    let across = geometry.c0 + (node.value - node.out) / peakValue * normalizedScale / 2;
    for (const link of node.outL.slice().sort((a, b) => mid(a.t.id) - mid(b.t.id))) {
      const w = link.value / peakValue * normalizedScale;
      const existing = links.get(link.id);
      links.set(link.id, { as: geometry.a1, at: existing?.at ?? 0, s0: across, t0: existing?.t0 ?? 0, w }); across += w;
    }
    across = geometry.c0 + (node.value - node.in) / peakValue * normalizedScale / 2;
    for (const link of node.inL.slice().sort((a, b) => mid(a.s.id) - mid(b.s.id))) {
      const existing = links.get(link.id);
      links.set(link.id, { as: existing?.as ?? 0, at: geometry.a0, s0: existing?.s0 ?? 0, t0: across, w: link.value / peakValue * normalizedScale });
      across += link.value / peakValue * normalizedScale;
    }
  }
  // Rendering is independent of declaration order: every link gets geometry
  // from both endpoints, even when its target was declared before its source.
  for (const link of model.links) {
    const geometry = links.get(link.id)!;
    geometry.as = nodes.get(link.s.id)!.a1; geometry.at = nodes.get(link.t.id)!.a0;
  }

  if (!upright) {
    for (const column of model.cols) {
      const labels = column.map(node => {
        const geometry = nodes.get(node.id)!, two = geometry.c1 - geometry.c0 >= 26;
        return { node, two, h: two ? 32 : 17, y: (geometry.c0 + geometry.c1) / 2 };
      });
      for (let iteration = 0; iteration < 60; iteration++) {
        let moved = false;
        for (let index = 1; index < labels.length; index++) {
          const prior = labels[index - 1]!, current = labels[index]!, need = (current.h + prior.h) / 2 + 2;
          const distance = current.y - prior.y;
          if (distance < need) { const push = (need - distance) / 2; prior.y -= push; current.y += push; moved = true; }
        }
        for (const label of labels) label.y = clamp(label.y, Math.min(label.h / 2, crossLen / 2), Math.max(crossLen - label.h / 2, crossLen / 2));
        if (!moved) break;
      }
      for (const label of labels) Object.assign(nodes.get(label.node.id)!, { la: nodes.get(label.node.id)!.a1 + 8, lc: label.y, two: label.two });
    }
  } else {
    for (const column of model.cols) column.forEach((node, index) => {
      const geometry = nodes.get(node.id)!, next = column[index + 1] ? nodes.get(column[index + 1]!.id)! : null;
      const prior = column[index - 1] ? nodes.get(column[index - 1]!.id)! : null;
      Object.assign(geometry, { la: geometry.a1 + 14, lc: (geometry.c0 + geometry.c1) / 2, two: true,
        lw: Math.min(W, Math.max(Math.min(24, W), Math.min(geometry.c1 - geometry.c0 + Math.min(next ? next.c0 - geometry.c1 : 40, prior ? geometry.c0 - prior.c1 : 40), 150))) });
    });
  }
  if (options.columns?.length) {
    for (let index = 0; index < model.ncol; index++) {
      const text = options.columns[index]; if (!text) continue;
      heads.push({ text, i: index, x: upright ? 0 : colA[index]!, y: upright ? colA[index]! - 8 : 14, w: measure(text, 'column') });
    }
    if (!upright && !heads.every((heading, index) => (index === 0 || heading.x > heads[index - 1]!.x + heads[index - 1]!.w + 12) && heading.x + heading.w <= W)) heads.length = 0;
  }
  return { upright, W, H, nodes, links, heads, P, nodeW, k };
}
