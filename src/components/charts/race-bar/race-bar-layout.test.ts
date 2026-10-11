/** SSR-safe responsive reference geometry and bounded font-measurement tests. */
import { describe, expect, test } from 'bun:test';
import { computeRaceBarLayout } from './race-bar-layout';
import { buildRaceBarModel } from './race-bar-model';

const model = buildRaceBarModel({ items: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
  frames: [{ period: 'January', values: { a: 100, b: 90 } }] });

describe('Race Bar layout', () => {
  test('preserves reference wide and inside geometry at the exact 400px switch', () => {
    const wide = computeRaceBarLayout(model, { width: 500, bars: 8, measureText: () => 50 });
    expect(wide).toMatchObject({ W: 500, inside: false, rowH: 26, barH: 18, axisH: 22, labelW: 70, valW: 60, x0: 70, area: 370, n: 2, H: 74 });
    const inside = computeRaceBarLayout(model, { width: 360, bars: 1, measureText: () => 50 });
    expect(inside).toMatchObject({ inside: true, rowH: 30, barH: 22, axisH: 22, labelW: 0, area: 300, n: 1, H: 52 });
    expect(computeRaceBarLayout(model, { width: 400 }).inside).toBe(false);
    expect(computeRaceBarLayout(model, { width: 399.9 }).inside).toBe(true);
  });

  test('font measurement is injected, finite and safely falls back for invalid metrics', () => {
    const measured: string[] = [];
    const geometry = computeRaceBarLayout(model, { width: 500, formatValue: value => `$${value}`, measureText: (text, kind) => { measured.push(`${kind}:${text}`); return kind === 'label' ? 120 : 70; } });
    expect(measured).toEqual(['label:Alpha', 'label:Beta', 'value:$100', 'value:$90']);
    expect(geometry.labelW).toBe(132); expect(geometry.valW).toBe(80);
    const fallback = computeRaceBarLayout(model, { width: 500, measureText: () => NaN });
    expect(Number.isFinite(fallback.area)).toBe(true); expect(fallback.itemNameWidths.get('a')).toBeGreaterThan(0);
  });

  test('very narrow/long-label geometry cannot force horizontal overflow', () => {
    for (const width of [1, 20, 80, 150, 360]) {
      const layout = computeRaceBarLayout(model, { width, measureText: () => 1e10 });
      expect(layout.labelW + layout.valW + layout.area).toBeLessThanOrEqual(width);
      expect(layout.area).toBeGreaterThanOrEqual(0);
      expect(layout.itemNameWidths.get('a')).toBeLessThanOrEqual(width);
      expect(Number.isFinite(layout.H)).toBe(true);
    }
  });

  test('empty model has stable geometry and invalid size/bar inputs reject', () => {
    const empty = buildRaceBarModel({ items: [], frames: [] });
    expect(computeRaceBarLayout(empty, { width: 300 })).toMatchObject({ n: 0, H: 22, inside: true });
    for (const width of [NaN, Infinity, 0, -1, 20_001]) expect(() => computeRaceBarLayout(model, { width })).toThrow(/width/);
    for (const bars of [0, -1, 1.2, NaN, 65]) expect(() => computeRaceBarLayout(model, { width: 300, bars })).toThrow(/visible bars/);
  });
});
