/**
 * Pure Funnel presentation math and reference formatting. Elapsed time and
 * mutable coordinates are supplied by the runtime; this file creates no RAF,
 * timers, browser globals, transport or data subscriptions.
 */
import type { FunnelSpringOptions, FunnelSpringState } from './funnel-types';

/** Reference spring frequencies and motion-independent illustrative flow defaults. */
export const FUNNEL_MOTION_DEFAULTS = Object.freeze({ thickness: 11, gap: 11, growth: 6,
  count: 10, column: 14, columnOpacity: 16, color: 12, inspector: 14,
  controlMs: 320, feedbackMs: 120, flowSeconds: 5.5, particleCount: 40, particleRadius: 1.6 });

/**
 * Advance a critically damped spring without Euler instability. Long gaps are
 * capped at 50ms; velocity survives target changes. Normalized arithmetic
 * supports very large finite counts, with unrepresentable velocity saturated
 * rather than introducing Infinity into rendering.
 */
export function advanceFunnelSpring(state: FunnelSpringState, target: number, frequency: number, elapsedSeconds: number,
  options: FunnelSpringOptions = {}): boolean {
  const tolerance = options.tolerance ?? 0.01;
  if (!Number.isFinite(target) || !Number.isFinite(state.x) || !Number.isFinite(state.v)
    || !Number.isFinite(frequency) || frequency <= 0 || frequency > 100
    || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 1) {
    throw new Error('Funnel spring coordinates and time must be finite; frequency must be in (0, 100].');
  }
  const threshold = tolerance * (options.relative ? Math.max(1, Math.abs(target)) : 1);
  const dt = Math.min(0.05, elapsedSeconds);
  if (!dt) return Math.abs(state.x - target) >= threshold || Math.abs(state.v) >= threshold;
  const scale = Math.max(Math.abs(state.x), Math.abs(target), Math.abs(state.v), 1);
  const start = state.x / scale, end = target / scale, velocity = state.v / scale;
  const displacement = start - end, c = velocity + frequency * displacement;
  const decay = Math.exp(-frequency * dt), next = end + (displacement + c * dt) * decay;
  const nextVelocity = (velocity - frequency * c * dt) * decay;
  const finite = (value: number): number => Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));
  state.x = finite(next * scale); state.v = finite(nextVelocity * scale);
  if (Math.abs(state.x - target) < threshold && Math.abs(state.v) < threshold) {
    state.x = target; state.v = 0; return false;
  }
  return true;
}

/** Compact nonnegative counts in the reference K/M style without numeric coercion. */
export function funnelCompact(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Funnel formatted counts must be finite and nonnegative.');
  return value >= 1e6 ? `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
    : value >= 1e3 ? `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K` : String(Math.round(value));
}

/** Render an exact known retention rate; null explicitly labels a missing baseline. */
export function funnelPercent(rate: number | null, unknownLabel = '—'): string {
  if (rate === null) return unknownLabel;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('Funnel percentages require a rate between 0 and 1, or null.');
  return `${rate > 0 && rate < 0.1 ? (rate * 100).toFixed(1) : Math.round(rate * 100)}%`;
}
