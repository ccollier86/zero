/**
 * Pure reference timing, interpolation, critically damped motion and axis math.
 * Browser runtimes supply elapsed time and font metrics; no module-level DOM,
 * timers, playback sources or data subscriptions are created here.
 */
import type { RaceBarMotionSettings, RaceBarSpringState } from './race-bar-types';

/** Original frequencies and rolling-period timings, not generic CSS easing. */
export const RACE_BAR_MOTION_DEFAULTS: Readonly<RaceBarMotionSettings> = Object.freeze({ clock: 9, scrub: 22,
  row: 11, opacity: 13, tick: 14, periodEnterMs: 420, periodExitMs: 300 });

/** Component defaults preserve the reference pacing and row-count settings. */
export const RACE_BAR_DEFAULTS = Object.freeze({ bars: 8, frameDuration: 1400, autoPlay: true, loop: false,
  defaultFrame: 0, insideBelow: 400, rowHeight: 26, insideRowHeight: 30, barHeight: 18,
  insideBarHeight: 22, axisHeight: 22 });

/** Clamp a finite presentation position to a bounded history; empty history sits at zero. */
export function normalizeRaceBarPosition(position: number, frameCount: number): number {
  if (!Number.isFinite(position)) throw new Error('Race Bar position must be finite.');
  if (!Number.isSafeInteger(frameCount) || frameCount < 0) throw new Error('Race Bar frame count must be a nonnegative safe integer.');
  return Math.max(0, Math.min(Math.max(0, frameCount - 1), position));
}

/** Blend linear progress with 55% smoothstep, exactly as in the supplied reference. */
export function raceBarBlend(fraction: number): number {
  if (!Number.isFinite(fraction)) throw new Error('Race Bar blend fraction must be finite.');
  const f = Math.max(0, Math.min(1, fraction));
  return f + (f * f * (3 - 2 * f) - f) * .55;
}

/**
 * Advance a critically damped spring analytically, retaining velocity on target
 * changes. Original frequencies are preserved without the reference Euler
 * integrator's overshoot at 50ms/22Hz. Long gaps are capped at 50ms, matching the
 * reference's suspended-frame policy rather than jumping through hidden time.
 */
export function advanceRaceBarSpring(state: RaceBarSpringState, target: number, frequency: number, elapsedSeconds: number): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(state.x) || !Number.isFinite(state.v)
    || !Number.isFinite(frequency) || frequency <= 0 || frequency > 100
    || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new Error('Race Bar spring state, target and elapsed time must be finite; frequency must be in (0, 100].');
  }
  const dt = Math.min(.05, elapsedSeconds), displacement = state.x - target;
  const c = state.v + frequency * displacement, decay = Math.exp(-frequency * dt);
  const nextX = target + (displacement + c * dt) * decay;
  const nextV = (state.v - frequency * c * dt) * decay;
  if (!Number.isFinite(nextX) || !Number.isFinite(nextV)) {
    throw new Error('Race Bar spring arithmetic exceeds finite coordinates.');
  }
  state.x = nextX; state.v = nextV;
  if (Math.abs(state.x - target) < 1e-3 && Math.abs(state.v) < 1e-3) {
    state.x = target; state.v = 0; return false;
  }
  return true;
}

/** Positive reference-friendly 1/2/2.5/5/10 step, including subnormal magnitudes. */
export function raceBarNiceStep(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Race Bar tick magnitude must be finite and nonnegative.');
  if (value === 0) return 0;
  const exponent = Math.max(-323, Math.min(308, Math.floor(Math.log10(value))));
  const power = Math.max(Number.MIN_VALUE, 10 ** exponent), magnitude = value / power;
  const multiplier = magnitude <= 1.5 ? 1 : magnitude <= 2.25 ? 2 : magnitude <= 3.5 ? 2.5 : magnitude <= 7 ? 5 : 10;
  return Math.min(Number.MAX_VALUE, Math.max(Number.MIN_VALUE, power * multiplier));
}

/**
 * Bounded positive axis ticks below the leading value; no zero-domain loops,
 * unbounded floating increments or overflowing step multiples are possible.
 */
export function raceBarTicks(top: number, area: number): readonly number[] {
  if (!Number.isFinite(top) || top < 0 || !Number.isFinite(area) || area < 0) throw new Error('Race Bar tick domain and area must be finite and nonnegative.');
  if (top === 0) return [];
  const divisor = area > 320 ? 5 : 3, step = raceBarNiceStep(top / divisor || Number.MIN_VALUE);
  const ticks: number[] = [];
  for (let index = 1; index <= 16; index++) {
    const value = step * index;
    if (!Number.isFinite(value) || value / top > .985) break;
    // Keep subnormals exact: precision normalization otherwise rounds distinct
    // representable values together at the smallest positive magnitudes.
    const normalized = value < 1e-300 ? value : Number(value.toPrecision(12));
    if (normalized > 0 && (ticks.length === 0 || normalized > ticks[ticks.length - 1]!)) ticks.push(normalized);
  }
  return ticks;
}
