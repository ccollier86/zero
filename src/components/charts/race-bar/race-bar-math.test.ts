/** Pure reference interpolation, critically damped integration and numeric-axis tests. */
import { describe, expect, test } from 'bun:test';
import { advanceRaceBarSpring, normalizeRaceBarPosition, raceBarBlend, raceBarNiceStep, raceBarTicks,
  RACE_BAR_DEFAULTS, RACE_BAR_MOTION_DEFAULTS } from './race-bar-math';

describe('Race Bar reference math', () => {
  test('preserves every original spring and rolling-period timing', () => {
    expect(RACE_BAR_MOTION_DEFAULTS).toEqual({ clock: 9, scrub: 22, row: 11, opacity: 13, tick: 14, periodEnterMs: 420, periodExitMs: 300 });
    expect(RACE_BAR_DEFAULTS).toMatchObject({ bars: 8, frameDuration: 1400, autoPlay: true, loop: false, insideBelow: 400,
      rowHeight: 26, insideRowHeight: 30, barHeight: 18, insideBarHeight: 22, axisHeight: 22 });
    expect(raceBarBlend(0)).toBe(0); expect(raceBarBlend(1)).toBe(1); expect(raceBarBlend(.5)).toBe(.5);
    expect(raceBarBlend(.25)).toBeCloseTo(.1984375, 10); expect(raceBarBlend(.75)).toBeCloseTo(.8015625, 10);
    expect(raceBarBlend(-1)).toBe(0); expect(raceBarBlend(2)).toBe(1);
    expect(() => raceBarBlend(Infinity)).toThrow(/finite/);
  });

  test('clamps requested history positions, including zero frames', () => {
    expect(normalizeRaceBarPosition(-1, 12)).toBe(0); expect(normalizeRaceBarPosition(13, 12)).toBe(11);
    expect(normalizeRaceBarPosition(2.5, 12)).toBe(2.5); expect(normalizeRaceBarPosition(3, 0)).toBe(0);
    expect(() => normalizeRaceBarPosition(NaN, 12)).toThrow(/finite/);
    expect(() => normalizeRaceBarPosition(0, 1.2)).toThrow(/safe integer/);
  });

  test('critical springs at reference frequencies remain monotonic without overshoot at 50ms', () => {
    for (const frequency of [9, 22, 11, 13, 14]) {
      const state = { x: 0, v: 0 };
      let prior = 0, moving = true;
      for (let step = 0; step < 100; step++) {
        moving = advanceRaceBarSpring(state, 100, frequency, .05);
        expect(state.x).toBeGreaterThanOrEqual(prior); expect(state.x).toBeLessThanOrEqual(100);
        expect(Number.isFinite(state.v)).toBe(true); prior = state.x;
      }
      expect(state.x).toBe(100); expect(state.v).toBe(0); expect(moving).toBe(false);
    }
  });

  test('analytic springs are frame-size independent, keep target-change velocity, and cap hidden gaps', () => {
    const fine = { x: 0, v: 0 }, coarse = { x: 0, v: 0 };
    for (let i = 0; i < 20; i++) advanceRaceBarSpring(coarse, 100, 9, .05);
    for (let i = 0; i < 100; i++) advanceRaceBarSpring(fine, 100, 9, .01);
    expect(fine.x).toBeCloseTo(coarse.x, 9); expect(fine.v).toBeCloseTo(coarse.v, 9);
    const prior = { ...coarse }; advanceRaceBarSpring(coarse, -10, 9, 0);
    expect(coarse).toEqual(prior);
    const long = { x: 0, v: 0 }, short = { x: 0, v: 0 };
    advanceRaceBarSpring(long, 5, 22, 1); advanceRaceBarSpring(short, 5, 22, .05);
    expect(long).toEqual(short);
  });

  test('invalid arithmetic cannot corrupt spring state', () => {
    const state = { x: 1e308, v: 0 }, before = { ...state };
    expect(() => advanceRaceBarSpring(state, -1e308, 22, .05)).toThrow(/finite coordinates/); expect(state).toEqual(before);
    for (const invalid of [NaN, Infinity, -1, 0, 101]) expect(() => advanceRaceBarSpring({ x: 0, v: 0 }, 1, invalid, .01)).toThrow(/frequency/);
    expect(() => advanceRaceBarSpring({ x: 0, v: 0 }, 1, 9, -1)).toThrow(/elapsed/);
  });
});

describe('Race Bar ticks', () => {
  test('uses the reference 1/2/2.5/5/10 nice step thresholds', () => {
    expect([1.4, 2.2, 3.4, 6, 8].map(raceBarNiceStep)).toEqual([1, 2, 2.5, 5, 10]);
    expect(raceBarTicks(100, 400)).toEqual([20, 40, 60, 80]);
    expect(raceBarTicks(100, 250)).toEqual([25, 50, 75]);
    expect(raceBarTicks(0, 400)).toEqual([]); expect(raceBarNiceStep(0)).toBe(0);
  });

  test('zero, subnormal and maximal domains are finite, unique and work bounded', () => {
    for (const top of [Number.MIN_VALUE, Number.MIN_VALUE * 10, 1e-320, 1e-300, 1e-10, 100, 1e308, Number.MAX_VALUE]) {
      for (const area of [0, 100, 400]) {
        const ticks = raceBarTicks(top, area);
        expect(ticks.length).toBeLessThanOrEqual(16);
        expect(ticks.every(value => Number.isFinite(value) && value > 0 && value / top <= .985)).toBe(true);
        expect(new Set(ticks).size).toBe(ticks.length);
        expect(raceBarNiceStep(top)).toBeGreaterThan(0); expect(Number.isFinite(raceBarNiceStep(top))).toBe(true);
      }
    }
    expect(() => raceBarTicks(Infinity, 300)).toThrow(/finite/);
    expect(() => raceBarTicks(5, -1)).toThrow(/nonnegative/);
  });
});
