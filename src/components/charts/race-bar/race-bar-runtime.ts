/**
 * Owns the Race Bar browser paint clock, stable DOM rows and lifecycle only.
 * Consumes validated pure history/math; never fetches, fabricates periods or owns source authorization.
 */
import { computeRaceBarSnapshot, preserveRaceBarFramePosition } from './race-bar-model';
import { computeRaceBarLayout } from './race-bar-layout';
import { advanceRaceBarSpring, raceBarTicks, RACE_BAR_MOTION_DEFAULTS } from './race-bar-math';
import type { RaceBarModel, RaceBarModelItem, RaceBarSnapshot, RaceBarLayout, RaceBarSpringState } from './race-bar-types';
import { chartSeriesPaint, CHART_CATEGORICAL_COLORS } from '../chart-tokens';
import { observePresentationTheme } from '../../../lib/observe-presentation-theme';

export type RaceBarFrameReason = 'seek' | 'step' | 'scrub' | 'playback' | 'replay';
export interface RaceBarRuntimeOptions {
  bars: number; frameDuration: number; autoPlay: boolean; loop: boolean; defaultFrame: number;
  frame?: number; playing?: boolean; motion: boolean; highlight: string | null; selectedId: string | null;
  formatValue: (value: number) => string; formatTick: (value: number) => string;
  onFrameChange: (position: number, reason: RaceBarFrameReason) => void;
  onFrame: (index: number, snapshot: RaceBarSnapshot) => void;
  onPlayingChange: (playing: boolean) => void;
  onPaint: (snapshot: RaceBarSnapshot, layout: RaceBarLayout, point: readonly [number, number] | null, effectivePlaying: boolean) => void;
}
export interface RaceBarRuntimeElements {
  figure: HTMLElement; plot: HTMLElement; rows: HTMLElement; axis: HTMLElement; grid: HTMLElement;
  period: HTMLElement; total: HTMLElement; fill: HTMLElement | null; thumb: HTMLElement | null; slider: HTMLInputElement | null;
}
interface PaintRow { item: RaceBarModelItem; el: HTMLDivElement; name: HTMLDivElement; bar: HTMLDivElement; value: HTMLDivElement;
  y: RaceBarSpringState; opacity: RaceBarSpringState; removed: boolean; }
interface PaintTick { label: HTMLDivElement; line: HTMLDivElement; opacity: RaceBarSpringState; }
const clamp = (value: number, max: number) => Math.max(0, Math.min(Math.max(0, max), value));
const round = (value: number) => Math.round(value * 10) / 10;
const set = (element: HTMLElement, property: string, value: string) => { if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value); };
const text = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };

/** Imperative paint controller mounted and disposed by React; requests respect controlled frame/playing inputs. */
export class RaceBarPaintRuntime {
  private model: RaceBarModel | null = null;
  private options: RaceBarRuntimeOptions;
  private rows = new Map<string, PaintRow>();
  private ticks = new Map<number, PaintTick>();
  private position: RaceBarSpringState = { x: 0, v: 0 };
  private target = 0;
  private wanted = false;
  private dragging = false;
  private scrubRequested = 0;
  private emittingFrameRequest = false;
  private emittingPlayingRequest = false;
  private onScreen = false;
  private seen = false;
  private autoplayEligible = true;
  private destroyed = false;
  private reduced = false;
  private raf = 0;
  private last = 0;
  private periodIndex = -1;
  private periodIdentity: string | null = null;
  private layout: RaceBarLayout | null = null;
  private snapshot: RaceBarSnapshot | null = null;
  private settling = false;
  private canvas: CanvasRenderingContext2D | null;
  private readonly reduceMQ: MediaQueryList;
  private readonly resize: ResizeObserver;
  private readonly intersection: IntersectionObserver;
  private readonly releaseTheme: () => void;
  private readonly document: Document;
  private readonly view: Window;
  private width = 0;

