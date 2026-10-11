/** Pure/controller qualification for new sibling rails; no browser, config, app or database is started. */
import { describe, expect, test } from 'bun:test';
import { measureScrollViewport } from './scroll-viewport-metrics';
import { createScrollViewportInteractions, nestedScrollViewportConsumesWheel, resolveScrollViewportDragOffset,
  resolveScrollViewportPageTarget, resolveScrollViewportTrackPointer, resolveScrollViewportWheelTarget } from './scroll-viewport-interactions';

const metric = () => measureScrollViewport({ width: 200, height: 100, contentWidth: 600, contentHeight: 400,
  left: 100, top: 50 }, 'both');

class InlineStyle {
  values = new Map<string, [string, string]>();
  getPropertyValue(name: string) { return this.values.get(name)?.[0] ?? ''; }
  getPropertyPriority(name: string) { return this.values.get(name)?.[1] ?? ''; }
  setProperty(name: string, value: string, priority = '') { this.values.set(name, [value, priority]); }
  removeProperty(name: string) { const old = this.getPropertyValue(name); this.values.delete(name); return old; }
}

class FakeElement extends EventTarget {
  style = new InlineStyle();
  parentElement: FakeElement | null = null;
  assignedSlot: FakeElement | null = null;
  root: EventTarget | { host: FakeElement } = new EventTarget();
  inactive = false;
  editable = false;
  direction = 'ltr';
  overflowX = 'auto';
  overflowY = 'auto';
  scrollLeft = 100;
  scrollTop = 50;
  clientWidth = 200;
  clientHeight = 100;
  scrollWidth = 600;
  scrollHeight = 400;
  captures = new Set<number>();
  commands: ScrollToOptions[] = [];
  hover = false;
  refuseScroll = false;
  painted = { left: 10, top: 20, width: 368, height: 42 };
  ownerDocument!: FakeDocument;
  matches(selector: string) { return selector === ':hover' ? this.hover : selector.includes('input,') ? this.editable : this.inactive; }
  getRootNode() { return this.root; }
  getBoundingClientRect() { return this.painted; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  scrollTo(options: ScrollToOptions) {
    this.commands.push(options);
    if (this.refuseScroll) return;
    if (options.left !== undefined) this.scrollLeft = options.left;
    if (options.top !== undefined) this.scrollTop = options.top;
  }
}

class FakeView extends EventTarget {
  Element = FakeElement;
  preference = { matches: false };
  matchMedia() { return this.preference; }
  getComputedStyle(element: FakeElement) { return { direction: element.direction, overflowX: element.overflowX, overflowY: element.overflowY }; }
}
class FakeDocument extends EventTarget { defaultView = new FakeView(); hidden = false; }

function setup(rtl = false) {
  const document = new FakeDocument(), viewport = new FakeElement(), rail = new FakeElement();
  viewport.ownerDocument = rail.ownerDocument = document;
  viewport.direction = rtl ? 'rtl' : 'ltr'; viewport.scrollLeft = rtl ? -300 : 100;
  const dragging: (string | null)[] = [], hovering: boolean[] = [];
  const currentMetrics = { current: metric() };
  const controller = createScrollViewportInteractions({ viewport: viewport as unknown as HTMLElement,
    readMetrics: () => currentMetrics.current, onDragging: axis => dragging.push(axis), onHovered: on => hovering.push(on) });
  return { document, viewport, rail, dragging, hovering, controller, currentMetrics };
}
function pointer(type: string, values: Partial<PointerEvent> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId: 4, pointerType: 'mouse', button: 0,
    clientX: 10 + 50 * 2, clientY: 20 + 20 * .5, ...values }) as PointerEvent;
}
function wheel(values: Partial<WheelEvent> = {}, path: EventTarget[] = []) {
  return Object.assign(new Event('wheel', { cancelable: true }), { deltaX: 0, deltaY: 20, deltaMode: 0,
    ctrlKey: false, shiftKey: false, composedPath: () => path, ...values }) as WheelEvent;
}

