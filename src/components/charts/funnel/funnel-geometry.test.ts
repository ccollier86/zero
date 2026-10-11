/** Qualifies reference Funnel geometry without a browser or fabricated event source. */
import { describe, expect, test } from 'bun:test';
import { computeFunnelEdges, funnelBandPath, funnelEdgeAt, funnelStageAt } from './funnel-geometry';
import { computeFunnelLayout, computeFunnelTargets, FUNNEL_LAYOUT_DEFAULTS } from './funnel-layout';
import { buildFunnelModel } from './funnel-model';
import { advanceFunnelSpring, funnelCompact, funnelPercent } from './funnel-math';

const model = buildFunnelModel({ segments: [{ id: 'mobile' }, { id: 'desktop' }],
  stages: [{ id: 'start', values: { mobile: 70, desktop: 30 } }, { id: 'middle', values: { mobile: 35, desktop: 15 } }, { id: 'end', values: { mobile: 7, desktop: 9 } }] });

describe('Funnel layout and smooth boundaries', () => {
  test('preserves reference wide and upright geometry exactly at normal widths', () => {
    const wide = computeFunnelLayout(3, { width: 600 });
    expect(wide.vertical).toBe(false); expect(wide.headerHeight).toBe(70); expect(wide.cross).toBe(170);
    expect(wide.stepSize).toBe(200); expect(wide.transitionZone).toBe(60); expect(wide.height).toBe(262);
    expect(wide.mapPoint(20, 40)).toEqual([20, 110]);
    const upright = computeFunnelLayout(5, { width: 328 });
    expect(upright.vertical).toBe(true); expect(upright.labelWidth).toBe(138); expect(upright.cross).toBe(176);
    expect(upright.stepSize).toBe(84); expect(upright.height).toBe(426); expect(upright.mapPoint(20, 40)).toEqual([40, 20]);
    expect(computeFunnelLayout(3, { width: 419 }).vertical).toBe(true);
    expect(computeFunnelLayout(3, { width: 420 }).vertical).toBe(false);
    expect(computeFunnelLayout(3, { width: 600, orientation: 'vertical' }).vertical).toBe(true);
    expect(computeFunnelLayout(3, { width: 300, orientation: 'horizontal' }).vertical).toBe(false);
    expect(FUNNEL_LAYOUT_DEFAULTS.splitGap).toBe(2);
  });

  test('view targets scale total and isolated baselines truthfully, with the split gap', () => {
    const layout = computeFunnelLayout(3, { width: 600 });
    const total = computeFunnelTargets(model, layout, { kind: 'total' });
    expect(total[0]![0]).toBeCloseTo(119); expect(total[0]![1]).toBeCloseTo(51);
    expect(total[1]![0]).toBeCloseTo(59.5); expect(total[1]![1]).toBeCloseTo(25.5);
    const split = computeFunnelTargets(model, layout, { kind: 'split' });
    expect(split[0]![0]).toBeCloseTo(117.6); expect(split[0]![1]).toBeCloseTo(50.4);
    const isolated = computeFunnelTargets(model, layout, { kind: 'segment', id: 'desktop' });
    expect(isolated[0]).toEqual([0, 170]); expect(isolated[1]).toEqual([0, 85]); expect(isolated[2]).toEqual([0, 51]);
    const zero = buildFunnelModel({ stages: [{ id: 'a', value: 0 }, { id: 'b', value: 0 }] });
    expect(computeFunnelTargets(zero, layout, { kind: 'total' })).toEqual([[0], [0]]);
  });

  test('centers flat stage cells with exact two-pixel split separation', () => {
    const edges = computeFunnelEdges([[120, 48], [60, 24]], 170, 2);
    expect(edges[0]!.top).toEqual([0, 42]); expect(edges[0]!.bottom).toEqual([120, 102]);
    expect(edges[1]!.top).toEqual([122, 104]); expect(edges[1]!.bottom).toEqual([170, 128]);
    expect(Object.isFrozen(edges[0]!.top)).toBe(true);
    const collapsed = computeFunnelEdges([[120, 48]], 170, 2, 0);
    expect(collapsed[0]!.top).toEqual([85]); expect(collapsed[1]!.bottom).toEqual([85]);
    const zeroSlot = computeFunnelEdges([[0, 170]], 170, 2);
    expect(zeroSlot[0]!.top).toEqual([0]); expect(zeroSlot[1]!.bottom).toEqual([170]);
  });

  test('smooth cubic path preserves orientation and point sampling across boundaries', () => {
    const layout = computeFunnelLayout(3, { width: 600 }), edges = { top: [0, 40, 70], bottom: [170, 130, 100] };
    const path = funnelBandPath(edges, layout);
    expect(path).toStartWith('M0,70L140,70C200,70 200,110 260,110');
    expect(path).toEndWith('L0,240Z'); expect(path).not.toMatch(/NaN|Infinity|undefined/);
    expect(funnelEdgeAt(edges.top, 20, layout)).toBe(0); expect(funnelEdgeAt(edges.top, 300, layout)).toBe(40);
    expect(funnelEdgeAt(edges.top, 200, layout)).toBeCloseTo(20, 2);
    expect(funnelEdgeAt(edges.top, -200, layout)).toBe(0); expect(funnelEdgeAt(edges.top, 900, layout)).toBe(70);
    const upright = computeFunnelLayout(3, { width: 328 });
    expect(funnelBandPath(edges, upright)).toStartWith('M0,0'); expect(funnelBandPath({ top: [], bottom: [] }, upright)).toBe('');
    expect(funnelStageAt(layout, 220, 10, 3)).toBe(1); expect(funnelStageAt(upright, 10, 100, 3)).toBe(1);
    expect(funnelStageAt(layout, -10, 0, 3)).toBe(0); expect(funnelStageAt(layout, 900, 0, 3)).toBe(2);
    expect(funnelStageAt(layout, 10, 10, 0)).toBeNull();
  });

  test('handles empty, zero-width and narrow geometry without a demo minimum or overflow', () => {
    for (const width of [0, 1, 20, 100, 328, 600, 16384]) {
      const layout = computeFunnelLayout(0, { width });
      expect(layout.width).toBe(width); expect(Number.isFinite(layout.height)).toBe(true); expect(layout.height).toBeGreaterThan(0);
      expect(layout.cross).toBeGreaterThanOrEqual(0);
      if (layout.vertical) expect(layout.cross + layout.labelWidth + layout.labelGap).toBeLessThanOrEqual(width);
    }
    const layout = computeFunnelLayout(1, { width: 0 });
    expect(funnelBandPath({ top: [0], bottom: [0] }, layout)).not.toMatch(/NaN|Infinity/);
    const overshooting = computeFunnelEdges([[170, 170], [Number.MAX_VALUE, Number.MAX_VALUE]], 170, 2);
    for (const edge of overshooting) for (const coordinate of [...edge.top, ...edge.bottom]) {
      expect(coordinate).toBeGreaterThanOrEqual(0); expect(coordinate).toBeLessThanOrEqual(170);
    }
  });

  test('rejects invalid layout, paths and supplied geometry', () => {
    for (const width of [NaN, Infinity, -1, 16385]) expect(() => computeFunnelLayout(3, { width })).toThrow();
    for (const height of [NaN, Infinity, 0, -1, 4097]) expect(() => computeFunnelLayout(3, { width: 600, height })).toThrow();
    for (const count of [0.5, -1, 33]) expect(() => computeFunnelLayout(count, { width: 600 })).toThrow();
    expect(() => computeFunnelEdges([[1], [1, 2]], 170)).toThrow();
    expect(() => computeFunnelEdges([[NaN]], 170)).toThrow(); expect(() => computeFunnelEdges([[1]], 170, 2, Infinity)).toThrow();
    const layout = computeFunnelLayout(3, { width: 600 });
    expect(() => funnelBandPath({ top: [1], bottom: [1, 2] }, layout)).toThrow();
    expect(() => funnelEdgeAt([1, Infinity], 10, layout)).toThrow(); expect(() => funnelEdgeAt([1], NaN, layout)).toThrow();
    expect(() => funnelStageAt(layout, Infinity, 0, 3)).toThrow();
  });

  test('scales huge and subnormal cohorts before multiplying pixels', () => {
    const layout = computeFunnelLayout(2, { width: 600 });
    for (const value of [Number.MAX_VALUE, Number.MIN_VALUE * 2]) {
      const model = buildFunnelModel({ stages: [{ id: 'a', value }, { id: 'b', value: value / 2 }] });
      expect(computeFunnelTargets(model, layout, { kind: 'total' })).toEqual([[170], [85]]);
    }
  });
});

