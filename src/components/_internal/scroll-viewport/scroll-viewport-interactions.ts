/**
 * Owns the next sibling-rail interaction policy for an existing native viewport.
 * Pure pointer/wheel geometry is separate from its owner-document controller;
 * neither creates a viewport, changes focus, loads data or replaces old rails.
 */
import type { ScrollViewportAxis, ScrollViewportMetrics } from './scroll-viewport-metrics';

export type ScrollViewportInteractionAxis = 'x' | 'y';
export type ScrollViewportWheelMode = 'native' | 'horizontal';

const bounded = (value: number, maximum: number) => Math.max(0, Math.min(Math.max(0, maximum), value));
const valid = (values: readonly number[]) => values.every(Number.isFinite);

/** Recover local track coordinates from the painted axis, including nonuniform positive scale. */
export function resolveScrollViewportTrackPointer(metric: ScrollViewportAxis, paintedStart: number,
  paintedLength: number, coordinate: number): { within: number; scale: number } | null {
  if (!valid([metric.track, paintedStart, paintedLength, coordinate]) || metric.track <= 0 || paintedLength <= 0) return null;
  const scale = paintedLength / metric.track;
  return { within: (coordinate - paintedStart) / scale, scale };
}

/** Track clicks page ninety percent of the viewport; clicks within the thumb do not page. */
export function resolveScrollViewportPageTarget(metric: ScrollViewportAxis, within: number, viewportSize: number): number | null {
  if (!metric.overflow || !valid([metric.offset, metric.maximum, metric.position, metric.thumb, within, viewportSize]) || viewportSize <= 0) return null;
  const direction = within < metric.position ? -1 : within > metric.position + metric.thumb ? 1 : 0;
  if (!direction) return null;
  const target = bounded(metric.offset + direction * viewportSize * .9, metric.maximum);
  return Math.abs(target - metric.offset) > .01 ? target : null;
}

/**
 * Keep the fractional pointer grip inside the thumb while current geometry
 * changes. The result is a physical offset, independent of native RTL storage.
 */
export function resolveScrollViewportDragOffset(metric: ScrollViewportAxis, within: number, grip: number): number | null {
  const travel = metric.track - metric.thumb;
  if (!metric.overflow || !valid([metric.maximum, metric.track, metric.thumb, within, grip])
    || travel <= 0 || metric.thumb <= 0 || metric.maximum <= 0) return null;
  return bounded((within - bounded(grip, 1) * metric.thumb) / travel * metric.maximum, metric.maximum);
}

/** A bounded wheel plan. Null means native handling and ancestor chaining remain untouched. */
export function resolveScrollViewportWheelTarget(input: { axis: ScrollViewportInteractionAxis; deltaX: number; deltaY: number;
  deltaMode: number; width: number; height: number; offset: number; maximum: number;
  horizontalConversion?: boolean; ctrlKey?: boolean; shiftKey?: boolean; rtl?: boolean }): number | null {
  if (input.ctrlKey || !valid([input.deltaX, input.deltaY, input.deltaMode, input.width, input.height, input.offset, input.maximum])) return null;
  if (input.horizontalConversion && (input.shiftKey || input.axis !== 'x' || Math.abs(input.deltaY) <= Math.abs(input.deltaX))) return null;
  // Vertical wheel intent advances along the inline reading direction. A real
  // deltaX gesture is already a physical native direction and is never mirrored.
  const verticalInline = input.deltaY * (input.rtl ? -1 : 1);
  const delta = input.axis === 'y' ? input.deltaY : input.horizontalConversion ? verticalInline : input.deltaX || verticalInline;
  const mode = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? input.axis === 'x' ? input.width : input.height : 1;
  const target = bounded(input.offset + delta * mode, input.maximum);
  return Math.abs(target - input.offset) > .01 ? target : null;
}

interface ScrollViewportDrag {
  axis: ScrollViewportInteractionAxis;
  pointer: number;
  pointerType: string;
  grip: number;
  rail: HTMLElement;
  restore: () => void;
}

export interface ScrollViewportInteractionOptions {
  readonly viewport: HTMLElement;
  readonly readMetrics: () => ScrollViewportMetrics | null;
  readonly onDragging?: (axis: ScrollViewportInteractionAxis | null) => void;
  readonly onHovered?: (hovered: boolean) => void;
}