  constructor(private readonly elements: RaceBarRuntimeElements, options: RaceBarRuntimeOptions) {
    this.options = options;
    this.document = elements.figure.ownerDocument; this.view = this.document.defaultView!;
    this.canvas = this.document.createElement('canvas').getContext('2d');
    this.reduceMQ = this.view.matchMedia('(prefers-reduced-motion: reduce)'); this.reduced = this.reduceMQ.matches;
    this.reduceMQ.addEventListener('change', this.onReduced);
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.resize = new ResizeObserver(() => { if (this.destroyed) return; const width = Math.round(elements.plot.clientWidth); if (width && width !== this.width) { this.relayout(); this.paint(0); this.kick(); } });
    this.resize.observe(elements.plot);
    this.intersection = new IntersectionObserver(entries => {
      if (this.destroyed) return;
      this.onScreen = !!entries[0]?.isIntersecting; this.last = 0;
      if (this.onScreen) { this.seen = true; this.tryAutoplay(); }
      if (!this.onScreen) this.stop();
      this.paint(0); this.kick();
    }, { threshold: .25 });
    this.intersection.observe(elements.plot);
    const externalClasses = (value: string | null) => (value ?? '').split(/\s+/).filter(name => name && name !== 'dim' && name !== 'inside').sort().join(' ');
    this.releaseTheme = observePresentationTheme(elements.figure, this.onTheme, { ignoreMutation: record => record.target === elements.figure
      && record.attributeName === 'class' && externalClasses(record.oldValue) === externalClasses(elements.figure.className) });
    this.document.fonts?.addEventListener('loadingdone', this.onTheme);
    void this.document.fonts?.ready.then(this.onTheme);
  }

  private get instant() { return this.reduced || !this.options.motion; }
  private get active() { return this.wanted && !this.dragging && this.onScreen && !this.document.hidden && (this.model?.frames.length ?? 0) > 1 &&
    (this.options.loop || this.target < (this.model?.frames.length ?? 0) - 1); }
  /** Current rounded painted period, not the requested target. */
  get frame() { return this.snapshot?.frameIndex ?? 0; }
  /** User playback intent survives visibility pauses, but not an explicit pause. */
  get playing() { return this.wanted; }
  get currentSnapshot() { return this.snapshot; }
  get currentLayout() { return this.layout; }
  get targetFrame() { return this.target; }

  /** Chrome can disappear/reappear without retiring the history clock or its row spring velocities. */
  attachTimeline(fill: HTMLElement | null, thumb: HTMLElement | null, slider: HTMLInputElement | null) {
    if (this.destroyed) return;
    if (this.elements.slider && !slider && this.dragging) this.endScrub();
    this.elements.fill = fill; this.elements.thumb = thumb; this.elements.slider = slider; this.paint(0);
  }

  /** Replace authorized history, preserving the current period's identity and existing row velocities. */
  update(model: RaceBarModel, options: RaceBarRuntimeOptions) {
    if (this.destroyed) return;
    const previous = this.model, previousOptions = this.options;
    this.options = options;
    if (!previous) {
      this.position.x = this.target = clamp(options.frame ?? options.defaultFrame, model.frames.length - 1);
    } else if (previous !== model) {
      this.position.x = preserveRaceBarFramePosition(previous, model, this.position.x);
      this.target = preserveRaceBarFramePosition(previous, model, this.target);
      if (this.dragging) this.scrubRequested = preserveRaceBarFramePosition(previous, model, this.scrubRequested);
      if (!model.frames.length) this.position.v = 0;
    }
    if (options.frame !== undefined && (options.frame !== previousOptions.frame || previous !== model)) this.target = clamp(options.frame, model.frames.length - 1);
    if (options.playing !== undefined) this.wanted = options.playing && model.frames.length > 1;
    else if (model.frames.length < 2) this.wanted = false;
    this.model = model;
    const rebuild = previous !== model;
    const keep = new Set(model.items.map(item => item.id));
    if (rebuild) for (const [id, row] of this.rows) if (!keep.has(id)) row.removed = true;
    if (rebuild) for (const item of model.items) {
      let row = this.rows.get(item.id);
      if (!row) {
        const el = this.document.createElement('div'), name = this.document.createElement('div'), bar = this.document.createElement('div'), value = this.document.createElement('div');
        el.className = 'zero-race-bar__row'; el.dataset.itemId = item.id; el.setAttribute('aria-hidden', 'true');
        name.className = 'zero-race-bar__name'; bar.className = 'zero-race-bar__bar'; value.className = 'zero-race-bar__value'; el.append(name, bar, value); this.elements.rows.append(el);
        row = { item, el, name, bar, value, y: { x: NaN, v: 0 }, opacity: { x: 0, v: 0 }, removed: false }; this.rows.set(item.id, row);
      }
      row.item = item; row.removed = false; text(row.name, item.label);
      set(row.bar, '--c', chartSeriesPaint(item.series, CHART_CATEGORICAL_COLORS, '--zero-race-bar-series-'));
      row.el.classList.toggle('hi', options.highlight === item.id);
    }
    if (previousOptions.highlight !== options.highlight) for (const row of this.rows.values()) row.el.classList.toggle('hi', options.highlight === row.item.id);
    if (rebuild || previousOptions.bars !== options.bars || previousOptions.formatValue !== options.formatValue || !this.layout) this.relayout();
    this.tryAutoplay(); this.paint(0); this.kick();
  }

