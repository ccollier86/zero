/**
 * Resolves inherited modal theme tokens and validated presentation options.
 * This pure presentation layer owns no stores, document roots, focus or transport.
 */
import type { ModalMotionEasing, ModalMotionGeometry, ModalMotionOptions, ModalMotionSettings, ModalMotionTimings, ResolvedModalMotion } from './modal-motion-types';

/** Approved defaults: origin where usable, rise otherwise, at a 1.5 duration multiplier. */
export const MODAL_MOTION_DEFAULTS: Readonly<ModalMotionSettings> = Object.freeze({
  entrance: 'origin', exit: 'mirror', backdrop: 'blur', pageRecedes: true, durationMultiplier: 1.5,
});

/** Exact sampled Motion Lab curves with capability-only fallbacks. */
export const MODAL_MOTION_EASING: Readonly<ModalMotionEasing> = Object.freeze({
  out: 'cubic-bezier(.2,0,0,1)', in: 'cubic-bezier(.4,0,1,1)', soft: 'cubic-bezier(.16,1,.3,1)',
  spring: 'linear(0, .0258, .09, .1763, .2732, .3724, .4683, .5573, .6376, .7082, .7689, .8202, .8628, .8976, .9256, .9476, .9648, .9778, .9875, .9945, .9994, 1.0026, 1.0047, 1.0058, 1.0062, 1.0062, 1.0059, 1.0055, 1.0049, 1.0043, 1.0036, 1.0031, 1.0025, 1.002, 1.0016, 1.0013, 1)',
  bouncy: 'linear(0, .133, .41, .697, .918, 1.05, 1.1, 1.091, 1.05, 1.006, .978, .968, .973, .986, .999, 1.006, 1.007, 1.004, 1.001, 1)',
});

/** Unscaled base durations. Safety holds and control feedback are not presentation pace. */
export const MODAL_MOTION_TIMINGS: Readonly<ModalMotionTimings> = Object.freeze({
  riseEnter: 600, riseFade: 260, riseExit: 260,
  growEnter: 500, growFade: 240, growExit: 240,
  originEnter: 650, originFade: 220, originExit: 380,
  originShellFade: 140, originContentDelay: 160, originContentExit: 120,
  springEnter: 700, springFade: 200, springExit: 220,
  focusEnter: 560, focusFade: 300, focusExit: 260,
  dropEnter: 600, dropFade: 240, dropExit: 240,
  fadeExit: 180, backdropIn: 320, backdropOut: 260,
  recedeIn: 600, recedeOut: 420, stack: 450, tabs: 350, nudge: 260, ui: 120,
});

/** Exact effect geometry; radii and surfaces still come from the active Zero theme. */
export const MODAL_MOTION_GEOMETRY: Readonly<ModalMotionGeometry> = Object.freeze({
  riseY: 18, riseScale: .98, riseExitY: 10, growScale: .86, growExitScale: .92,
  springScale: .72, springExitScale: .9, focusScale: 1.06, focusBlur: 12,
  focusExitScale: 1.03, focusExitBlur: 8, dropY: -36, dropExitY: -16, fadeExitScale: .98,
  backdropBlur: 6, recedeScale: .965, recedeOrigin: '50% 30vh',
  recedeRadius: 'var(--zero-modal-recede-radius, calc(var(--radius, 6px) + 10px))',
  stackY: -12, stackScale: .04,
});

/** Maps timing names to CSS tokens for runtime resolution and parity checks. */
export const MODAL_MOTION_TIMING_TOKENS = Object.freeze(Object.fromEntries(
  Object.keys(MODAL_MOTION_TIMINGS).map(key => [key, `--zero-modal-motion-${key.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`]),
) as Record<keyof ModalMotionTimings, string>);

const entrances = new Set(['rise', 'grow', 'origin', 'spring', 'focus', 'drop']);

/** Reject malformed untyped configuration at admission without exposing its contents. */
export function validateModalMotionOptions(options: ModalMotionOptions = {}): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Modal motion options must be an object.');
  if (options.entrance !== undefined && !entrances.has(options.entrance)) throw new TypeError('Unsupported modal entrance.');
  if (options.exit !== undefined && options.exit !== 'mirror' && options.exit !== 'fade') throw new TypeError('Unsupported modal exit.');
  if (options.backdrop !== undefined && options.backdrop !== 'dim' && options.backdrop !== 'blur') throw new TypeError('Unsupported modal backdrop.');
  if (options.pageRecedes !== undefined && typeof options.pageRecedes !== 'boolean') throw new TypeError('Modal pageRecedes must be boolean.');
  if (options.durationMultiplier !== undefined && (typeof options.durationMultiplier !== 'number'
    || !Number.isFinite(options.durationMultiplier) || options.durationMultiplier < .5 || options.durationMultiplier > 2.5)) {
    throw new TypeError('Modal durationMultiplier must be finite and between 0.5 and 2.5.');
  }
}

