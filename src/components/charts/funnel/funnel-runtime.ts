/** Owns Funnel's browser paint clock, SVG/canvas geometry and observer lifecycle. Consumes validated aggregates only; no transport or event attribution. */
import { computeFunnelSnapshot, normalizeFunnelView } from './funnel-model';
import { computeFunnelLayout, computeFunnelTargets } from './funnel-layout';
import { computeFunnelEdges, funnelBandPath, funnelEdgeAt } from './funnel-geometry';
import { sampleFunnelParticle } from './funnel-particles';
import { advanceFunnelSpring, funnelPercent, FUNNEL_MOTION_DEFAULTS } from './funnel-math';
import type { FunnelModel, FunnelLayout, FunnelView } from './funnel-types';
import { observePresentationTheme } from '../../../lib/observe-presentation-theme';

interface Spring { x: number; v: number; }
interface StepPaint { label: HTMLDivElement; value: HTMLDivElement; rate: HTMLDivElement; el: HTMLDivElement; number: Spring; }
interface SegmentPaint { base: SVGPathElement; accent: SVGPathElement; color: number[] | null; }
interface Dot { segmentIndex: number; segmentId: string | null; leaveStage: number; lane: number; speed: number; along: number; fall: { age: number; cross: number; velocity: number } | null; }
export interface FunnelRuntimeOptions {
  height: number; orientation: 'auto' | 'horizontal' | 'vertical'; view: FunnelView; flow: boolean; activeStageId: string | null;
  motion: boolean; formatCompact: (value: number) => string; period: string;
  onPaint: (layout: FunnelLayout, anchor: readonly [number, number] | null, conversion: number | null) => void;
}
export interface FunnelRuntimeElements {
  figure: HTMLElement; plot: HTMLElement; steps: HTMLElement; drops: HTMLElement; svg: SVGSVGElement;
  bands: SVGGElement; accents: SVGGElement; clip: SVGRectElement; canvas: HTMLCanvasElement; column: HTMLElement; subtitle: HTMLElement;
}
const NS = 'http://www.w3.org/2000/svg';
const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));
const round = (value: number) => Math.round(value * 10) / 10;
const style = (element: HTMLElement, key: string, value: string) => { if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value); };
const attribute = (element: Element, key: string, value: string | number) => { if (element.getAttribute(key) !== String(value)) element.setAttribute(key, String(value)); };
const text = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };
const percent = funnelPercent;
/** Reduced/static presentation settles immediately; numeric labels use the pure helper's relative finite-count policy. */
function advance(state: Spring, target: number, frequency: number, dt: number, instant: boolean, tolerance = .01) {
  if (instant) { state.x = target; state.v = 0; return false; }
  return advanceFunnelSpring(state, target, frequency, dt, { tolerance, relative: tolerance === 1e-9 });
}
function parseColor(context: CanvasRenderingContext2D | null, value: string): number[] {
  if (!context) return [128, 128, 128]; context.fillStyle = '#808080'; context.fillStyle = value;
  // Browser color parsing/readback resolves oklch, lab and display-p3 into actual sRGB paint values.
  context.clearRect(0, 0, 1, 1); context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
}
const rgb = (color: readonly number[]) => `rgb(${color.map(value => Math.round(value)).join(',')})`;

/** Mounted by React; stable stage/segment IDs retarget from the painted thicknesses and count velocities. */
export class FunnelPaintRuntime {
  private model: FunnelModel | null = null;
  private layout: FunnelLayout | null = null;
  private options: FunnelRuntimeOptions;
  private heights = new Map<string, Map<string, Spring>>();
  private steps = new Map<string, StepPaint>();
  private segments = new Map<string, SegmentPaint>();
  private drops: HTMLDivElement[] = [];
  private gap: Spring = { x: 0, v: 0 };
  private grow: Spring = { x: 0, v: 0 };
  private column = { position: { x: 0, v: 0 }, opacity: { x: 0, v: 0 } };
  private dots: Dot[] = [];
  private seed = 3;
  private onScreen = false;
  private started = false;
  private reduced = false;
  private destroyed = false;
  private raf = 0;
  private last = 0;
  private width = 0;
  private pixelRatio = 0;
  private colors = { surface: [255, 255, 255], foreground: [24, 24, 27], series: [[42, 120, 214], [235, 104, 52], [27, 175, 122], [237, 161, 0]], tint: .28 };
  private readonly context: CanvasRenderingContext2D | null;
  private readonly colorContext: CanvasRenderingContext2D | null;
  private readonly probe: HTMLDivElement;
  private readonly reducedMQ: MediaQueryList;
  private readonly resize: ResizeObserver;
  private readonly intersection: IntersectionObserver;
  private readonly releaseTheme: () => void;
  private readonly document: Document;
  private readonly view: Window;