describe('next scroll rail geometry', () => {
  test('per-axis positive transforms preserve fractional local track pointers', () => {
    expect(resolveScrollViewportTrackPointer(metric().x, 10, 368, 111)).toEqual({ within: 50.5, scale: 2 });
    expect(resolveScrollViewportTrackPointer(metric().y, 20, 42, 31.5)).toEqual({ within: 23, scale: .5 });
    expect(resolveScrollViewportTrackPointer(metric().x, 0, 0, 10)).toBeNull();
  });
  test('track paging is bounded at ninety percent and ignores the thumb', () => {
    const x = metric().x;
    expect(resolveScrollViewportPageTarget(x, x.position / 2, 200)).toBe(0);
    expect(resolveScrollViewportPageTarget(x, x.position + x.thumb + 10, 200)).toBe(280);
    expect(resolveScrollViewportPageTarget(x, x.position + x.thumb / 2, 200)).toBeNull();
    expect(resolveScrollViewportPageTarget({ ...x, offset: 400, position: x.track - x.thumb }, x.track + 2, 200)).toBeNull();
  });
  test('drag offsets map both physical axes and clamp beyond the rail', () => {
    const x = metric().x;
    expect(resolveScrollViewportDragOffset(x, (x.track - x.thumb) / 2 + x.thumb / 2, .5)).toBe(200);
    expect(resolveScrollViewportDragOffset(x, -500, .5)).toBe(0);
    expect(resolveScrollViewportDragOffset({ ...x, thumb: x.track }, 100, .5)).toBeNull();
    expect(resolveScrollViewportDragOffset(x, NaN, .5)).toBeNull();
  });
  test('line/page wheels normalize and edge/Ctrl/native horizontal gestures pass through', () => {
    const base = { axis: 'x' as const, deltaX: 0, deltaY: 2, deltaMode: 1, width: 200, height: 100, offset: 100, maximum: 400 };
    expect(resolveScrollViewportWheelTarget(base)).toBe(132);
    expect(resolveScrollViewportWheelTarget({ ...base, deltaMode: 2 })).toBe(400);
    expect(resolveScrollViewportWheelTarget({ ...base, offset: 400 })).toBeNull();
    expect(resolveScrollViewportWheelTarget({ ...base, ctrlKey: true })).toBeNull();
    expect(resolveScrollViewportWheelTarget({ ...base, horizontalConversion: true, shiftKey: true })).toBeNull();
    expect(resolveScrollViewportWheelTarget({ ...base, horizontalConversion: true, deltaX: 3 })).toBeNull();
    expect(resolveScrollViewportWheelTarget({ ...base, horizontalConversion: true, deltaY: 0 })).toBeNull();
    expect(resolveScrollViewportWheelTarget({ ...base, horizontalConversion: true, rtl: true })).toBe(68);
    expect(resolveScrollViewportWheelTarget({ ...base, deltaX: 2, rtl: true })).toBe(132);
  });
});