  private tryAutoplay() {
    if (this.autoplayEligible && this.onScreen && this.options.autoPlay && this.options.playing === undefined && !this.instant && (this.model?.frames.length ?? 0) > 1) {
      this.autoplayEligible = false; this.requestPlaying(true);
    }
  }

  private relayout() {
    if (!this.model) return;
    const width = this.elements.plot.clientWidth || this.elements.figure.clientWidth || 300; this.width = Math.round(width);
    const style = this.view.getComputedStyle(this.elements.figure), font = style.fontFamily, first = this.rows.values().next().value as PaintRow | undefined;
    const labelFont = first ? this.view.getComputedStyle(first.name).font : `400 12.5px ${font}`, valueFont = first ? this.view.getComputedStyle(first.value).font : `500 12.5px ${font}`;
    this.layout = computeRaceBarLayout(this.model, { width, bars: this.options.bars, formatValue: this.options.formatValue,
      measureText: (value, kind) => { if (!this.canvas) return value.length * 7; this.canvas.font = kind === 'label' ? labelFont : valueFont; return this.canvas.measureText(value).width; } });
    const layout = this.layout;
    this.elements.figure.classList.toggle('inside', layout.inside); this.elements.plot.dataset.layout = layout.inside ? 'inside' : 'outside';
    set(this.elements.plot, 'height', layout.H + 'px');
    for (const row of this.rows.values()) {
      set(row.el, 'height', layout.barH + 'px'); set(row.name, 'width', layout.inside ? 'auto' : layout.labelW + 'px');
      set(row.name, 'max-width', layout.inside ? Math.max(0, layout.area - 12) + 'px' : layout.labelW + 'px');
      set(row.name, 'line-height', layout.barH + 'px'); set(row.name, 'height', layout.barH + 'px');
      set(row.bar, 'left', layout.x0 + 'px'); set(row.bar, 'height', layout.barH + 'px'); set(row.value, 'line-height', layout.barH + 'px');
    }
  }

  private requestPlaying(next: boolean) {
    if (this.destroyed) return;
    next = next && (this.model?.frames.length ?? 0) > 1;
    const changed = next !== this.wanted;
    if (this.options.playing === undefined) this.wanted = next;
    if (changed && !this.emittingPlayingRequest) {
      this.emittingPlayingRequest = true;
      try { this.options.onPlayingChange(next); } finally { this.emittingPlayingRequest = false; }
    }
    this.paint(0); this.kick();
  }
  private requestFrame(position: number, reason: RaceBarFrameReason) {
    if (this.destroyed) return;
    const next = clamp(position, (this.model?.frames.length ?? 0) - 1);
    const changed = next !== this.target;
    if (this.options.frame === undefined) this.target = next;
    if (changed && !this.emittingFrameRequest) {
      this.emittingFrameRequest = true;
      try { this.options.onFrameChange(next, reason); } finally { this.emittingFrameRequest = false; }
    }
    this.paint(0); this.kick();
  }
  play() { if (this.frame >= (this.model?.frames.length ?? 0) - 1 && (this.model?.frames.length ?? 0) > 1) this.requestFrame(0, 'replay'); this.requestPlaying(true); }
  pause() { this.autoplayEligible = false; this.requestFrame(Math.round(this.target), 'seek'); this.requestPlaying(false); }
  toggle() { if (this.wanted) this.pause(); else this.play(); }
  replay() { this.requestFrame(0, 'replay'); this.requestPlaying(true); }
  seek(position: number) { this.autoplayEligible = false; this.requestPlaying(false); this.requestFrame(Math.round(position), 'seek'); }
  next() { this.autoplayEligible = false; this.requestPlaying(false); this.requestFrame(Math.round(this.target) + 1, 'step'); }
  prev() { this.autoplayEligible = false; this.requestPlaying(false); this.requestFrame(Math.round(this.target) - 1, 'step'); }
  scrub(position: number) { this.autoplayEligible = false; this.dragging = true; this.scrubRequested = position; this.requestPlaying(false); this.requestFrame(position, 'scrub'); }
  endScrub() { this.dragging = false; this.requestFrame(Math.round(this.scrubRequested), 'scrub'); }

