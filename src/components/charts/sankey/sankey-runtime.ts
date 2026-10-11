/**
 * Owns Sankey SVG/canvas paint and its interruption-safe presentation clock.
 * Consumes validated models/layouts only; it never fetches, persists or advances business state.
 */
import { computeSankeyLayout } from './sankey-layout';
import { computeSankeyTrace } from './sankey-trace';
import type { SankeyModel, SankeyModelNode, SankeyModelLink, SankeyLayout, SankeyNodeGeometry, SankeyLinkGeometry,
  SankeyTrace, SankeyTraceTarget } from './sankey-types';
import { clamp, segment, easeInOut, easeOut, lerp, ribbonPath, ribbonCurves, cubicPoint, collapseNode, collapseLink, mixNode, mixLink } from './sankey-geometry';
import { chartSeriesPaint, CHART_FLOW_COLORS } from '../chart-tokens';
import { observePresentationTheme } from '../../../lib/observe-presentation-theme';

/** Reference timings in milliseconds; CSS tokens can retune these without changing data behavior. */
export const SANKEY_MOTION_DEFAULTS = Object.freeze({ enter: 1000, stagger: 130, morph: 700, traceStep: 140, pour: 440, fade: 260 });
export interface SankeyRuntimeOptions {
  height?: number; columns?: readonly string[]; orientation?: 'auto' | 'horizontal' | 'vertical';
  traceColor?: 'source' | 'mix'; motion?: boolean; particles?: boolean; particleSpeed?: number;
  formatValue: (value: number) => string;
  onLayout?: (layout: SankeyLayout) => void;
}
export interface SankeyRuntimeElements { figure: HTMLElement; plot: HTMLElement; back: SVGSVGElement; front: SVGSVGElement; canvas: HTMLCanvasElement; }
/** Limit the optional split-origin paint layer; source traces remain available for dense aggregate graphs. */
export function validateSankeyPaintBudget(model: SankeyModel, traceColor: 'source' | 'mix' = 'source'): void {
  if (traceColor === 'mix' && model.O * (model.nodes.length + model.links.length) > 4096) {
    throw new RangeError('Sankey mix traces exceed the 4,096 origin-element budget. Use traceColor="source" or aggregate the graph further.');
  }
}
interface NodePaint { n: SankeyModelNode; from: SankeyNodeGeometry; to: SankeyNodeGeometry; g: SankeyNodeGeometry;
  delay: number; removed?: boolean; rect: SVGRectElement; fills: SVGRectElement[][]; hit: SVGRectElement | null;
  label: SVGTextElement; name: SVGTSpanElement; value: SVGTSpanElement; }
interface LinkPaint { l: SankeyModelLink; from: SankeyLinkGeometry; to: SankeyLinkGeometry; g: SankeyLinkGeometry;
  delay: number; removed?: boolean; base: SVGPathElement; bands: SVGPathElement[][]; hit: SVGPathElement | null; }
interface PaintedTrace { trace: SankeyTrace; started: number; fadeAt?: number; }
interface Particle { u: LinkPaint; t: number; f: number; speed: number; }
const NS = 'http://www.w3.org/2000/svg';
const attr = (element: Element, key: string, value: string | number) => { const text = String(value); if (element.getAttribute(key) !== text) element.setAttribute(key, text); };
const rgb = (value: readonly number[]) => `rgb(${value.join(',')})`;
const sourceHue = (node: SankeyModelNode) => node.origin != null && node.in === 0 ? node.hue : 0;
const hue = (index: number) => index ? chartSeriesPaint(index, CHART_FLOW_COLORS, '--zero-chart-series-') : 'var(--zero-sankey-node)';
const ink = (index: number) => index ? chartSeriesPaint(index, CHART_FLOW_COLORS, '--zero-chart-series-')
  : 'var(--zero-sankey-ink, var(--zero-sankey-neutral-ink-default, var(--zero-chart-secondary, var(--text-secondary, var(--muted-foreground)))))';

