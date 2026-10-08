/**
 * Resolves exact Tooltip Motion Kit values through inherited Zero theme tokens.
 * This presentation module consumes only CSS/DOM capabilities; it does not own
 * content, pointer listeners, portals, focus or application state.
 */
import type { ResolvedTooltipMotion, TooltipMotionEasing, TooltipMotionGeometry, TooltipMotionOptions, TooltipMotionSettings, TooltipMotionTimings } from './tooltip-motion-types';

/** Approved platform defaults: 400ms grow, arrows enabled and semantic neutral styling. */
export const TOOLTIP_MOTION_DEFAULTS: Readonly<TooltipMotionSettings> = Object.freeze({
  motion: 'grow', durationMultiplier: 1, arrow: true, variant: 'neutral',
});

/** Exact sampled reference curves, never substituted with a library spring preset. */
export const TOOLTIP_MOTION_EASING: Readonly<TooltipMotionEasing> = Object.freeze({
  out: 'cubic-bezier(.2,0,0,1)', in: 'cubic-bezier(.4,0,1,1)', soft: 'cubic-bezier(.16,1,.3,1)',
  spring: 'linear(0, .0258, .09, .1763, .2732, .3724, .4683, .5573, .6376, .7082, .7689, .8202, .8628, .8976, .9256, .9476, .9648, .9778, .9875, .9945, .9994, 1.0026, 1.0047, 1.0058, 1.0062, 1.0062, 1.0059, 1.0055, 1.0049, 1.0043, 1.0036, 1.0031, 1.0025, 1.002, 1.0016, 1.0013, 1)',
  bouncy: 'linear(0, .133, .41, .697, .918, 1.05, 1.1, 1.091, 1.05, 1.006, .978, .968, .973, .986, .999, 1.006, 1.007, 1.004, 1.001, 1)',
});

/** Motion timings scale together; hover intent and control feedback do not scale. */
export const TOOLTIP_MOTION_TIMINGS: Readonly<TooltipMotionTimings> = Object.freeze({
  growEnter: 400, growFade: 200, growExit: 200,
  springEnter: 750, springFade: 220, springExit: 200,
  blurEnter: 500, blurExit: 220,
  swingEnter: 620, swingFade: 200, swingExit: 220,
  morphMove: 420, morphTextOut: 160, morphTextIn: 300, morphTextDelay: 80,
  openDelay: 450, warm: 450, grace: 70, ui: 120,
});

/** Exact effect amounts and placement defaults, overridable through component tokens. */
export const TOOLTIP_MOTION_GEOMETRY: Readonly<TooltipMotionGeometry> = Object.freeze({
  gap: 9, gapWithoutArrow: 6, viewportPadding: 8, arrowSize: 9, arrowOriginOffset: 5,
  springScale: .7, springExitScale: .92,
  blur: 8, blurExit: 6, blurShift: 8, blurScale: .96,
  swingScale: .6, swingShift: 14, swingExitScale: .8, swingExitShift: 8,
  swingRotation: 18, swingDrift: 16, swingStiffness: 100, swingDamping: 7,
  morphTextOutX: 8, morphTextInX: 10, morphTextBlur: 2,
});

/** CSS counterpart of every timing, for theme inheritance and parity tests. */
export const TOOLTIP_MOTION_TIMING_TOKENS = Object.freeze(Object.fromEntries(
  Object.keys(TOOLTIP_MOTION_TIMINGS).map(key => [key, `--zero-tooltip-motion-${kebab(key)}`]),
) as Record<keyof TooltipMotionTimings, string>);

const presets = new Set(['grow', 'spring', 'blur', 'swing']);
const variants = new Set(['neutral', 'accent', 'light']);
const unscaledTimings = new Set(['openDelay', 'warm', 'grace', 'ui']);
const interactionTimings = new Set(['openDelay', 'warm', 'grace']);

/** Reject malformed untyped options without reflecting consumer data into errors. */
export function validateTooltipMotionOptions(options: TooltipMotionOptions = {}): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Tooltip motion options must be an object.');
  if (options.motion !== undefined && !presets.has(options.motion)) throw new TypeError('Unsupported tooltip motion.');
  if (options.variant !== undefined && !variants.has(options.variant)) throw new TypeError('Unsupported tooltip variant.');
  if (options.arrow !== undefined && typeof options.arrow !== 'boolean') throw new TypeError('Tooltip arrow must be boolean.');
  if (options.durationMultiplier !== undefined && (typeof options.durationMultiplier !== 'number'
    || !Number.isFinite(options.durationMultiplier) || options.durationMultiplier < .5 || options.durationMultiplier > 2.5)) {
    throw new TypeError('Tooltip durationMultiplier must be finite and between 0.5 and 2.5.');
  }
}