/** The controller is private to one exact viewport and must be destroyed before that viewport is replaced. */
export interface ScrollViewportInteractions {
  start(axis: ScrollViewportInteractionAxis, rail: HTMLElement, event: PointerEvent, thumb: boolean): void;
  wheel(axis: ScrollViewportInteractionAxis, event: WheelEvent, horizontalConversion?: boolean): boolean;
  cancel(): void;
  destroy(): void;
}

function retainInlineProperties(style: CSSStyleDeclaration, values: Readonly<Record<string, string>>): () => void {
  const previous = Object.keys(values).map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const);
  // Important is required to override authored !important snap/behavior rules,
  // then restore the exact previous inline value and priority on every exit.
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value, 'important');
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const [name, value, priority] of previous) {
      if (value) style.setProperty(name, value, priority); else style.removeProperty(name);
    }
  };
}

function physicalOffset(viewport: HTMLElement, axis: ScrollViewportInteractionAxis, maximum: number, rtl: boolean): number {
  return bounded(axis === 'y' ? viewport.scrollTop : rtl ? maximum + viewport.scrollLeft : viewport.scrollLeft, maximum);
}

/** Overlay admission follows composed ancestors, not only light-DOM closest(). */
function inactiveViewport(viewport: HTMLElement): boolean {
  let current: Element | null = viewport;
  const seen = new Set<Element>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.matches('[inert], [hidden], [aria-hidden="true"]')) return true;
    const root = current.getRootNode();
    current = current.assignedSlot ?? current.parentElement ?? ('host' in root ? (root as ShadowRoot).host : null);
  }
  return false;
}

/**
 * Respect descendants that can natively consume this wheel. Walking the event's
 * composed path also preserves nested scroll owners inside open shadow roots.
 */
