/** Adaptive side selection uses Floating UI geometry without bootstrapping an app. */
import { expect, test } from 'bun:test';
import type { Platform } from '@floating-ui/react';
import { createTooltipPlacementResolver } from './tooltip-placement';

class FakeStyle {
  readonly values = new Map<string, { value: string; priority: string }>();
  getPropertyValue(name: string) { return this.values.get(name)?.value ?? ''; }
  getPropertyPriority(name: string) { return this.values.get(name)?.priority ?? ''; }
  setProperty(name: string, value: string, priority = '') { this.values.set(name, { value, priority }); }
  removeProperty(name: string) { this.values.delete(name); }
}
const documentOwner = {};
class Visual {
  isConnected = true; ownerDocument = documentOwner; style = new FakeStyle(); naturalWidth = 260; textWidth = 64 * 7;
  get offsetWidth() { return Math.min(this.naturalWidth, Number.parseFloat(this.style.getPropertyValue('--radix-tooltip-content-available-width')) || 27.89); }
  get offsetHeight() { return Math.ceil(this.textWidth / Math.max(1, this.offsetWidth - 18)) * 18 + 14; }
  get scrollHeight() { return this.offsetHeight; }
  html() { return this as unknown as HTMLElement; }
}
function geometry(triggerRect = { x: 10, y: 10, width: 180, height: 35 }, clipping = { x: 0, y: 0, width: 230, height: 160 }) {
  const visual = new Visual();
  const trigger = { isConnected: true, ownerDocument: documentOwner } as unknown as Element;
  const geometryPlatform = {
    async getElementRects(this: Platform) { return { reference: triggerRect, floating: { x: 0, y: 0, ...await this.getDimensions(visual.html()) } }; },
    getClippingRect() { return clipping; },
    getDimensions() { return { width: visual.offsetWidth, height: visual.offsetHeight }; },
    convertOffsetParentRelativeRectToViewportRelativeRect({ rect }: { rect: unknown }) { return rect; },
    getOffsetParent() { return {}; },
    isElement() { return false; }, getDocumentElement() { return {}; }, getClientRects() { return []; },
    isRTL() { return false; }, getScale() { return { x: 1, y: 1 }; },
  } as unknown as Platform;
  return { trigger, visual, resolve: createTooltipPlacementResolver(geometryPlatform) };
}

test('nearly full-width trigger cannot force a 64-character hint into a 27px side sliver', async () => {
  const { trigger, visual, resolve } = geometry();
  expect(visual.offsetWidth).toBe(27.89); expect(visual.offsetHeight).toBeGreaterThan(800);
  expect(await resolve(trigger, visual.html(), { side: 'right', collisionPadding: 8 })).toBe('bottom');
  expect(await resolve(trigger, visual.html(), { side: 'left', collisionPadding: 8 })).toBe('bottom');
  expect(visual.style.values.size).toBe(0);
});

test('a readable requested side stays preferred, without unnecessarily switching axes', async () => {
  const { trigger, visual, resolve } = geometry({ x: 20, y: 120, width: 40, height: 35 }, { x: 0, y: 0, width: 800, height: 600 });
  expect(await resolve(trigger, visual.html(), { side: 'right' })).toBe('right');
});

test('opposite side is attempted before falling back onto the perpendicular axis', async () => {
  const { trigger, visual, resolve } = geometry({ x: 730, y: 120, width: 40, height: 35 }, { x: 0, y: 0, width: 800, height: 600 });
  expect(await resolve(trigger, visual.html(), { side: 'right' })).toBe('left');
});

test('top fallback wins near a boundary bottom and alignment does not lose side semantics', async () => {
  const { trigger, visual, resolve } = geometry({ x: 10, y: 120, width: 180, height: 30 });
  expect(await resolve(trigger, visual.html(), { side: 'right', align: 'end', collisionPadding: { top: 8, bottom: 8, left: 8, right: 8 } })).toBe('top');
});

test('measurement restores exact inline priorities and values rather than retaining temporary overrides', async () => {
  const { trigger, visual, resolve } = geometry();
  visual.style.setProperty('--radix-tooltip-content-available-width', '27.89px', 'important');
  visual.style.setProperty('--radix-tooltip-content-available-height', '1046px');
  const before = [...visual.style.values];
  expect(await resolve(trigger, visual.html(), { side: 'right' })).toBe('bottom');
  expect([...visual.style.values]).toEqual(before);
});

test('aborted, disconnected and cross-document ownership return the requested side without touching styles', async () => {
  const { trigger, visual, resolve } = geometry();
  const abort = new AbortController(); abort.abort();
  expect(await resolve(trigger, visual.html(), { side: 'right', signal: abort.signal })).toBe('right');
  visual.isConnected = false; expect(await resolve(trigger, visual.html(), { side: 'left' })).toBe('left');
  visual.isConnected = true; visual.ownerDocument = {}; expect(await resolve(trigger, visual.html(), { side: 'top' })).toBe('top');
  expect(visual.style.values.size).toBe(0);
});

test('measurement restores overrides even if reading dimensions throws', async () => {
  const { trigger, visual, resolve } = geometry();
  let reads = 0;
  Object.defineProperty(visual, 'offsetWidth', { get: () => { if (++reads > 1) throw new Error('Synthetic geometry failure'); return 27; } });
  await expect(resolve(trigger, visual.html(), { side: 'right' })).rejects.toThrow('Synthetic geometry failure');
  expect(visual.style.values.size).toBe(0);
});
