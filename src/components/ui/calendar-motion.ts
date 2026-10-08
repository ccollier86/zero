/**
 * Shared date/calendar/time motion defaults and theme resolution.
 * Presentation consumes these values; this module neither selects dates nor
 * manages popover focus, mutations or persisted user preferences.
 */

export const CALENDAR_MOTION = Object.freeze({
  fast: 160,
  spring: 580,
  easeStandard: 'cubic-bezier(.22,1,.36,1)',
  easeSpring: 'linear(0, .0258, .09, .1763, .2732, .3724, .4683, .5573, .6376, .7082, .7689, .8202, .8628, .8976, .9256, .9476, .9648, .9778, .9875, .9945, .9994, 1.0026, 1.0047, 1.0058, 1.0062, 1.0062, 1.0059, 1.0055, 1.0049, 1.0043, 1.0036, 1.0031, 1.0025, 1.002, 1.0016, 1.0013, 1)',
});

export interface CalendarMotion {
  readonly fast: number;
  readonly spring: number;
  readonly easeStandard: string;
  readonly easeSpring: string;
}

const SPRING_FALLBACK = 'cubic-bezier(.22,1.2,.36,1)';

/** Resolve inherited theme motion at playback time, including reduced motion. */
export function resolveCalendarMotion(element: Element | null, reducedMotion?: boolean): CalendarMotion {
  const reduced = reducedMotion ?? (typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const style = element && typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  const read = (name: string) => style?.getPropertyValue(name).trim() ?? '';
  return {
    fast: reduced ? 1 : duration(read('--zero-calendar-motion-fast'), CALENDAR_MOTION.fast),
    spring: reduced ? 1 : duration(read('--zero-calendar-motion-spring'), CALENDAR_MOTION.spring),
    easeStandard: easing(read('--zero-calendar-ease-standard'), CALENDAR_MOTION.easeStandard),
    easeSpring: easing(read('--zero-calendar-ease-spring'), CALENDAR_MOTION.easeSpring, SPRING_FALLBACK),
  };
}

function duration(value: string, fallback: number): number {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/u.exec(value);
  if (!match) return fallback;
  const milliseconds = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  return Number.isFinite(milliseconds) && milliseconds <= 60_000 ? milliseconds : fallback;
}

function easing(value: string, fallback: string, unsupported = fallback): string {
  const supports = (curve: string) => typeof CSS === 'undefined'
    || typeof CSS.supports !== 'function' || CSS.supports('animation-timing-function', curve);
  if (value && supports(value)) return value;
  return supports(fallback) ? fallback : unsupported;
}