/** Resolve theme inheritance at a trigger or surface; null is SSR-safe. */
export function resolveTooltipMotion(element: Element | null, options: TooltipMotionOptions = {}, reducedMotion?: boolean): ResolvedTooltipMotion {
  validateTooltipMotionOptions(options);
  const view = element?.ownerDocument?.defaultView;
  const style = element ? (view?.getComputedStyle(element) ?? (typeof getComputedStyle === 'function' ? getComputedStyle(element) : null)) : null;
  const read = (name: string) => style?.getPropertyValue(name).trim() ?? '';
  const reduced = reducedMotion ?? view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ?? (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ?? false;
  const cssMultiplier = Number(read('--zero-tooltip-duration-multiplier'));
  const durationMultiplier = options.durationMultiplier ?? (Number.isFinite(cssMultiplier) && cssMultiplier >= .5 && cssMultiplier <= 2.5
    ? cssMultiplier : TOOLTIP_MOTION_DEFAULTS.durationMultiplier);
  const cssMotion = read('--zero-tooltip-motion');
  const cssVariant = read('--zero-tooltip-variant');
  const settings: TooltipMotionSettings = {
    motion: options.motion ?? (presets.has(cssMotion) ? cssMotion as TooltipMotionSettings['motion'] : TOOLTIP_MOTION_DEFAULTS.motion),
    variant: options.variant ?? (variants.has(cssVariant) ? cssVariant as TooltipMotionSettings['variant'] : TOOLTIP_MOTION_DEFAULTS.variant),
    arrow: options.arrow ?? (read('--zero-tooltip-arrow') === 'false' ? false : TOOLTIP_MOTION_DEFAULTS.arrow),
    durationMultiplier,
  };
  const timings = Object.fromEntries(Object.entries(TOOLTIP_MOTION_TIMINGS).map(([key, fallback]) => {
    const base = parseDuration(read(TOOLTIP_MOTION_TIMING_TOKENS[key as keyof TooltipMotionTimings]), fallback);
    return [key, reduced && !interactionTimings.has(key) ? 1 : unscaledTimings.has(key) ? base : base * durationMultiplier];
  })) as unknown as TooltipMotionTimings;
  const supports = (property: string, value: string) => {
    const css = view?.CSS ?? (typeof CSS !== 'undefined' ? CSS : undefined);
    return !css?.supports || css.supports(property, value);
  };
  const easing = Object.fromEntries(Object.entries(TOOLTIP_MOTION_EASING).map(([key, fallback]) => {
    const value = read(`--zero-tooltip-ease-${key}`);
    const curve = value && supports('animation-timing-function', value) ? value : fallback;
    const capabilityFallback = key === 'spring' ? 'cubic-bezier(.22,1.2,.36,1)' : key === 'bouncy' ? 'cubic-bezier(.34,1.56,.64,1)' : fallback;
    return [key, supports('animation-timing-function', curve) ? curve : capabilityFallback];
  })) as unknown as TooltipMotionEasing;
  const geometry = { ...TOOLTIP_MOTION_GEOMETRY };
  for (const [key, fallback] of Object.entries(TOOLTIP_MOTION_GEOMETRY)) {
    const raw = read(`--zero-tooltip-${kebab(key)}`);
    const value = Number(raw.replace(/px$/u, ''));
    const maximum = key.endsWith('Scale') ? 2 : 1000;
    if (raw && Number.isFinite(value) && value >= 0 && value <= maximum) {
      (geometry as unknown as Record<string, number>)[key] = value;
    } else (geometry as unknown as Record<string, number>)[key] = fallback;
  }
  return Object.freeze({ ...settings, reducedMotion: reduced, timings: Object.freeze(timings), easing: Object.freeze(easing), geometry: Object.freeze(geometry) });
}

function kebab(value: string): string { return value.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`); }

function parseDuration(value: string, fallback: number): number {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/u.exec(value);
  if (!match) return fallback;
  const milliseconds = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= 60_000 ? milliseconds : fallback;
}