  private paint(dt: number) {
    if (!this.model || !this.layout || this.destroyed) return false;
    const model = this.model, layout = this.layout;
    let moving = false;
    if (this.instant) { this.position.x = Math.round(this.target); this.position.v = 0; }
    else moving = advanceRaceBarSpring(this.position, this.target, this.dragging ? RACE_BAR_MOTION_DEFAULTS.scrub : RACE_BAR_MOTION_DEFAULTS.clock, dt);
    this.position.x = clamp(this.position.x, model.frames.length - 1);
    if ((this.position.x === 0 && this.position.v < 0) || (this.position.x === model.frames.length - 1 && this.position.v > 0)) this.position.v = 0;
    const snapshot = this.snapshot = computeRaceBarSnapshot(model, this.position.x);
    const ranked = new Map(snapshot.rows.map(row => [row.item.id, row])), top = Math.max(0, ...snapshot.rows.slice(0, layout.n).map(row => row.value)), denominator = top > 0 ? top : 1;
    const wantedTicks = new Set(model.frames.length ? raceBarTicks(top, layout.area) : []);
    for (const value of wantedTicks) if (!this.ticks.has(value)) {
      const label = this.document.createElement('div'), line = this.document.createElement('div'); label.className = 'zero-race-bar__tick'; line.className = 'zero-race-bar__grid-line';
      this.elements.axis.append(label); this.elements.grid.append(line); this.ticks.set(value, { label, line, opacity: { x: 0, v: 0 } });
    }
    for (const [value, tick] of this.ticks) {
      const on = wantedTicks.has(value), x = layout.x0 + clamp(value / denominator, 2) * layout.area;
      if (this.instant) { tick.opacity.x = on ? 1 : 0; tick.opacity.v = 0; }
      else moving = advanceRaceBarSpring(tick.opacity, on ? 1 : 0, RACE_BAR_MOTION_DEFAULTS.tick, dt) || moving;
      if (!on && tick.opacity.x < .01) { tick.label.remove(); tick.line.remove(); this.ticks.delete(value); continue; }
      text(tick.label, this.options.formatTick(value));
      const opacity = String(x <= layout.W - 4 ? Math.round(clamp(tick.opacity.x, 1) * 100) / 100 : 0);
      set(tick.label, 'left', round(x) + 'px'); set(tick.label, 'opacity', opacity);
      set(tick.line, 'left', round(x) + 'px'); set(tick.line, 'top', layout.axisH - 4 + 'px'); set(tick.line, 'height', layout.n * layout.rowH + 4 + 'px'); set(tick.line, 'opacity', opacity);
    }
    let anchor: readonly [number, number] | null = null;
    for (const [id, row] of this.rows) {
      const entry = ranked.get(id), visible = !!entry && entry.rank < layout.n && model.frames.length > 0;
      const y = layout.axisH + Math.min(entry?.rank ?? layout.n, layout.n) * layout.rowH + (visible ? 0 : layout.rowH * .5);
      if (Number.isNaN(row.y.x)) { row.y.x = visible && this.seen ? layout.H + layout.rowH * .5 : y; row.opacity.x = visible && !this.seen ? 1 : 0; }
      if (this.instant) { row.y.x = y; row.y.v = 0; row.opacity.x = visible ? 1 : 0; row.opacity.v = 0; }
      else { moving = advanceRaceBarSpring(row.y, y, RACE_BAR_MOTION_DEFAULTS.row, dt) || moving; moving = advanceRaceBarSpring(row.opacity, visible ? 1 : 0, RACE_BAR_MOTION_DEFAULTS.opacity, dt) || moving; }
      const opacity = clamp(row.opacity.x, 1), width = entry ? Math.max(0, entry.value / denominator * layout.area) : 0;
      set(row.el, 'transform', `translateY(${round(row.y.x)}px)`); set(row.el, 'opacity', String(Math.round(opacity * 100) / 100));
      set(row.el, 'z-index', String(visible ? 100 - (entry?.rank ?? 0) : 0)); set(row.el, 'visibility', opacity < .01 ? 'hidden' : 'visible');
      row.el.dataset.rank = entry ? String(entry.rank + 1) : ''; row.el.dataset.value = entry ? String(entry.value) : '';
      row.el.dataset.inTop = String(visible); row.el.classList.toggle('on', this.options.selectedId === id && visible);
      set(row.bar, 'width', round(width) + 'px'); text(row.value, entry ? this.options.formatValue(entry.value) : '');
      const desiredX = layout.inside ? layout.x0 + Math.max(width, Math.min(layout.area - 8, (layout.itemNameWidths.get(id) ?? 0) + 16)) + 7 : layout.x0 + width + 7;
      set(row.value, 'left', round(Math.min(desiredX, Math.max(0, layout.W - layout.valW + 10))) + 'px');
      if (this.options.selectedId === id && visible) anchor = [layout.x0 + Math.min(width, layout.area) * .5, row.y.x];
      if (row.removed && opacity < .01) { row.el.remove(); this.rows.delete(id); }
    }
    this.elements.figure.classList.toggle('dim', !!anchor);
    const frame = model.frames[snapshot.frameIndex];
    if (frame && (snapshot.frameIndex !== this.periodIndex || frame.id !== this.periodIdentity || this.elements.period.lastElementChild?.textContent !== frame.period)) {
      const changed = snapshot.frameIndex !== this.periodIndex || frame.id !== this.periodIdentity;
      this.rollPeriod(frame.period, snapshot.frameIndex); this.periodIdentity = frame.id;
      this.periodIndex = snapshot.frameIndex;
      if (changed) this.options.onFrame(snapshot.frameIndex, snapshot);
      if (this.destroyed) return false;
    } else if (!frame) { this.elements.period.replaceChildren(); this.periodIndex = -1; this.periodIdentity = null; }
    text(this.elements.total, this.options.formatValue(snapshot.total));
    const percent = model.frames.length > 1 ? snapshot.position / (model.frames.length - 1) * 100 : 0;
    if (this.elements.fill) set(this.elements.fill, 'width', round(percent) + '%');
    if (this.elements.thumb) set(this.elements.thumb, 'left', round(percent) + '%');
    if (this.elements.slider) { this.elements.slider.value = String(snapshot.position); this.elements.slider.setAttribute('aria-valuenow', String(snapshot.frameIndex));
      this.elements.slider.setAttribute('aria-valuetext', frame?.period ?? 'No periods'); }
    for (const mark of this.elements.figure.querySelectorAll<HTMLElement>('.zero-race-bar__mark')) mark.classList.toggle('ahead', Number(mark.dataset.frame) > snapshot.position + .01);
    this.settling = moving; this.elements.plot.dataset.settling = String(moving); this.elements.plot.dataset.position = String(snapshot.position);
    this.elements.plot.dataset.playing = String(this.active); this.elements.plot.dataset.requestedPlaying = String(this.wanted);
    this.options.onPaint(snapshot, layout, anchor, this.active); return moving;
  }