export function nestedScrollViewportConsumesWheel(viewport: HTMLElement, event: WheelEvent): boolean {
  const view = viewport.ownerDocument.defaultView;
  if (!view) return true;
  const path = event.composedPath();
  for (const target of path) {
    if (target === viewport) break;
    if (!(target instanceof view.Element)) continue;
    // Editable/native controls keep their wheel semantics, even without overflow.
    if (target.matches('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return true;
    const style = view.getComputedStyle(target);
    for (const axis of ['y', 'x'] as const) {
      const delta = axis === 'y' ? event.deltaY : event.deltaX;
      if (!delta || !/^(auto|scroll|overlay)$/u.test(axis === 'y' ? style.overflowY : style.overflowX)) continue;
      const element = target as HTMLElement;
      const maximum = axis === 'y' ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
      const offset = physicalOffset(element, axis, Math.max(0, maximum), style.direction === 'rtl');
      if (maximum > .5 && (delta < 0 ? offset > .01 : offset < maximum - .01)) return true;
    }
  }
  return false;
}

/**
 * Add snap-safe thumb dragging, reduced-motion-aware paging and bounded wheel
 * handling to sibling rails. Pointer listeners belong to the viewport document;
 * teardown, blur, cancellation and lost capture all restore authored styles.
 */
export function createScrollViewportInteractions(options: ScrollViewportInteractionOptions): ScrollViewportInteractions {
  const { viewport, readMetrics } = options;
  const document = viewport.ownerDocument, view = document.defaultView;
  let active: ScrollViewportDrag | null = null, disposed = false;
  const reduced = view?.matchMedia('(prefers-reduced-motion: reduce)');
  const rtl = () => view?.getComputedStyle(viewport).direction === 'rtl';
  const write = (axis: ScrollViewportInteractionAxis, target: number, maximum: number, behavior: ScrollBehavior = 'instant') => {
    const value = axis === 'x' && rtl() ? target - maximum : target;
    viewport.scrollTo(axis === 'x' ? { left: value, behavior } : { top: value, behavior });
  };
  const end = (event?: PointerEvent) => {
    if (!active || event && event.pointerId !== active.pointer) return;
    const drag = active; active = null;
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', end, true);
    document.removeEventListener('pointercancel', end, true);
    drag.rail.removeEventListener('lostpointercapture', end);
    drag.restore();
    if (drag.rail.hasPointerCapture(drag.pointer)) drag.rail.releasePointerCapture(drag.pointer);
    options.onDragging?.(null);
    options.onHovered?.(!disposed && drag.pointerType === 'mouse' && drag.rail.matches(':hover'));
  };
  const move = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointer) return;
    if (inactiveViewport(viewport)) { end(); return; }
    // A modal can still be scaling in, or responsive/content geometry can change
    // during a captured pointer. Never reuse pointerdown's painted scale/ratio.
    const metric = readMetrics()?.[active.axis];
    if (!metric?.overflow) { end(); return; }
    const bounds = active.rail.getBoundingClientRect();
    const point = resolveScrollViewportTrackPointer(metric, active.axis === 'x' ? bounds.left : bounds.top,
      active.axis === 'x' ? bounds.width : bounds.height, active.axis === 'x' ? event.clientX : event.clientY);
    const target = point ? resolveScrollViewportDragOffset(metric, point.within, active.grip) : null;
    if (target === null) { end(); return; }
    write(active.axis, target, metric.maximum);
  };
  const blur = () => end();
  const visibility = () => { if (document.hidden) end(); };
  view?.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
  return {
    start(axis, rail, event, thumb) {
      if (disposed || !view || event.button !== 0 || inactiveViewport(viewport) || active && event.pointerId !== active.pointer) return;
      const metric = readMetrics()?.[axis];
      if (!metric?.overflow) return;
      const bounds = rail.getBoundingClientRect(), coordinate = axis === 'x' ? event.clientX : event.clientY;
      const point = resolveScrollViewportTrackPointer(metric, axis === 'x' ? bounds.left : bounds.top, axis === 'x' ? bounds.width : bounds.height, coordinate);
      if (!point) return;
      const offset = physicalOffset(viewport, axis, metric.maximum, !!rtl());
      if (!thumb) {
        const current = { ...metric, offset, position: metric.maximum > 0 ? offset / metric.maximum * (metric.track - metric.thumb) : 0 };
        const target = resolveScrollViewportPageTarget(current, point.within, axis === 'x' ? viewport.clientWidth : viewport.clientHeight);
        if (target === null) return;
        event.preventDefault(); event.stopPropagation();
        write(axis, target, metric.maximum, reduced?.matches ? 'instant' : 'smooth');
        return;
      }
      if (metric.track <= metric.thumb || metric.thumb <= 0) return;
      end(); event.preventDefault(); event.stopPropagation();
      const position = offset / metric.maximum * (metric.track - metric.thumb);
      active = { axis, pointer: event.pointerId, pointerType: event.pointerType,
        grip: bounded((point.within - position) / metric.thumb, 1), rail,
        restore: retainInlineProperties(viewport.style, { 'scroll-snap-type': 'none', 'scroll-behavior': 'auto' }) };
      document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', end, true);
      document.addEventListener('pointercancel', end, true); rail.addEventListener('lostpointercapture', end);
      try { rail.setPointerCapture(event.pointerId); } catch {
        // A synthetic/stale pointer or detached rail cannot start a capture lease.
        end(); return;
      }
      options.onDragging?.(axis);
    },
    wheel(axis, event, horizontalConversion = false) {
      if (disposed || !view || inactiveViewport(viewport) || event.defaultPrevented || event.ctrlKey || horizontalConversion && nestedScrollViewportConsumesWheel(viewport, event)) return false;
      const metric = readMetrics()?.[axis];
      if (!metric?.overflow) return false;
      const offset = physicalOffset(viewport, axis, metric.maximum, !!rtl());
      const target = resolveScrollViewportWheelTarget({ axis, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        width: viewport.clientWidth, height: viewport.clientHeight, offset, maximum: metric.maximum,
        horizontalConversion, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, rtl: !!rtl() });
      if (target === null) return false;
      write(axis, target, metric.maximum);
      // Native snap/layout may decline movement. Only consumed movement owns the event.
      if (Math.abs(physicalOffset(viewport, axis, metric.maximum, !!rtl()) - offset) <= .01) return false;
      event.preventDefault(); event.stopPropagation(); return true;
    },
    cancel() { end(); },
    destroy() {
      if (disposed) return;
      disposed = true; end();
      view?.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);
    },
  };
}