describe('next scroll rail controller lifecycle', () => {
  test('smooth paging honors live reduced-motion changes and current RTL offsets', () => {
    const s = setup(true);
    s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown', { clientX: 10 + 180 * 2 }), false);
    expect(s.viewport.commands.at(-1)).toEqual({ left: -120, behavior: 'smooth' });
    s.document.defaultView.preference.matches = true;
    s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown', { clientX: 11 }), false);
    expect(s.viewport.commands.at(-1)).toEqual({ left: -300, behavior: 'instant' });
    s.controller.destroy();
  });
  for (const terminal of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'visibilitychange', 'cancel', 'destroy']) {
    test(`thumb drag restores exact inline values/priorities on ${terminal}`, () => {
      const s = setup();
      s.viewport.style.setProperty('scroll-snap-type', 'both mandatory', 'important');
      s.viewport.style.setProperty('scroll-behavior', 'smooth', 'important');
      s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown'), true);
      expect(s.viewport.style.values.get('scroll-snap-type')).toEqual(['none', 'important']);
      expect(s.viewport.style.values.get('scroll-behavior')).toEqual(['auto', 'important']);
      expect(s.dragging).toEqual(['x']);
      s.document.dispatchEvent(pointer('pointermove', { clientX: 210 }));
      expect(s.viewport.scrollLeft).toBeGreaterThan(100);
      if (terminal === 'blur') s.document.defaultView.dispatchEvent(new Event('blur'));
      else if (terminal === 'visibilitychange') { s.document.hidden = true; s.document.dispatchEvent(new Event(terminal)); }
      else if (terminal === 'cancel') s.controller.cancel();
      else if (terminal === 'destroy') s.controller.destroy();
      else (terminal === 'lostpointercapture' ? s.rail : s.document).dispatchEvent(pointer(terminal));
      expect(s.viewport.style.values.get('scroll-snap-type')).toEqual(['both mandatory', 'important']);
      expect(s.viewport.style.values.get('scroll-behavior')).toEqual(['smooth', 'important']);
      expect(s.dragging).toEqual(['x', null]); expect(s.rail.captures.size).toBe(0);
      const old = s.viewport.scrollLeft; s.document.dispatchEvent(pointer('pointermove', { clientX: 350 }));
      expect(s.viewport.scrollLeft).toBe(old);
      s.controller.destroy();
    });
  }
  test('absent inline properties are removed and viewport replacement has no old listener', () => {
    const old = setup(); old.controller.start('y', old.rail as unknown as HTMLElement, pointer('pointerdown'), true);
    old.controller.destroy();
    expect(old.viewport.style.values.size).toBe(0);
    const replacement = setup(); replacement.controller.start('y', replacement.rail as unknown as HTMLElement, pointer('pointerdown'), true);
    old.document.dispatchEvent(pointer('pointermove', { clientY: 100 }));
    expect(old.viewport.scrollTop).toBe(50); expect(replacement.viewport.scrollTop).toBe(50);
    replacement.controller.destroy();
  });
  test('unrelated pointers cannot move, terminate or steal an active drag', () => {
    const s = setup(); s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown'), true);
    s.document.dispatchEvent(pointer('pointermove', { pointerId: 9, clientX: 300 }));
    s.document.dispatchEvent(pointer('pointerup', { pointerId: 9 }));
    s.controller.start('y', s.rail as unknown as HTMLElement, pointer('pointerdown', { pointerId: 9 }), true);
    expect(s.viewport.scrollLeft).toBe(100); expect(s.dragging).toEqual(['x']);
    s.controller.destroy();
  });
  test('a stale pointer capture failure releases every listener and style lease', () => {
    const s = setup();
    s.rail.setPointerCapture = () => { throw new Error('Inactive pointer'); };
    s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown'), true);
    expect(s.viewport.style.values.size).toBe(0);
    expect(s.dragging).toEqual([null]);
    s.document.dispatchEvent(pointer('pointermove', { clientX: 300 }));
    expect(s.viewport.scrollLeft).toBe(100); s.controller.destroy();
  });
  test('rail wheels prevent default only after actual movement, including RTL', () => {
    const s = setup(true), event = wheel();
    expect(s.controller.wheel('x', event)).toBe(true); expect(event.defaultPrevented).toBe(true);
    expect(s.viewport.scrollLeft).toBe(-320);
    s.viewport.scrollLeft = -400;
    const edge = wheel(); expect(s.controller.wheel('x', edge)).toBe(false); expect(edge.defaultPrevented).toBe(false);
    s.viewport.scrollLeft = -200; s.viewport.refuseScroll = true;
    const refused = wheel(); expect(s.controller.wheel('x', refused)).toBe(false); expect(refused.defaultPrevented).toBe(false);
    s.controller.destroy();
  });
  test('nested wheel owners, editable controls and shadow/slot inactive ancestors remain native', () => {
    const s = setup(), child = new FakeElement(); child.ownerDocument = s.document;
    const event = wheel({}, [child, s.viewport]);
    expect(nestedScrollViewportConsumesWheel(s.viewport as unknown as HTMLElement, event)).toBe(true);
    expect(s.controller.wheel('x', event, true)).toBe(false); expect(event.defaultPrevented).toBe(false);
    child.scrollTop = 300;
    expect(s.controller.wheel('x', wheel({}, [child, s.viewport]), true)).toBe(true);
    child.editable = true;
    expect(s.controller.wheel('x', wheel({}, [child, s.viewport]), true)).toBe(false);
    const slot = new FakeElement(), host = new FakeElement(); host.inactive = true;
    slot.root = { host }; s.viewport.assignedSlot = slot;
    const inactive = wheel({}, [s.viewport]);
    expect(s.controller.wheel('x', inactive)).toBe(false);
    s.controller.start('y', s.rail as unknown as HTMLElement, pointer('pointerdown'), true);
    expect(s.dragging).toEqual([]); s.controller.destroy();
  });
  test('becoming inactive releases capture/snap before any additional pointer movement', () => {
    const s = setup(); s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown'), true);
    s.viewport.inactive = true; s.document.dispatchEvent(pointer('pointermove', { clientX: 300 }));
    expect(s.viewport.scrollLeft).toBe(100); expect(s.viewport.style.values.size).toBe(0);
    expect(s.dragging).toEqual(['x', null]); s.controller.destroy();
  });
  test('a held fractional thumb grip follows new viewport/content geometry and positive painted scale', () => {
    const s = setup(true), old = s.currentMetrics.current.x;
    // Grab a quarter of the way into the old physical thumb.
    const grip = .25, startWithin = old.position + old.thumb * grip;
    s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown', { clientX: 10 + startWithin * 2 }), true);
    s.currentMetrics.current = measureScrollViewport({ width: 400, height: 160, contentWidth: 1200, contentHeight: 800,
      left: -700, top: 50, rtl: true }, 'both');
    const next = s.currentMetrics.current.x, scale = 1.4;
    s.rail.painted = { left: 33, top: 42, width: next.track * scale, height: 90 };
    const within = 40 + next.thumb * grip;
    s.document.dispatchEvent(pointer('pointermove', { clientX: 33 + within * scale }));
    expect(s.viewport.scrollLeft).toBeCloseTo(40 / (next.track - next.thumb) * next.maximum - next.maximum, 6);
    expect(s.dragging).toEqual(['x']);
    expect(s.viewport.style.getPropertyValue('scroll-snap-type')).toBe('none');
    s.document.dispatchEvent(pointer('pointerup'));
    expect(s.viewport.style.values.size).toBe(0); s.controller.destroy();
  });
  test('geometry disappearing or becoming invalid cancels capture and restores snap', () => {
    for (const failure of ['no-overflow', 'zero-painted', 'nonfinite-metric', 'unavailable'] as const) {
      const s = setup(); s.viewport.style.setProperty('scroll-snap-type', 'x mandatory', 'important');
      s.controller.start('x', s.rail as unknown as HTMLElement, pointer('pointerdown'), true);
      if (failure === 'zero-painted') s.rail.painted.width = 0;
      else if (failure === 'no-overflow') s.currentMetrics.current = { ...s.currentMetrics.current, x: { ...s.currentMetrics.current.x, overflow: false } };
      else if (failure === 'nonfinite-metric') s.currentMetrics.current = { ...s.currentMetrics.current, x: { ...s.currentMetrics.current.x, maximum: NaN } };
      else s.currentMetrics.current = null as unknown as ReturnType<typeof metric>;
      s.document.dispatchEvent(pointer('pointermove', { clientX: 300 }));
      expect(s.viewport.scrollLeft).toBe(100); expect(s.rail.captures.size).toBe(0);
      expect(s.viewport.style.values.get('scroll-snap-type')).toEqual(['x mandatory', 'important']);
      expect(s.viewport.style.getPropertyValue('scroll-behavior')).toBe('');
      expect(s.dragging).toEqual(['x', null]); s.controller.destroy();
    }
  });
});