  constructor(private readonly elements: FunnelRuntimeElements, options: FunnelRuntimeOptions) {
    this.options = options; this.document = elements.figure.ownerDocument; this.view = this.document.defaultView!;
    this.context = elements.canvas.getContext('2d'); const colorCanvas = this.document.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
    this.colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    this.probe = this.document.createElement('div'); this.probe.className = 'zero-funnel__probe'; this.probe.setAttribute('aria-hidden', 'true');
    for (const value of ['var(--zero-chart-surface, var(--card))', 'var(--zero-chart-foreground, var(--foreground))', ...['blue', 'orange', 'green', 'amber'].map((color, index) => `var(--zero-funnel-series-${index + 1}, var(--zero-chart-${color}))`)]) {
      const item = this.document.createElement('i'); item.style.color = value; this.probe.append(item);
    }
    elements.figure.append(this.probe);
    this.reducedMQ = this.view.matchMedia('(prefers-reduced-motion: reduce)'); this.reduced = this.reducedMQ.matches;
    this.reducedMQ.addEventListener('change', this.onReduced);
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.resize = new ResizeObserver(() => { if (this.destroyed) return; const width = Math.round(elements.plot.clientWidth);
      if (width !== this.width) { this.relayout(); this.paint(0); this.kick(); } }); this.resize.observe(elements.plot);
    this.intersection = new IntersectionObserver(entries => { if (this.destroyed) return; this.onScreen = !!entries[0]?.isIntersecting; this.last = 0;
      if (this.onScreen) this.started = true; else this.stop(); this.paint(0); this.kick(); }, { threshold: .2 }); this.intersection.observe(elements.plot);
    const externalClasses = (value: string | null) => (value ?? '').split(/\s+/).filter(name => name && name !== 'reading' && name !== 'vertical').sort().join(' ');
    this.releaseTheme = observePresentationTheme(elements.figure, this.onTheme, { ignoreMutation: record => record.target === elements.figure
      && record.attributeName === 'class' && externalClasses(record.oldValue) === externalClasses(elements.figure.className) });
    // Funnel's layout is independent of font metrics. Font changes update its
    // native labels without discarding the particles or retargeting its springs.
    this.document.fonts?.addEventListener('loadingdone', this.onTheme);
    void this.document.fonts?.ready.then(this.onTheme);
  }

  private get instant() { return this.reduced || !this.options.motion; }
  private random = () => (this.seed = (this.seed * 16807) % 2147483647) / 2147483647;
  get currentLayout() { return this.layout; }