  private rollPeriod(period: string, index: number) {
    const container = this.elements.period;
    for (const old of container.querySelectorAll('[data-leaving]')) old.remove();
    const current = [...container.children] as HTMLElement[], next = this.document.createElement('span'); next.textContent = period; container.append(next);
    if (this.instant || this.periodIndex < 0) { for (const old of current) old.remove(); return; }
    const direction = index > this.periodIndex ? 1 : -1, easing = 'cubic-bezier(.2,0,0,1)';
    const token = (name: string, fallback: number) => { const raw = this.view.getComputedStyle(this.elements.figure).getPropertyValue(name).trim();
      const value = parseFloat(raw); return Number.isFinite(value) && value >= 0 ? Math.min(10_000, raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : value) : fallback; };
    next.animate([{ transform: `translateY(${55 * direction}%)`, filter: 'blur(5px)', opacity: 0 }, { transform: 'none', filter: 'blur(0px)', opacity: 1 }],
      { duration: token('--zero-race-bar-period-enter', RACE_BAR_MOTION_DEFAULTS.periodEnterMs), easing });
    for (const old of current) { old.dataset.leaving = 'true'; old.getAnimations().forEach(animation => animation.cancel());
      const animation = old.animate([{ transform: 'none', filter: 'blur(0px)', opacity: 1 }, { transform: `translateY(${-55 * direction}%)`, filter: 'blur(5px)', opacity: 0 }],
        { duration: token('--zero-race-bar-period-exit', RACE_BAR_MOTION_DEFAULTS.periodExitMs), easing, fill: 'forwards' }); animation.onfinish = () => old.remove(); }
  }