/** A presentation-only runtime; destroy disconnects every observer/listener and cancels its frame. */
export class SankeyPaintRuntime {
  private model: SankeyModel | null = null;
  private layout: SankeyLayout | null = null;
  private options: SankeyRuntimeOptions;
  private nodes: NodePaint[] = [];
  private links: LinkPaint[] = [];
  private traces: [PaintedTrace | null, PaintedTrace | null] = [null, null];
  private slot = 0; private dim = 0; private target: SankeyTraceTarget | null = null;
  private particles: Particle[] = []; private particleStart = Infinity;
  private started = false; private visible = false; private destroyed = false;
  private raf = 0; private last = 0; private morphStart = Infinity; private morphDuration = 1; private settling = true;
  private ctx: CanvasRenderingContext2D | null;
  private colorProbe: CanvasRenderingContext2D | null;
  private colors = { palette: [] as number[][], node: [128, 128, 128], ink: [64, 64, 64], ribbon: .2, band: .46, dot: 1.2 };
  private durations = { enter: 1, stagger: .13, morph: .7, traceStep: .14, pour: .44, fade: .26 };
  private fonts = { label: '400 12px system-ui', value: '500 14px system-ui', column: '500 11.5px system-ui' };
  private fontMetrics = '';
  private layoutFontMetrics = '';
  private pixelRatio = 0;
  private reduce: MediaQueryList;
  private resize: ResizeObserver;
  private intersection: IntersectionObserver;
  private releaseTheme: () => void;
  private view: Window;
  private document: Document;