  /** Replace aggregates without remounting surviving stage headings or resetting their displayed geometry. */
  update(model: FunnelModel, options: FunnelRuntimeOptions) {
    if (this.destroyed) return;
    const previous = this.model, oldOptions = this.options;
    this.model = model; this.options = options;
    if (previous !== model) {
      const ids = new Set(model.stages.map(stage => stage.id)), segmentIds = new Set(model.segments.length ? model.segments.map(segment => segment.id) : ['__aggregate']);
      for (const [id, step] of this.steps) if (!ids.has(id)) { step.el.remove(); this.steps.delete(id); this.heights.delete(id); }
      for (const stage of model.stages) {
        let step = this.steps.get(stage.id);
        if (!step) {
          const el = this.document.createElement('div'), wrap = this.document.createElement('div'), label = this.document.createElement('div'), value = this.document.createElement('div'), rate = this.document.createElement('div');
          el.className = 'zero-funnel__step'; el.dataset.stageId = stage.id; wrap.className = 'zero-funnel__label-wrap'; label.className = 'zero-funnel__label';
          value.className = 'zero-funnel__value'; rate.className = 'zero-funnel__rate'; wrap.append(label); el.append(wrap, value, rate); this.elements.steps.append(el);
          const initial = computeFunnelSnapshot(model, options.view).values[stage.index]?.value ?? 0;
          step = { el, label, value, rate, number: { x: initial, v: 0 } }; this.steps.set(stage.id, step);
        }
        text(step.label, stage.label); this.elements.steps.append(step.el);
        let heights = this.heights.get(stage.id); if (!heights) { heights = new Map(); this.heights.set(stage.id, heights); }
        for (const id of heights.keys()) if (!segmentIds.has(id)) heights.delete(id);
        for (const id of segmentIds) if (!heights.has(id)) heights.set(id, { x: 0, v: 0 });
      }
      for (const [id, paint] of this.segments) if (!segmentIds.has(id)) { paint.base.remove(); paint.accent.remove(); this.segments.delete(id); }
      for (const id of segmentIds) {
        let paint = this.segments.get(id);
        if (!paint) { const base = this.document.createElementNS(NS, 'path'), accent = this.document.createElementNS(NS, 'path'); this.elements.bands.append(base); this.elements.accents.append(accent);
          paint = { base, accent, color: null }; this.segments.set(id, paint); }
        paint.base.dataset.segmentId = id; this.elements.bands.append(paint.base); this.elements.accents.append(paint.accent);
      }
      this.elements.drops.replaceChildren(); this.drops = model.stages.slice(1).map(() => { const el = this.document.createElement('div'); el.className = 'zero-funnel__drop'; this.elements.drops.append(el); return el; });
      this.dots = [];
      if (model.stages.length === 0 || model.stages[0]!.total === 0) { this.grow = { x: this.instant ? 1 : 0, v: 0 }; this.column.opacity = { x: 0, v: 0 }; this.stop(); }
    }
    if (oldOptions.view.kind !== options.view.kind || (oldOptions.view.kind === 'segment' && options.view.kind === 'segment' && oldOptions.view.id !== options.view.id) || !options.flow) this.dots = [];
    if (computeFunnelSnapshot(model, options.view).baseline === 0) {
      // An absent cohort must not strand old rolling counts after its presentation clock is stopped.
      for (const step of this.steps.values()) step.number = { x: 0, v: 0 };
      for (const row of this.heights.values()) for (const state of row.values()) { state.x = 0; state.v = 0; }
      this.grow = { x: 0, v: 0 }; this.gap = { x: 0, v: 0 }; this.column.opacity = { x: 0, v: 0 }; this.dots = []; this.stop();
    }
    if (previous !== model || oldOptions.height !== options.height || oldOptions.orientation !== options.orientation || !this.layout) this.relayout();
    this.paint(0); this.kick();
  }

