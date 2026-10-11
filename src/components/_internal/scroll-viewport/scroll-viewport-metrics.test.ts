/** Native viewport decoration math, including fractional overflow, corners and physical RTL edges. */
import { expect, test } from 'bun:test';
import { measureScrollViewport } from './scroll-viewport-metrics';

test('fitting and fractional content has no fake overflow affordance', () => {
  const result = measureScrollViewport({ width: 200, height: 100, contentWidth: 200.3, contentHeight: 100.5, left: 0, top: 0 }, 'both');
  expect(result.x.overflow).toBe(false); expect(result.y.overflow).toBe(false);
  expect(result.edges).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
});
test('thumb follows actual scroll progress and reserves the intersection only for two overflowing axes', () => {
  const result = measureScrollViewport({ width: 200, height: 100, contentWidth: 400, contentHeight: 300, left: 100, top: 100 }, 'both');
  expect(result.x.track).toBe(184); expect(result.y.track).toBe(84);
  expect(result.x.thumb).toBe(92); expect(result.x.position).toBe(46);
  expect(result.y.thumb).toBe(28); expect(result.y.position).toBe(28);
  expect(result.edges).toEqual({ left: 100, right: 100, top: 100, bottom: 100 });
  expect(measureScrollViewport({ width: 200, height: 100, contentWidth: 200, contentHeight: 300, left: 0, top: 0 }).y.track).toBe(94);
});
test('RTL and overscroll clamp to physical hidden edges without reversing fades or drag progress', () => {
  const start = measureScrollViewport({ width: 100, height: 50, contentWidth: 300, contentHeight: 50, left: 0, top: 0, rtl: true }, 'horizontal');
  expect(start.edges).toMatchObject({ left: 200, right: 0 });
  const end = measureScrollViewport({ width: 100, height: 50, contentWidth: 300, contentHeight: 50, left: -250, top: -20, rtl: true }, 'both');
  expect(end.edges).toMatchObject({ left: 0, right: 200, top: 0, bottom: 0 });
  expect(end.x.position).toBe(0);
});
test('invalid or tiny geometry remains finite and never yields a thumb outside the track', () => {
  for (const width of [0, 3, Infinity, NaN, -3]) {
    const result = measureScrollViewport({ width, height: 5, contentWidth: 100, contentHeight: 1e9, left: Infinity, top: NaN }, 'both');
    expect(Number.isFinite(result.x.position)).toBe(true);
    expect(result.y.thumb).toBeLessThanOrEqual(result.y.track);
    expect(result.y.position).toBeGreaterThanOrEqual(0);
  }
});
