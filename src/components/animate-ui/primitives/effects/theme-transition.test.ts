import { describe, expect, test } from 'bun:test';

import {
  getCircularClipKeyframes,
  getFallbackOrigin,
} from './theme-transition';

describe('theme transition geometry', () => {
  test('expands far enough to cover every viewport corner', () => {
    expect(
      getCircularClipKeyframes(
        { x: 50, y: 40 },
        { width: 100, height: 80 },
      ),
    ).toEqual([
      'circle(0px at 50px 40px)',
      'circle(65px at 50px 40px)',
    ]);

    expect(
      getCircularClipKeyframes(
        { x: 0, y: 40 },
        { width: 100, height: 80 },
      ),
    ).toEqual([
      'circle(0px at 0px 40px)',
      'circle(108px at 0px 40px)',
    ]);
  });

  test('clamps pointer coordinates to the visible viewport', () => {
    expect(
      getCircularClipKeyframes(
        { x: -50, y: 200 },
        { width: 100, height: 80 },
      ),
    ).toEqual([
      'circle(0px at 0px 80px)',
      'circle(129px at 0px 80px)',
    ]);
  });

  test('keeps direction as the fallback-origin compatibility contract', () => {
    const viewport = { width: 1200, height: 800 };

    expect(getFallbackOrigin('ltr', viewport)).toEqual({ x: 0, y: 400 });
    expect(getFallbackOrigin('rtl', viewport)).toEqual({ x: 1200, y: 400 });
    expect(getFallbackOrigin('ttb', viewport)).toEqual({ x: 600, y: 0 });
    expect(getFallbackOrigin('btt', viewport)).toEqual({ x: 600, y: 800 });
  });
});