  private frameLoop = (timestamp: number) => {
    if (this.destroyed) return;
    this.raf = 0; const now = timestamp / 1000, dt = Math.min(.05, this.last ? now - this.last : 0); this.last = now;
    if (this.active) {
      let target = this.target + dt / (this.options.frameDuration / 1000);
      if (target >= (this.model?.frames.length ?? 0) - 1) {
        if (this.options.loop) target = 0; else { target = (this.model?.frames.length ?? 0) - 1; this.requestPlaying(false); }
        if (this.destroyed) return;
      }
      // Controlled consumers accept the next clock target explicitly; no hidden local write can override their intent.
      if (this.options.frame === undefined) this.target = target;
      this.options.onFrameChange(target, 'playback');
      if (this.destroyed) return;
    }
    const moving = this.paint(dt);
    if (this.destroyed) return;
    // External controlled callbacks can re-enter update/kick while this frame is painting. The guarded path guarantees one pending RAF.
    if (this.onScreen && !this.document.hidden && (this.active || moving || this.dragging)) this.kick(); else this.last = 0;
    this.elements.plot.dataset.running = String(!!this.raf);
  };
  private kick() { if (!this.destroyed && !this.raf && this.onScreen && !this.document.hidden && (this.active || this.settling || this.dragging)) {
    this.raf = this.view.requestAnimationFrame(this.frameLoop); this.elements.plot.dataset.running = 'true'; } }
  private stop() { this.view.cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; this.elements.plot.dataset.running = 'false'; }
  private onVisibility = () => { this.stop(); this.paint(0); this.kick(); };
  private onReduced = () => { if (this.destroyed) return; this.reduced = this.reduceMQ.matches; if (this.reduced) { this.autoplayEligible = false; this.requestPlaying(false); } this.paint(0); this.kick(); };
  private onTheme = () => { if (this.destroyed) return; this.relayout(); this.paint(0); this.kick(); };
  /** Idempotently retires every observer, animation and frame request for Strict Mode/unmount. */
  destroy() {
    if (this.destroyed) return; this.destroyed = true; this.stop(); this.resize.disconnect(); this.intersection.disconnect(); this.releaseTheme();
    this.reduceMQ.removeEventListener('change', this.onReduced); this.document.removeEventListener('visibilitychange', this.onVisibility);
    this.document.fonts?.removeEventListener('loadingdone', this.onTheme);
    for (const element of this.elements.period.children) element.getAnimations().forEach(animation => animation.cancel());
    this.elements.rows.replaceChildren(); this.elements.axis.replaceChildren(); this.elements.grid.replaceChildren(); this.elements.period.replaceChildren();
  }
}
