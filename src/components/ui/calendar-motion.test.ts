/** Theme-controllable shared picker motion keeps the supplied defaults and SSR safety. */
import { expect, test } from 'bun:test';
import { CALENDAR_MOTION, resolveCalendarMotion } from './calendar-motion';

test('shared CSS and WAAPI defaults retain the provided picker durations and easing', async () => {
  const css = await Bun.file(new URL('../../frontend/styles/calendar-motion-tokens.css', import.meta.url)).text();
  expect(css).toContain(`--zero-calendar-motion-fast: ${CALENDAR_MOTION.fast}ms`);
  expect(css).toContain(`--zero-calendar-motion-spring: ${CALENDAR_MOTION.spring}ms`);
  expect(css).toContain(`--zero-calendar-ease-standard: ${CALENDAR_MOTION.easeStandard}`);
  expect(css).toContain(`--zero-calendar-ease-spring: ${CALENDAR_MOTION.easeSpring}`);
  expect(resolveCalendarMotion(null, false)).toEqual(CALENDAR_MOTION);
});

test('reduced motion removes perceptible timing without removing state transitions', () => {
  expect(resolveCalendarMotion(null, true)).toMatchObject({ fast: 1, spring: 1 });
});

test('WAAPI resolves the active inherited theme rather than fixing motion at module load', () => {
  const previousStyle = globalThis.getComputedStyle;
  const previousCss = globalThis.CSS;
  let properties: Record<string, string> = {
    '--zero-calendar-motion-fast': '.2s', '--zero-calendar-motion-spring': '900ms',
    '--zero-calendar-ease-standard': 'linear', '--zero-calendar-ease-spring': 'ease-out',
  };
  try {
    globalThis.getComputedStyle = (() => ({ getPropertyValue: (name: string) => properties[name] ?? '' })) as unknown as typeof getComputedStyle;
    globalThis.CSS = { supports: (_property: string, value: string) => value !== 'invalid' } as typeof CSS;
    expect(resolveCalendarMotion({} as Element, false)).toEqual({ fast: 200, spring: 900, easeStandard: 'linear', easeSpring: 'ease-out' });
    properties = { '--zero-calendar-motion-fast': 'invalid', '--zero-calendar-motion-spring': '999999999s',
      '--zero-calendar-ease-standard': 'invalid' };
    expect(resolveCalendarMotion({} as Element, false)).toEqual(CALENDAR_MOTION);
  } finally {
    globalThis.getComputedStyle = previousStyle;
    globalThis.CSS = previousCss;
  }
});