describe('Funnel spring and formatter math', () => {
  test('critical damping preserves velocity, converges without Euler overshoot, caps long gaps', () => {
    const state = { x: 0, v: 0 };
    for (let i = 0; i < 100; i++) { advanceFunnelSpring(state, 170, 11, 0.05); expect(state.x).toBeGreaterThanOrEqual(0); expect(state.x).toBeLessThanOrEqual(170); }
    expect(state).toEqual({ x: 170, v: 0 });
    advanceFunnelSpring(state, 85, 11, 0.05); expect(state.v).toBeLessThan(0);
    const a = { x: 0, v: 0 }, b = { x: 0, v: 0 };
    advanceFunnelSpring(a, 100, 11, 5); advanceFunnelSpring(b, 100, 11, 0.05); expect(a).toEqual(b);
  });

  test('normalized arithmetic and optional relative settling support extreme aggregate updates', () => {
    const state = { x: 0, v: 0 };
    let moving = true;
    for (let i = 0; i < 400 && moving; i++) {
      moving = advanceFunnelSpring(state, 1e308, 10, 0.05, { tolerance: 1e-9, relative: true });
      expect(Number.isFinite(state.x)).toBe(true); expect(Number.isFinite(state.v)).toBe(true);
    }
    expect(moving).toBe(false); expect(state).toEqual({ x: 1e308, v: 0 });
    expect(advanceFunnelSpring({ x: 0, v: 0 }, 0, 10, 0)).toBe(false);
    for (const dt of [NaN, Infinity, -1]) expect(() => advanceFunnelSpring({ x: 0, v: 0 }, 1, 10, dt)).toThrow();
    expect(() => advanceFunnelSpring({ x: 0, v: 0 }, 1, 0, 0.01)).toThrow();
    expect(() => advanceFunnelSpring({ x: 0, v: 0 }, 1, 10, 0.01, { tolerance: 0 })).toThrow();
  });

  test('preserves reference numeric density, with explicit unknown percentages', () => {
    expect([0, 999, 1000, 1250, 100_000, 1e6, 1.25e6, 10e6].map(funnelCompact)).toEqual(['0', '999', '1K', '1.3K', '100K', '1M', '1.3M', '10M']);
    expect([null, 0, 0.037, 0.5, 1].map(value => funnelPercent(value))).toEqual(['—', '0%', '3.7%', '50%', '100%']);
    expect(funnelPercent(null, 'Unknown')).toBe('Unknown');
    expect(() => funnelPercent(2)).toThrow(); expect(() => funnelCompact(-1)).toThrow();
  });
});