/** Resolve values from the element's document and inherited theme; null is SSR-safe. */
export function resolveModalMotion(element: Element | null, options: ModalMotionOptions = {}, reducedMotion?: boolean): ResolvedModalMotion {
  validateModalMotionOptions(options);
  const view = element?.ownerDocument?.defaultView;
  const style = element ? (view?.getComputedStyle(element) ?? (typeof getComputedStyle === 'function' ? getComputedStyle(element) : null)) : null;
  const read = (name: string) => style?.getPropertyValue(name).trim() ?? '';
  const reduced = reducedMotion ?? view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ?? (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ?? false;
  const cssMultiplier = Number(read('--zero-modal-duration-multiplier'));
  const durationMultiplier = options.durationMultiplier ?? (Number.isFinite(cssMultiplier) && cssMultiplier >= .5 && cssMultiplier <= 2.5
    ? cssMultiplier : MODAL_MOTION_DEFAULTS.durationMultiplier);
  const cssEntrance = read('--zero-modal-entrance');
  const cssExit = read('--zero-modal-exit');
  const cssBackdrop = read('--zero-modal-backdrop');
  const settings: ModalMotionSettings = {
    entrance: options.entrance ?? (entrances.has(cssEntrance) ? cssEntrance as ModalMotionSettings['entrance'] : MODAL_MOTION_DEFAULTS.entrance),
    exit: options.exit ?? (cssExit === 'fade' || cssExit === 'mirror' ? cssExit : MODAL_MOTION_DEFAULTS.exit),
    backdrop: options.backdrop ?? (cssBackdrop === 'dim' || cssBackdrop === 'blur' ? cssBackdrop : MODAL_MOTION_DEFAULTS.backdrop),
    pageRecedes: options.pageRecedes ?? (read('--zero-modal-page-recedes') === 'false' ? false : MODAL_MOTION_DEFAULTS.pageRecedes),
    durationMultiplier,
  };
  const timings = Object.fromEntries(Object.entries(MODAL_MOTION_TIMINGS).map(([key, fallback]) => {
    const base = parseDuration(read(MODAL_MOTION_TIMING_TOKENS[key as keyof ModalMotionTimings]), fallback);
    return [key, reduced ? 1 : key === 'ui' ? base : Math.round(base * durationMultiplier)];
  })) as unknown as ModalMotionTimings;
  const supports = (property: string, value: string) => {
    const css = view?.CSS ?? (typeof CSS !== 'undefined' ? CSS : undefined);
    return !css?.supports || css.supports(property, value);
  };
  const easing = Object.fromEntries(Object.entries(MODAL_MOTION_EASING).map(([key, fallback]) => {
    const value = read(`--zero-modal-ease-${key}`);
    const curve = value && supports('animation-timing-function', value) ? value : fallback;
    const capabilityFallback = key === 'spring' ? 'cubic-bezier(.22,1.2,.36,1)' : key === 'bouncy' ? 'cubic-bezier(.34,1.56,.64,1)' : MODAL_MOTION_EASING.out;
    return [key, supports('animation-timing-function', curve) ? curve : capabilityFallback];
  })) as unknown as ModalMotionEasing;
  const geometry = { ...MODAL_MOTION_GEOMETRY };
  for (const [key, fallback] of Object.entries(MODAL_MOTION_GEOMETRY)) {
    if (typeof fallback !== 'number') continue;
    const name = `--zero-modal-${key.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`;
    const raw = read(name);
    const value = Number(raw.replace(/px$/u, ''));
    const scale = key.endsWith('Scale');
    if (raw && Number.isFinite(value) && (scale ? value >= 0 && value <= 2 : Math.abs(value) <= 1000)) {
      (geometry as unknown as Record<string, number>)[key] = value;
    }
  }
  geometry.recedeOrigin = read('--zero-modal-recede-origin') || geometry.recedeOrigin;
  geometry.recedeRadius = read('--zero-modal-recede-radius') || geometry.recedeRadius;
  return Object.freeze({ ...settings, reducedMotion: reduced, timings: Object.freeze(timings), easing: Object.freeze(easing), geometry: Object.freeze(geometry) });
}

function parseDuration(value: string, fallback: number): number {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/u.exec(value);
  if (!match) return fallback;
  const ms = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  return Number.isFinite(ms) && ms > 0 && ms <= 60_000 ? ms : fallback;
}