  private resolveColors() {
    const read = (index: number) => parseColor(this.colorContext, this.view.getComputedStyle(this.probe.children[index]!).color);
    const tint = Number.parseFloat(this.view.getComputedStyle(this.elements.figure).getPropertyValue('--zero-funnel-tint'));
    this.colors = { surface: read(0), foreground: read(1), series: [read(2), read(3), read(4), read(5)], tint: Number.isFinite(tint) ? clamp(tint) : .28 };
  }
  private relayout() {
    if (!this.model) return;
    const old = this.layout; this.width = Math.max(0, Math.min(16384, Math.round(this.elements.plot.clientWidth)));
    this.layout = computeFunnelLayout(this.model.stageCount, { width: this.width, orientation: this.options.orientation, height: this.options.height });
    const layout = this.layout; this.elements.figure.classList.toggle('vertical', layout.vertical); this.elements.plot.dataset.orientation = layout.vertical ? 'vertical' : 'horizontal';
    style(this.elements.plot, 'height', layout.height + 'px');
    attribute(this.elements.svg, 'width', layout.width); attribute(this.elements.svg, 'height', layout.height); attribute(this.elements.svg, 'viewBox', `0 0 ${layout.width} ${layout.height}`);
    this.sizeCanvas();
    if (old && old.cross > 0 && layout.cross !== old.cross) for (const heights of this.heights.values()) for (const state of heights.values()) { state.x *= layout.cross / old.cross; state.v *= layout.cross / old.cross; }
    for (const stage of this.model.stages) {
      const step = this.steps.get(stage.id)!;
      style(step.el, 'left', (layout.vertical ? layout.cross + layout.labelGap : stage.index * layout.stepSize) + 'px');
      style(step.el, 'width', (layout.vertical ? layout.labelWidth : layout.stepSize) + 'px');
      style(step.el, 'top', (layout.vertical ? stage.index * layout.stepSize + layout.stepSize / 2 - 30 : 0) + 'px');
    }
    for (let index = 0; index < this.drops.length; index++) { const el = this.drops[index]!, boundary = (index + 1) * layout.stepSize;
      style(el, 'left', (layout.vertical ? layout.cross + layout.labelGap : boundary) + 'px'); style(el, 'top', (layout.vertical ? boundary - 8 : layout.headerHeight + layout.cross + 4) + 'px');
      style(el, 'transform', layout.vertical ? 'none' : 'translateX(-50%)'); }
    style(this.elements.column, 'width', (layout.vertical ? layout.width : layout.stepSize) + 'px'); style(this.elements.column, 'height', (layout.vertical ? layout.stepSize : layout.height) + 'px');
    this.resolveColors(); this.dots = [];
  }
  /** Refresh the backing store after a monitor/viewport density change without resetting particle or thickness state. */
  private sizeCanvas() {
    const layout = this.layout; if (!layout) return;
    const dpr = Math.min(2, this.view.devicePixelRatio || 1); this.pixelRatio = dpr;
    this.elements.canvas.width = Math.round(layout.width * dpr); this.elements.canvas.height = Math.round(layout.height * dpr);
    style(this.elements.canvas, 'width', layout.width + 'px'); style(this.elements.canvas, 'height', layout.height + 'px'); this.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private paint(dt: number) {
    if (this.destroyed || !this.model || !this.layout) return false;
    const model = this.model, layout = this.layout, view = normalizeFunnelView(model, this.options.view), snapshot = computeFunnelSnapshot(model, view);
    const hasData = snapshot.baseline > 0, instant = this.instant || !hasData;
    const targets = computeFunnelTargets(model, layout, view), segmentIds = model.segments.length ? model.segments.map(segment => segment.id) : ['__aggregate'];
    let moving = false;
    const thicknesses = model.stages.map((stage, index) => segmentIds.map((id, segmentIndex) => { const state = this.heights.get(stage.id)!.get(id)!;
      moving = advance(state, targets[index]![segmentIndex]!, FUNNEL_MOTION_DEFAULTS.thickness, dt, instant) || moving; return state.x; }));
    moving = advance(this.gap, hasData && view.kind === 'split' && segmentIds.length > 1 ? 2 : 0, FUNNEL_MOTION_DEFAULTS.gap, dt, instant) || moving;
    if (this.started || instant) moving = advance(this.grow, hasData ? 1 : 0, FUNNEL_MOTION_DEFAULTS.growth, dt, instant) || moving;
    const edges = computeFunnelEdges(thicknesses, layout.cross, Math.max(0, this.gap.x), clamp(this.grow.x));
    for (let index = 0; index < segmentIds.length; index++) {
      const paint = this.segments.get(segmentIds[index]!)!;
      const own = this.colors.series[(model.segments[index]?.series ?? 1) - 1]!;
      const desired = view.kind === 'split' || (view.kind === 'segment' && view.id === segmentIds[index]) ? own : this.colors.series[0]!;
      if (!paint.color || instant) paint.color = [...desired]; else { const blend = 1 - Math.exp(-dt * FUNNEL_MOTION_DEFAULTS.color);
        paint.color = paint.color.map((value, channel) => value + (desired[channel]! - value) * blend);
        if (paint.color.some((value, channel) => Math.abs(value - desired[channel]!) > .5)) moving = true; }
      const color = rgb(this.colors.surface.map((value, channel) => value + (paint.color![channel]! - value) * this.colors.tint));
      const path = hasData ? funnelBandPath(edges[index]!, layout) : 'M0,0';
      attribute(paint.base, 'd', path); attribute(paint.base, 'fill', color); attribute(paint.base, 'stroke', color); attribute(paint.base, 'stroke-width', Math.max(0, .9 * (1 - this.gap.x / 2)));
      attribute(paint.accent, 'd', path); attribute(paint.accent, 'fill', rgb(paint.color));
    }
    const active = this.options.activeStageId !== null ? model.stageById.get(this.options.activeStageId) : null;
    moving = advance(this.column.opacity, active && hasData ? 1 : 0, FUNNEL_MOTION_DEFAULTS.columnOpacity, dt, instant) || moving;
    if (active) { const target = active.index * layout.stepSize; if (this.column.opacity.x < .05 || instant) { this.column.position.x = target; this.column.position.v = 0; }
      else moving = advance(this.column.position, target, FUNNEL_MOTION_DEFAULTS.column, dt, instant) || moving; }
    style(this.elements.column, 'opacity', String(round(clamp(this.column.opacity.x) * 10) / 10));
    style(this.elements.column, 'transform', layout.vertical ? `translateY(${round(this.column.position.x)}px)` : `translateX(${round(this.column.position.x)}px)`);
    attribute(this.elements.clip, 'x', layout.vertical ? 0 : round(this.column.position.x)); attribute(this.elements.clip, 'y', layout.vertical ? round(this.column.position.x) : layout.headerHeight);
    attribute(this.elements.clip, 'width', layout.vertical ? layout.cross : layout.stepSize); attribute(this.elements.clip, 'height', layout.vertical ? layout.stepSize : layout.cross);
    for (const paint of this.segments.values()) attribute(paint.accent, 'opacity', clamp(this.column.opacity.x));
    this.elements.figure.classList.toggle('reading', !!active && hasData);
    for (const row of snapshot.values) { const step = this.steps.get(row.stage.id)!; moving = advance(step.number, row.value, FUNNEL_MOTION_DEFAULTS.count, dt, instant, 1e-9) || moving;
      if (step.number.x < 0) { step.number.x = 0; if (step.number.v < 0) step.number.v = 0; }
      const displayedBaseline = model.stages[0] ? this.steps.get(model.stages[0].id)!.number.x : 0;
      text(step.value, this.options.formatCompact(step.number.x)); text(step.rate, row.stage.index === 0 ? 'Start' : `${percent(displayedBaseline > 0 ? clamp(step.number.x / displayedBaseline) : null)} of start`);
      step.el.classList.toggle('on', active?.id === row.stage.id); step.el.dataset.value = String(step.number.x);
    }
    for (let index = 0; index < this.drops.length; index++) text(this.drops[index]!, `↓${percent(snapshot.values[index + 1]?.dropOff ?? null)}`);
    const last = snapshot.values.at(-1), displayedLast = last ? this.steps.get(last.stage.id)?.number.x ?? last.value : 0;
    const displayedBaseline = model.stages[0] ? this.steps.get(model.stages[0].id)!.number.x : 0;
    const conversion = displayedBaseline > 0 ? clamp(displayedLast / displayedBaseline) : null;
    text(this.elements.subtitle, `${this.options.period ? this.options.period + ', ' : ''}${percent(conversion)} convert`);
    moving = this.drawDots(dt, edges) || moving;
    const anchor = active && hasData && layout.width > 0 ? layout.vertical ? [layout.cross / 2, this.column.position.x + layout.stepSize] as const : [this.column.position.x + layout.stepSize, layout.headerHeight + layout.cross / 2] as const : null;
    this.elements.plot.dataset.settling = String(moving); this.elements.plot.dataset.flow = String(this.options.flow && !this.instant && this.started && hasData);
    this.elements.plot.dataset.particles = String(this.dots.length); this.elements.plot.dataset.growth = String(this.grow.x);
    this.options.onPaint(layout, anchor, conversion);
    return moving;
  }

  private spawn(along: number): Dot | null {
    if (!this.model) return null; const sample = sampleFunnelParticle(this.model, this.options.view, this.random);
    return sample ? { ...sample, along, fall: null } : null;
  }
  private drawDots(dt: number, edges: readonly { top: readonly number[]; bottom: readonly number[] }[]) {
    const context = this.context, layout = this.layout!, model = this.model!; context?.clearRect(0, 0, layout.width, layout.height);
    if (!context || !this.options.flow || this.instant || !this.started || this.grow.x < .6 || model.stageCount === 0 || model.stages[0]!.total <= 0) return false;
    if (this.dots.length === 0) for (let index = 0; index < FUNNEL_MOTION_DEFAULTS.particleCount; index++) { const dot = this.spawn(0); if (dot) { dot.along = this.random() * Math.min(layout.along, (dot.leaveStage + 1) * layout.stepSize - layout.transitionZone); this.dots.push(dot); } }
    if (this.dots.length < FUNNEL_MOTION_DEFAULTS.particleCount && this.random() < .5) { const dot = this.spawn(-4); if (dot) this.dots.push(dot); }
    const speed = layout.along / FUNNEL_MOTION_DEFAULTS.flowSeconds; context.fillStyle = rgb(this.colors.foreground);
    this.dots = this.dots.filter(dot => {
      const edge = edges[dot.segmentIndex]; if (!edge) return false;
      if (this.options.view.kind === 'segment' && dot.segmentId !== this.options.view.id) return false;
      if (dot.fall) { dot.fall.age += dt; dot.along += speed * .25 * dot.speed * dt; dot.fall.cross += dot.fall.velocity * dt; dot.fall.velocity += 260 * dt;
        const alpha = .75 * (1 - dot.fall.age / .9); if (alpha <= 0) return false;
        const [x, y] = layout.mapPoint(dot.along, dot.fall.cross); context.globalAlpha = alpha; context.beginPath(); context.arc(x, y, FUNNEL_MOTION_DEFAULTS.particleRadius, 0, Math.PI * 2); context.fill(); return true; }
      dot.along += speed * dot.speed * dt;
      const top = funnelEdgeAt(edge.top, clamp(dot.along, layout.along), layout), bottom = funnelEdgeAt(edge.bottom, clamp(dot.along, layout.along), layout), cross = top + (bottom - top) * dot.lane;
      if (dot.leaveStage < model.stageCount && dot.along >= (dot.leaveStage + 1) * layout.stepSize - layout.transitionZone * .4) dot.fall = { age: 0, cross, velocity: 18 + this.random() * 30 };
      if (dot.along > layout.along + 4) return false;
      const [x, y] = layout.mapPoint(dot.along, cross); context.globalAlpha = .75 * clamp(Math.min(1, (dot.along + 4) / 30, (layout.along - dot.along) / 24));
      context.beginPath(); context.arc(x, y, FUNNEL_MOTION_DEFAULTS.particleRadius, 0, Math.PI * 2); context.fill(); return true;
    }).slice(0, FUNNEL_MOTION_DEFAULTS.particleCount);
    context.globalAlpha = 1; return this.dots.length > 0;
  }
  private needs() { return !this.destroyed && this.onScreen && !this.document.hidden && (this.layout?.width ?? 0) > 0 && this.model !== null && this.model.stageCount > 0 &&
    computeFunnelSnapshot(this.model, this.options.view).baseline > 0; }
  private frame = (now: number) => { this.raf = 0; const dt = Math.min(.05, this.last ? (now - this.last) / 1000 : 0); this.last = now;
    const moving = this.paint(dt); if (this.destroyed) return;
    if (this.needs() && moving) this.raf = this.view.requestAnimationFrame(this.frame); else this.last = 0; };
  private kick() { if (!this.raf && this.needs()) this.raf = this.view.requestAnimationFrame(this.frame); }
  private stop() { if (this.raf) this.view.cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; }
  private onVisibility = () => { if (this.destroyed) return; this.stop(); this.paint(0); this.kick(); };
  private onReduced = () => { if (this.destroyed) return; this.reduced = this.reducedMQ.matches; this.dots = []; this.stop(); this.paint(0); this.kick(); };
  private onTheme = () => { if (this.destroyed) return;
    if (this.layout && this.pixelRatio !== Math.min(2, this.view.devicePixelRatio || 1)) this.sizeCanvas();
    this.resolveColors(); for (const paint of this.segments.values()) paint.color = null; this.paint(0); this.kick(); };

  /** Retire the single clock, observers, media listeners and owned paint nodes; later callbacks cannot revive it. */
  destroy() { if (this.destroyed) return; this.destroyed = true; this.stop(); this.resize.disconnect(); this.intersection.disconnect(); this.releaseTheme();
    this.reducedMQ.removeEventListener('change', this.onReduced); this.document.removeEventListener('visibilitychange', this.onVisibility);
    this.document.fonts?.removeEventListener('loadingdone', this.onTheme);
    this.probe.remove(); this.elements.steps.replaceChildren(); this.elements.drops.replaceChildren(); this.elements.bands.replaceChildren(); this.elements.accents.replaceChildren();
    this.context?.clearRect(0, 0, this.layout?.width ?? 0, this.layout?.height ?? 0); this.dots = []; }
}