  constructor(private elements: SankeyRuntimeElements, options: SankeyRuntimeOptions) {
    this.options = options;
    this.document = elements.plot.ownerDocument; this.view = this.document.defaultView!;
    this.ctx = elements.canvas.getContext('2d');
    const probe = this.document.createElement('canvas'); probe.width = probe.height = 1; this.colorProbe = probe.getContext('2d', { willReadFrequently: true });
    this.reduce = this.view.matchMedia('(prefers-reduced-motion: reduce)');
    this.resize = new ResizeObserver(() => {
      if (this.destroyed || !this.model || !this.layout) return;
      const width = Math.max(1, Math.round(elements.plot.clientWidth));
      if (width === this.layout.W) return;
      this.relayout(false);
    });
    this.resize.observe(elements.plot);
    this.intersection = new IntersectionObserver(entries => {
      if (this.destroyed) return;
      this.visible = entries[0]?.isIntersecting ?? false;
      if (this.visible && !this.started) { this.started = true; if (this.morphStart === Infinity) this.morphStart = this.now(); }
      if (!this.visible) this.stop(); else this.kick();
    }, { threshold: .15 });
    this.intersection.observe(elements.plot);
    this.releaseTheme = observePresentationTheme(elements.figure, this.repaintTheme);
    this.document.addEventListener('visibilitychange', this.visibility);
    this.reduce.addEventListener('change', this.motionChanged);
    this.document.fonts?.addEventListener('loadingdone', this.repaintTheme);
    // A loaded theme font can change the last-column gutter and label collision bounds.
    if (this.document.fonts?.status === 'loading') void this.document.fonts.ready.then(() => {
      this.repaintTheme();
    });
    this.resolvePaint();
  }
  private now() { return this.view.performance.now() / 1000; }
  private reduced() { return this.reduce.matches || this.options.motion === false; }
  private visibility = () => { if (this.document.hidden) this.stop(); else this.kick(); };
  private motionChanged = () => { if (this.destroyed) return; if (this.reduced()) this.morphStart = -1e9; this.render(this.now()); this.kick(); };
  private repaintTheme = () => {
    if (this.destroyed) return;
    this.resolvePaint();
    if (this.model && this.layoutFontMetrics !== this.fontMetrics) this.relayoutPresentation();
    else { if (this.layout && this.pixelRatio !== this.resolvePixelRatio()) this.size(); this.render(this.now()); }
    this.kick();
  };
  private resolvePaint() {
    const css = this.view.getComputedStyle(this.elements.figure), get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const numeric = (name: string, fallback: number, min: number, max: number) => {
      const value = Number(get(name, String(fallback))); return Number.isFinite(value) ? clamp(value, min, max) : fallback;
    };
    const color = (value: string) => {
      const context = this.colorProbe; if (!context) return [128, 128, 128];
      context.clearRect(0, 0, 1, 1); context.fillStyle = '#808080'; context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const foregroundInk = get('--zero-sankey-ink-role', 'secondary') === 'foreground';
    const neutralInk = foregroundInk
      ? get('--zero-chart-foreground', get('--foreground', '#e6e9ef'))
      : get('--zero-chart-secondary', get('--text-secondary', get('--muted-foreground', '#3f3f46')));
    // The theme chooses a semantic role, not an ancestor-computed color alias.
    // Resolve its fallback on the owned SVG paint containers so descendant theme
    // scopes remain live; explicit inherited --zero-sankey-ink wins everywhere.
    const neutralExpression = foregroundInk ? 'var(--zero-chart-foreground, var(--foreground))'
      : 'var(--zero-chart-secondary, var(--text-secondary, var(--muted-foreground)))';
    for (const svg of [this.elements.back, this.elements.front])
      if (svg.style.getPropertyValue('--zero-sankey-neutral-ink-default') !== neutralExpression)
        svg.style.setProperty('--zero-sankey-neutral-ink-default', neutralExpression);
    this.colors = { palette: CHART_FLOW_COLORS.map((name, i) => color(get(`--zero-chart-series-${i + 1}`, get(`--zero-chart-${name}`, '#888')))),
      node: color(get('--zero-sankey-node', '#a1a1aa')), ink: color(get('--zero-sankey-ink', neutralInk)),
      ribbon: numeric('--zero-sankey-ribbon-opacity', .2, 0, 1), band: numeric('--zero-sankey-trace-opacity', .46, 0, 1),
      dot: numeric('--zero-sankey-particle-radius', 1.2, .1, 8) };
    for (const key of Object.keys(SANKEY_MOTION_DEFAULTS) as Array<keyof typeof SANKEY_MOTION_DEFAULTS>) {
      const token = get(`--zero-sankey-motion-${key.replace(/[A-Z]/gu, c => '-' + c.toLowerCase())}`, SANKEY_MOTION_DEFAULTS[key] + 'ms');
      const value = Number.parseFloat(token), seconds = token.endsWith('ms') ? value / 1000 : value;
      this.durations[key] = Number.isFinite(seconds) && seconds > 0 ? seconds : SANKEY_MOTION_DEFAULTS[key] / 1000;
    }
    const family = get('--zero-chart-font-family', get('--font-platform-sans', 'system-ui'));
    this.fonts = { label: `400 ${get('--zero-sankey-label-size', get('--zero-chart-label-size', '12.5px'))} ${family}`,
      value: `500 ${get('--zero-sankey-value-size', get('--zero-chart-readout-size', '14px'))} ${family}`,
      column: `500 ${get('--zero-sankey-column-size', get('--zero-chart-metadata-size', '11.5px'))} ${family}` };
    // A font can finish loading without changing its CSS shorthand. Compare
    // actual metrics as well so cached label gutters do not retain fallback widths.
    this.fontMetrics = (['label', 'value', 'column'] as const).map(kind => `${this.fonts[kind]}:${this.measure('MWi 0123456789', kind)}`).join('|');
  }
  private measure = (text: string, kind: 'label' | 'value' | 'column') => {
    if (!this.ctx) return text.length * (kind === 'value' ? 8 : 6);
    this.ctx.font = this.fonts[kind]; return this.ctx.measureText(text).width;
  };
  /** Replace a validated model, retaining the current in-flight geometry as the next morph's start. */
  update(model: SankeyModel, options: SankeyRuntimeOptions) {
    validateSankeyPaintBudget(model, options.traceColor);
    const oldOptions = this.options; this.options = options; this.resolvePaint();
    const changed = this.model !== model || oldOptions.height !== options.height || oldOptions.orientation !== options.orientation ||
      oldOptions.columns !== options.columns || oldOptions.formatValue !== options.formatValue;
    if (changed) { this.model = model; this.relayout(true); }
    else if (this.layoutFontMetrics !== this.fontMetrics) this.relayoutPresentation();
    else if (oldOptions.traceColor !== options.traceColor) { this.build(); this.render(this.now()); }
    if (this.reduced()) this.morphStart = -1e9;
    this.render(this.now()); this.kick();
  }
  private relayout(morph: boolean) {
    const model = this.model; if (!model) return;
    const now = this.now(), previousLayout = this.layout, entering = !previousLayout || !this.started && this.morphStart === Infinity;
    const next = computeSankeyLayout(model, { width: Math.max(1, Math.round(this.elements.plot.clientWidth || 600)),
      height: this.options.height, columns: this.options.columns, orientation: this.options.orientation, measureText: this.measure,
      formatValue: this.options.formatValue });
    this.layout = next;
    this.layoutFontMetrics = this.fontMetrics;
    const oldNodes = new Map(this.nodes.filter(u => !u.removed).map(u => [u.n.id, u]));
    const oldLinks = new Map(this.links.filter(u => !u.removed).map(u => [u.l.id, u]));
    const animate = morph && (entering || previousLayout?.upright === next.upright);
    this.nodes = model.nodes.map(n => {
      const to = next.nodes.get(n.id)!, previous = oldNodes.get(n.id), from = animate ? previous?.g ?? collapseNode(to) : to;
      return { ...previous, n, from, to, g: from, delay: entering ? n.c * this.durations.stagger : 0, removed: false } as NodePaint;
    });
    this.links = model.links.map(l => {
      const to = next.links.get(l.id)!, previous = oldLinks.get(l.id), from = animate ? previous?.g ?? collapseLink(to) : to;
      return { ...previous, l, from, to, g: from, delay: entering ? l.s.c * this.durations.stagger + .08 : 0, removed: false } as LinkPaint;
    });
    if (animate && !entering) {
      for (const u of oldNodes.values()) if (!model.byId.has(u.n.id)) this.nodes.push({ ...u, from: u.g, to: collapseNode(u.g), delay: 0, removed: true });
      for (const u of oldLinks.values()) if (!model.linkBy.has(u.l.id)) this.links.push({ ...u, from: u.g, to: collapseLink(u.g), delay: 0, removed: true });
    }
    this.morphDuration = entering ? this.durations.enter : this.durations.morph;
    this.morphStart = this.reduced() || !animate ? -1e9 : entering && !this.started ? Infinity : now;
    this.particleStart = entering ? Infinity : now;
    this.size(); this.build(); this.seedParticles();
    // Data changes invalidate removed targets while valid controlled traces keep their meaning.
    const requested = this.target; this.target = null; this.traces = [null, null];
    if (requested) this.setTrace(requested);
    this.settling = true; this.render(now); this.options.onLayout?.(next); this.kick();
  }
  /** Font/theme changes retarget presentation only: keep the reveal, traces and particle phases already in flight. */
  private relayoutPresentation() {
    if (!this.model || !this.layout) return;
    const next = computeSankeyLayout(this.model, { width: Math.max(1, Math.round(this.elements.plot.clientWidth || 600)),
      height: this.options.height, columns: this.options.columns, orientation: this.options.orientation, measureText: this.measure,
      formatValue: this.options.formatValue });
    this.layout = next;
    this.layoutFontMetrics = this.fontMetrics;
    for (const paint of this.nodes) if (!paint.removed) paint.to = next.nodes.get(paint.n.id)!;
    for (const paint of this.links) if (!paint.removed) paint.to = next.links.get(paint.l.id)!;
    this.size(); this.build(); this.render(this.now()); this.options.onLayout?.(next);
  }
  private resolvePixelRatio() {
    const layout = this.layout!;
    // Pixel density adapts instead of allocating an unbounded multi-gigabyte backing store for a large editor panel.
    return Math.min(2, this.view.devicePixelRatio || 1, Math.sqrt(4_000_000 / Math.max(1, layout.W * layout.H)),
      8192 / Math.max(layout.W, layout.H));
  }
  private size() {
    const layout = this.layout!, { plot, back, front, canvas } = this.elements, dpr = this.resolvePixelRatio(); this.pixelRatio = dpr;
    if (plot.style.height !== layout.H + 'px') plot.style.height = layout.H + 'px';
    for (const svg of [back, front]) { attr(svg, 'width', layout.W); attr(svg, 'height', layout.H); attr(svg, 'viewBox', `0 0 ${layout.W} ${layout.H}`); }
    canvas.width = Math.max(1, Math.floor(layout.W * dpr)); canvas.height = Math.max(1, Math.floor(layout.H * dpr));
    canvas.style.width = layout.W + 'px'; canvas.style.height = layout.H + 'px'; this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    attr(plot, 'data-orientation', layout.upright ? 'vertical' : 'horizontal');
  }
  private element<K extends keyof SVGElementTagNameMap>(tag: K, parent: Element): SVGElementTagNameMap[K] {
    const element = this.document.createElementNS(NS, tag); parent.append(element); return element;
  }
  private build() {
    if (!this.model || !this.layout) return;
    const { back, front } = this.elements; back.replaceChildren(); front.replaceChildren();
    const ribbons = this.element('g', back), bands = this.element('g', back), hits = this.element('g', front), nodes = this.element('g', front),
      nodeHits = this.element('g', front), labels = this.element('g', front), headings = this.element('g', front);
    attr(nodes, 'pointer-events', 'none'); const count = this.options.traceColor === 'mix' ? this.model.O : 1;
    for (const u of this.links) {
      u.base ??= this.document.createElementNS(NS, 'path'); ribbons.append(u.base); u.base.style.fill = hue(sourceHue(u.l.s));
      attr(u.base, 'data-link-id', u.l.id);
      u.bands = [0, 1].map(() => Array.from({ length: count }, (_, i) => {
        const path = this.element('path', bands); path.style.fill = ink(this.model!.origins[i]?.hue ?? 0); return path;
      }));
      if (!u.removed) { u.hit ??= this.document.createElementNS(NS, 'path'); hits.append(u.hit); attr(u.hit, 'class', 'zero-sankey__hit');
        attr(u.hit, 'data-kind', 'link'); attr(u.hit, 'data-target-id', u.l.id); } else u.hit = null;
    }
    for (const u of this.nodes) {
      u.rect ??= this.document.createElementNS(NS, 'rect'); nodes.append(u.rect); attr(u.rect, 'rx', 2); u.rect.style.fill = hue(sourceHue(u.n));
      attr(u.rect, 'data-node-id', u.n.id);
      u.fills = [0, 1].map(() => Array.from({ length: count }, (_, i) => { const rect = this.element('rect', nodes);
        attr(rect, 'rx', 1.5); rect.style.fill = ink(this.model!.origins[i]?.hue ?? 0); return rect; }));
      if (!u.removed) { u.hit ??= this.document.createElementNS(NS, 'rect'); nodeHits.append(u.hit); attr(u.hit, 'class', 'zero-sankey__hit');
        attr(u.hit, 'data-kind', 'node'); attr(u.hit, 'data-target-id', u.n.id); } else u.hit = null;
      u.label ??= this.document.createElementNS(NS, 'text'); labels.append(u.label); attr(u.label, 'class', 'zero-sankey__label');
      attr(u.label, 'text-anchor', this.layout.upright ? 'middle' : 'start');
      if (!u.name) { u.name = this.element('tspan', u.label); u.value = this.element('tspan', u.label); attr(u.value, 'class', 'zero-sankey__value'); }
    }
    for (const h of this.layout.heads) { const text = this.element('text', headings); attr(text, 'class', 'zero-sankey__column');
      attr(text, 'x', h.x); attr(text, 'y', h.y); text.textContent = h.text; }
  }
  private seedParticles() {
    const layout = this.layout!, links = this.links.filter(u => !u.removed), max = links.reduce((value, u) => Math.max(value, u.l.value), 0);
    this.particles = []; if (!max) { attr(this.elements.canvas, 'data-particle-count', 0); attr(this.elements.canvas, 'data-particle-flow-count', 0); return; }
    // Repeated stages can make sum(link.value) overflow even though every node and source total are finite.
    const total = links.reduce((value, u) => value + u.l.value / max, 0);
    const count = clamp(Math.round(layout.W * layout.H / 2600), 36, 130);
    let seed = 7; const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    // A hard global cap remains true even when a dataset has more links than dots.
    for (let i = 0; i < count; i++) {
      let pick = ((i + .5) / count) * total, chosen = links[links.length - 1]!;
      for (const u of links) { pick -= u.l.value / max; if (pick <= 0) { chosen = u; break; } }
      this.particles.push({ u: chosen, t: random(), f: .08 + random() * .84, speed: .8 + random() * .4 });
    }
    attr(this.elements.canvas, 'data-particle-count', this.particles.length);
    attr(this.elements.canvas, 'data-particle-flow-count', new Set(this.particles.map(p => p.u.l.id)).size);
  }
  /** Paint a trace without inventing per-person paths; the model uses documented proportional mixing. */
  setTrace(target: SankeyTraceTarget | null) {
    if (target?.kind === this.target?.kind && target?.id === this.target?.id) return;
    this.target = target; const now = this.now(), old = this.traces[this.slot]; if (old && !old.fadeAt) old.fadeAt = now;
    if (target && this.model) { const trace = computeSankeyTrace(this.model, target); if (trace) { this.slot = 1 - this.slot; this.traces[this.slot] = { trace, started: now }; } }
    this.settling = true; this.render(now); this.kick();
  }
  /** Return a keyboard/touch inspection anchor in chart-local pixels. */
  anchor(target: SankeyTraceTarget): readonly [number, number] {
    if (!this.layout) return [0, 0];
    if (target.kind === 'node') { const u = this.nodes.find(u => !u.removed && u.n.id === target.id); return u ? this.layout.P(u.g.a1, (u.g.c0 + u.g.c1) / 2) : [0, 0]; }
    const u = this.links.find(u => !u.removed && u.l.id === target.id); if (!u) return [0, 0];
    const [top] = ribbonCurves(u.g), p = cubicPoint(top, .5); return this.layout.P(p[0], p[1] + u.g.w / 2);
  }
  get currentLayout() { return this.layout; }
  private rect(element: SVGRectElement, g: SankeyNodeGeometry, c0: number, c1: number) {
    const [x0, y0] = this.layout!.P(g.a0, c0), [x1, y1] = this.layout!.P(g.a1, c1);
    attr(element, 'x', x0); attr(element, 'y', y0); attr(element, 'width', Math.max(0, x1 - x0)); attr(element, 'height', Math.max(0, y1 - y0));
  }
  private truncate(text: string, width: number, kind: 'label' | 'value') {
    if (this.measure(text, kind) <= width) return text;
    let lo = 0, hi = text.length; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.measure(text.slice(0, mid) + '…', kind) <= width) lo = mid; else hi = mid - 1; }
    return lo ? text.slice(0, lo).trimEnd() + '…' : '';
  }
  private render(now: number, dt = 0) {
    if (!this.layout || !this.model || this.destroyed) return;
    const layout = this.layout, reduced = this.reduced(), active = this.traces[this.slot], targetDim = active && !active.fadeAt ? 1 : 0;
    this.dim = reduced ? targetDim : this.dim + (targetDim - this.dim) * (1 - Math.exp(-dt * 16));
    if (Math.abs(this.dim - targetDim) < .002) this.dim = targetDim;
    let settling = Math.abs(this.dim - targetDim) > .002;
    for (const u of this.nodes) {
      const progress = reduced ? 1 : this.morphStart === Infinity ? 0 : easeInOut(segment(now, this.morphStart + u.delay, this.morphStart + u.delay + this.morphDuration));
      if (progress < 1) settling = true; u.g = progress === 1 ? u.to : mixNode(u.from, u.to, progress);
      this.rect(u.rect, u.g, u.g.c0, u.g.c1);
      if (u.hit) {
        this.rect(u.hit, u.g, u.g.c0, u.g.c1); const pad = 4;
        const x = Number(u.hit.getAttribute('x')), y = Number(u.hit.getAttribute('y')), w = Number(u.hit.getAttribute('width')), h = Number(u.hit.getAttribute('height'));
        attr(u.hit, 'x', Math.max(0, x - pad)); attr(u.hit, 'y', Math.max(0, y - pad));
        attr(u.hit, 'width', layout.upright ? Math.max(w, 6) + pad * 2 : Math.min(layout.W - x + pad, w + pad * 2 + 7 + Math.max(this.measure(u.n.label, 'label'), this.measure(this.options.formatValue(u.n.value), 'value'))));
        if (layout.upright) attr(u.hit, 'height', h + pad * 2 + 30);
        else {
          const labelY = layout.P(u.g.la, u.g.lc)[1], top = Math.max(0, Math.min(y, labelY - (u.g.two ? 14 : 10)) - pad);
          const bottom = Math.max(y + h, labelY + (u.g.two ? 18 : 6)) + pad;
          attr(u.hit, 'y', top); attr(u.hit, 'height', Math.max(0, bottom - top));
        }
      }
    }
    for (const u of this.links) {
      const progress = reduced ? 1 : this.morphStart === Infinity ? 0 : easeInOut(segment(now, this.morphStart + u.delay, this.morphStart + u.delay + this.morphDuration));
      if (progress < 1) settling = true; u.g = progress === 1 ? u.to : mixLink(u.from, u.to, progress);
      const path = ribbonPath(u.g, layout.P); attr(u.base, 'd', path); if (u.hit) attr(u.hit, 'd', path);
      attr(u.base, 'fill-opacity', this.colors.ribbon * (1 - .4 * this.dim) * (u.removed ? 1 - segment(now, this.morphStart, this.morphStart + this.morphDuration) : 1)
        * (reduced ? 1 : this.morphStart === Infinity ? 0 : segment(now, this.morphStart + u.delay, this.morphStart + u.delay + .3)));
    }
    for (const [slot, painted] of this.traces.entries()) {
      const trace = painted?.trace, fade = !painted ? 0 : painted.fadeAt ? reduced ? 0 : 1 - segment(now, painted.fadeAt, painted.fadeAt + this.durations.fade) : 1;
      if (painted?.fadeAt && fade <= 0) this.traces[slot as 0 | 1] = null;
      if (fade > 0 && fade < 1) settling = true;
      for (const u of this.links) {
        const entry = trace && fade ? trace.links.get(u.l.id) : null, bands = u.bands[slot]!;
        if (!entry) { for (const band of bands) attr(band, 'opacity', 0); continue; }
        const progress = reduced ? 1 : easeInOut(segment(now, painted!.started + entry.d * this.durations.traceStep,
          painted!.started + entry.d * this.durations.traceStep + this.durations.pour));
        if (progress < 1) settling = true;
        const share = clamp(entry.amt / u.l.value), start = entry.dir === 'up' ? 1 - progress : entry.dir === 'self' ? .5 - progress / 2 : 0,
          end = entry.dir === 'up' ? 1 : entry.dir === 'self' ? .5 + progress / 2 : progress;
        if (this.options.traceColor === 'mix') {
          let position = 0; const total = entry.comp.reduce((a, b) => a + b, 0) || 1;
          for (const [i, band] of bands.entries()) { const width = share * (entry.comp[i] ?? 0) / total;
            attr(band, 'd', ribbonPath(u.g, layout.P, position, position + width, start, end)); attr(band, 'opacity', width > .0001 ? this.colors.band * 1.6 * fade : 0); position += width; }
        } else { const band = bands[0]!; band.style.fill = ink(trace!.hue); attr(band, 'd', ribbonPath(u.g, layout.P, 0, share, start, end)); attr(band, 'opacity', this.colors.band * fade); }
      }
      for (const u of this.nodes) {
        const entry = trace && fade ? trace.nodes.get(u.n.id) : null, fills = u.fills[slot]!;
        if (!entry) { for (const fill of fills) attr(fill, 'opacity', 0); continue; }
        const start = painted!.started + (entry.self ? 0 : entry.d * this.durations.traceStep + this.durations.pour * .35),
          end = painted!.started + (entry.self ? .25 : entry.d * this.durations.traceStep + this.durations.pour * .9);
        const progress = reduced ? 1 : easeOut(segment(now, start, end)); if (progress < 1) settling = true;
        const height = (u.g.c1 - u.g.c0) * clamp(entry.amt / u.n.value) * progress;
        if (this.options.traceColor === 'mix') { let position = u.g.c0; const total = entry.comp.reduce((a, b) => a + b, 0) || 1;
          for (const [i, fill] of fills.entries()) { const width = height * (entry.comp[i] ?? 0) / total; this.rect(fill, u.g, position, position + width); attr(fill, 'opacity', width > .02 ? fade : 0); position += width; }
        } else { const fill = fills[0]!; fill.style.fill = ink(trace!.hue); this.rect(fill, u.g, u.g.c0, u.g.c0 + height); attr(fill, 'opacity', fade); }
      }
    }
    for (const u of this.nodes) {
      const remove = u.removed ? 1 - segment(now, this.morphStart, this.morphStart + this.morphDuration * .6) : 1,
        show = reduced ? 1 : this.morphStart === Infinity ? 0 : segment(now, this.morphStart + u.delay + .2, this.morphStart + u.delay + .6);
      attr(u.rect, 'opacity', (1 - .6 * this.dim) * remove); attr(u.label, 'opacity', show * remove);
      const [x, y] = layout.P(u.g.la, u.g.lc), value = this.options.formatValue(u.n.value); attr(u.label, 'x', x);
      if (layout.upright) { attr(u.label, 'y', y); attr(u.value, 'x', x); attr(u.value, 'dy', 16);
        u.name.textContent = this.truncate(u.n.label, u.g.lw ?? 80, 'label'); u.value.textContent = this.truncate(value, u.g.lw ?? 80, 'value');
      } else {
        const available = Math.max(0, layout.W - x - 2), valueWidth = Math.min(available, this.measure(value, 'value'));
        const name = this.truncate(u.n.label, u.g.two ? available : Math.max(0, available - valueWidth - 6), 'label');
        const valueX = u.g.two ? x : x + (name ? this.measure(name, 'label') + 6 : 0);
        u.name.textContent = name; u.value.textContent = this.truncate(value, Math.max(0, layout.W - valueX - 2), 'value');
        attr(u.label, 'y', y + (u.g.two ? -3 : 4)); attr(u.value, 'x', valueX); attr(u.value, 'dy', u.g.two ? 16 : 0);
      }
    }
    this.paintParticles(now, dt, active && !active.fadeAt ? active.trace : null);
    if (this.options.particles !== false && !reduced && this.particles.length > 0 && this.particleStart !== Infinity && now < this.particleStart + .8) settling = true;
    if (!settling && this.morphStart !== Infinity && (this.nodes.some(u => u.removed) || this.links.some(u => u.removed))) {
      this.nodes = this.nodes.filter(u => !u.removed); this.links = this.links.filter(u => !u.removed); this.build(); this.seedParticles();
      this.settling = true; this.render(now); return;
    }
    this.settling = settling;
    attr(this.elements.plot, 'data-settling', String(settling));
  }
  private paintParticles(now: number, dt: number, trace: SankeyTrace | null) {
    const ctx = this.ctx, layout = this.layout!; if (!ctx) return; ctx.clearRect(0, 0, layout.W, layout.H);
    if (this.options.particles === false || this.reduced() || this.morphStart === Infinity || !this.particles.length) return;
    if (this.particleStart === Infinity) this.particleStart = this.morphStart + this.durations.stagger * (this.model!.ncol - 1) + .5;
    const entrance = segment(now, this.particleStart, this.particleStart + .8), speed = 40 * Math.max(0, this.options.particleSpeed ?? 1);
    const lengths = new Map<LinkPaint, number>();
    for (const u of this.links) { const [curve] = ribbonCurves(u.g); let length = 0, previous = layout.P(...cubicPoint(curve, 0));
      for (let i = 1; i <= 6; i++) { const next = layout.P(...cubicPoint(curve, i / 6)); length += Math.hypot(next[0] - previous[0], next[1] - previous[1]); previous = next; } lengths.set(u, Math.max(20, length)); }
    for (const p of this.particles) {
      if (p.u.g.w < .5) continue; p.t = (p.t + dt * speed * p.speed / lengths.get(p.u)!) % 1;
      const [top, bottom] = ribbonCurves(p.u.g), a = cubicPoint(top, p.t), b = cubicPoint(bottom, p.t), [x, y] = layout.P(lerp(a[0], b[0], p.f), lerp(a[1], b[1], p.f));
      let alpha = .6 * entrance * Math.min(1, p.t / .06, (1 - p.t) / .06), color = sourceHue(p.u.l.s) ? this.colors.palette[sourceHue(p.u.l.s) - 1]! : this.colors.node;
      const entry = trace?.links.get(p.u.l.id);
      if (this.dim > 0) {
        if (entry && p.f <= clamp(entry.amt / p.u.l.value)) {
          if (this.options.traceColor === 'mix') { const sum = entry.comp.reduce((a, b) => a + b, 0) || 1, share = clamp(entry.amt / p.u.l.value);
            let position = 0; for (let i = 0; i < entry.comp.length; i++) { position += share * entry.comp[i]! / sum; if (p.f <= position) {
              const source = this.model!.origins[i]?.hue ?? 0; color = source ? this.colors.palette[source - 1]! : this.colors.ink; break; } }
          } else color = trace!.hue ? this.colors.palette[trace!.hue - 1]! : this.colors.ink;
          alpha = Math.min(1, alpha * (1 + .5 * this.dim));
        } else alpha *= 1 - .65 * this.dim;
      }
      if (alpha <= .01) continue; ctx.globalAlpha = alpha; ctx.fillStyle = rgb(color); ctx.beginPath(); ctx.arc(x, y, this.colors.dot, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  private needsFrame() { return !this.destroyed && this.visible && !this.document.hidden && !!this.model &&
    (this.settling || this.options.particles !== false && !this.reduced() && this.particles.length > 0 && (this.options.particleSpeed ?? 1) > 0); }
  private frame = (milliseconds: number) => {
    this.raf = 0; const now = milliseconds / 1000, dt = Math.min(.05, this.last ? now - this.last : 0); this.last = now;
    this.render(now, dt); if (this.needsFrame()) this.raf = this.view.requestAnimationFrame(this.frame); else { this.last = 0; attr(this.elements.plot, 'data-running', 'false'); }
  };
  private kick() { if (!this.raf && this.needsFrame()) { this.raf = this.view.requestAnimationFrame(this.frame); attr(this.elements.plot, 'data-running', 'true'); } }
  private stop() { this.view.cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; attr(this.elements.plot, 'data-running', 'false'); }
  destroy() {
    if (this.destroyed) return; this.destroyed = true; this.stop(); this.resize.disconnect(); this.intersection.disconnect(); this.releaseTheme();
    this.document.removeEventListener('visibilitychange', this.visibility); this.reduce.removeEventListener('change', this.motionChanged);
    this.document.fonts?.removeEventListener('loadingdone', this.repaintTheme);
    this.elements.back.replaceChildren(); this.elements.front.replaceChildren(); this.ctx?.clearRect(0, 0, this.layout?.W ?? 0, this.layout?.H ?? 0);
  }
}
