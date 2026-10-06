import { describe, expect, test } from 'bun:test';
import { getSignaturePadBounds, getSignaturePadStrokePath } from './signature-geometry';
import type { SignaturePadStroke } from './signature-pad.types';

describe('signature outline geometry', () => {
  test('empty ink has no path and no bounds', () => {
    expect(getSignaturePadStrokePath({ points: [] })).toBe('');
    expect(getSignaturePadBounds([])).toBeNull();
    expect(getSignaturePadBounds([{ points: [] }])).toBeNull();
  });

  test('a tap draws a round closed dot, not an invisible zero-length segment', () => {
    const stroke: SignaturePadStroke = { points: [[10, 20, 4]] };
    expect(getSignaturePadStrokePath(stroke)).toBe('M8 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z');
    expect(getSignaturePadBounds([stroke])).toEqual({ x: 8, y: 18, width: 4, height: 4 });
  });

  test('subpixel ink still has nonzero caps and matching bounds', () => {
    const stroke: SignaturePadStroke = { points: [[0, 0, 0.01]] };
    expect(getSignaturePadStrokePath(stroke)).toContain('a0.25 0.25');
    expect(getSignaturePadBounds([stroke])).toEqual({ x: -0.25, y: -0.25, width: 0.5, height: 0.5 });
  });

  test('a straight pressure-varying stroke has a closed nonzero outline', () => {
    const stroke: SignaturePadStroke = { points: [[0, 0, 2], [10, 0, 4], [20, 0, 6]] };
    const d = getSignaturePadStrokePath(stroke);
    expect(d.startsWith('M0 1')).toBe(true);
    expect(d).toContain('Q10 2');
    expect(d).toContain('A3 3 0 0 0 20 -3');
    expect(d.endsWith('Z')).toBe(true);
    expect(getSignaturePadBounds([stroke])).toEqual({ x: -1, y: -3, width: 24, height: 6 });
  });

  test('a sharp reversal splits into capped outlines instead of pinching the tangent', () => {
    const d = getSignaturePadStrokePath({ points: [[0, 0, 2], [10, 0, 2], [0, 1, 2]] });
    expect(d.match(/Z/g)?.length).toBe(2);
    expect(d.match(/M/g)?.length).toBe(2);
  });

  test('a normal corner retains a continuous outline', () => {
    const d = getSignaturePadStrokePath({ points: [[0, 0, 2], [10, 0, 2], [10, 10, 2]] });
    expect(d.match(/Z/g)?.length).toBe(1);
    expect(d.match(/M/g)?.length).toBe(1);
  });

  test('repeated points and crossing curves have finite, nonzero paths', () => {
    const cases: readonly SignaturePadStroke[] = [
      { points: [[5, 5, 2], [5, 5, 3], [5, 5, 4]] },
      { points: [[0, 0, 1], [10, 10, 2], [0, 10, 3], [10, 0, 4], [0, 0, 1]] },
    ];
    for (const stroke of cases) {
      const d = getSignaturePadStrokePath(stroke);
      expect(d).not.toMatch(/NaN|Infinity|undefined/);
      expect(d).toMatch(/^M.+Z$/);
    }
  });

  test('large positive/negative coordinates remain finite and include full radii', () => {
    const stroke: SignaturePadStroke = { points: [[-1_000_000, 1_000_000, 256], [1_000_000, -1_000_000, 256]] };
    expect(getSignaturePadStrokePath(stroke)).not.toMatch(/NaN|Infinity|e\+/);
    expect(getSignaturePadBounds([stroke])).toEqual({ x: -1_000_128, y: -1_000_128, width: 2_000_256, height: 2_000_256 });
  });

  test('bounds combine widths from every point and every stroke', () => {
    expect(getSignaturePadBounds([
      { points: [[10, 20, 2], [30, 20, 10]] },
      { points: [[-5, -10, 4]] },
    ])).toEqual({ x: -7, y: -12, width: 42, height: 37 });
  });

  test('does not mutate source points while deriving outline and bounds', () => {
    const stroke: SignaturePadStroke = { points: [[1, 2, 3], [4, 5, 6]] };
    const before = structuredClone(stroke);
    getSignaturePadStrokePath(stroke);
    getSignaturePadBounds([stroke]);
    expect(stroke).toEqual(before);
  });
});
