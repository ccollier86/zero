/** Exact token parity, option admission, SSR defaults and capability fallback. */
import { expect, test } from 'bun:test';
import { MODAL_MOTION_DEFAULTS, MODAL_MOTION_EASING, MODAL_MOTION_TIMINGS, MODAL_MOTION_TIMING_TOKENS, resolveModalMotion, validateModalMotionOptions } from './modal-motion';

test('Motion Lab CSS and runtime curves/timings are exactly paired', async () => {
  const css = await Bun.file(new URL('../frontend/styles/modal-tokens.css', import.meta.url)).text();
  for (const [key, value] of Object.entries(MODAL_MOTION_TIMINGS)) {
    expect(css).toContain(`${MODAL_MOTION_TIMING_TOKENS[key as keyof typeof MODAL_MOTION_TIMINGS]}: ${value}ms;`);
  }
  for (const [name, curve] of Object.entries(MODAL_MOTION_EASING)) expect(css).toContain(`--zero-modal-ease-${name}: ${curve};`);
  expect(css).toContain('--zero-modal-width-sm: 420px;');
  expect(css).toContain('--zero-modal-width-md: 560px;');
  expect(css).toContain('--zero-modal-close-glyph: 14px;');
  expect(css).toContain('--zero-modal-close-target: 32px;');
  expect(css).toContain('--zero-modal-background: var(--popover);');
  expect(Object.isFrozen(MODAL_MOTION_DEFAULTS)).toBe(true);
});

test('approved defaults are 975ms origin, 900ms rise, 1.5 durations not velocity', () => {
  const motion = resolveModalMotion(null, {}, false);
  expect(motion).toMatchObject(MODAL_MOTION_DEFAULTS);
  expect(motion.timings).toMatchObject({ originEnter: 975, originShellFade: 210, originFade: 330, originContentDelay: 240,
    originExit: 570, originContentExit: 180, riseEnter: 900, riseFade: 390, riseExit: 390,
    backdropIn: 480, backdropOut: 390, recedeIn: 900, recedeOut: 630, stack: 675, tabs: 525, nudge: 390, ui: 120 });
  expect(motion.easing).toEqual(MODAL_MOTION_EASING);
  expect(Object.isFrozen(motion)).toBe(true); expect(Object.isFrozen(motion.timings)).toBe(true);
});

test('all presets keep exact unscaled reference durations at multiplier one', () => {
  expect(resolveModalMotion(null, { durationMultiplier: 1 }, false).timings).toEqual(MODAL_MOTION_TIMINGS);
  expect(resolveModalMotion(null, { durationMultiplier: .5 }, false).timings.originEnter).toBe(325);
  expect(resolveModalMotion(null, { durationMultiplier: 2.5 }, false).timings.originEnter).toBe(1625);
});

test('live reduced motion settles every timing to 1ms instead of the lab 150ms entrance', () => {
  const motion = resolveModalMotion(null, { durationMultiplier: 2.5 }, true);
  expect(Object.values(motion.timings).every(ms => ms === 1)).toBe(true);
});

test('bad enum/container/boolean and pace values are rejected before DOM playback', () => {
  for (const options of [null, [], 'rise', { entrance: 'unknown' }, { exit: 'unknown' }, { backdrop: 'unknown' },
    { pageRecedes: 1 }, ...[0, .49, 2.51, Infinity, Number.NaN, '1.5'].map(durationMultiplier => ({ durationMultiplier }))]) {
    expect(() => validateModalMotionOptions(options as never)).toThrow(TypeError);
  }
});

test('inherited theme values resolve at the element, with explicit call options highest', () => {
  const properties = { '--zero-modal-duration-multiplier': '2', '--zero-modal-entrance': 'drop', '--zero-modal-exit': 'fade',
    '--zero-modal-backdrop': 'dim', '--zero-modal-page-recedes': 'false', '--zero-modal-motion-rise-enter': '.8s',
    '--zero-modal-ease-out': 'linear', '--zero-modal-rise-y': '23px' };
  const element = { ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: (name: string) => properties[name as keyof typeof properties] ?? '' }),
    matchMedia: () => ({ matches: false }), CSS: { supports: () => true } } } } as unknown as Element;
  const theme = resolveModalMotion(element);
  expect(theme).toMatchObject({ entrance: 'drop', exit: 'fade', backdrop: 'dim', pageRecedes: false, durationMultiplier: 2 });
  expect(theme.timings.riseEnter).toBe(1600); expect(theme.easing.out).toBe('linear'); expect(theme.geometry.riseY).toBe(23);
  expect(resolveModalMotion(element, { entrance: 'grow', exit: 'mirror', backdrop: 'blur', pageRecedes: true, durationMultiplier: 1 }).timings.riseEnter).toBe(800);
});

test('unsupported sampled curves use only the exact specified capability fallbacks', () => {
  const element = { ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: () => '' }),
    CSS: { supports: (_property: string, value: string) => !value.startsWith('linear(') } } } } as unknown as Element;
  const motion = resolveModalMotion(element, {}, false);
  expect(motion.easing.spring).toBe('cubic-bezier(.22,1.2,.36,1)');
  expect(motion.easing.bouncy).toBe('cubic-bezier(.34,1.56,.64,1)');
});

test('malformed CSS never makes timing or geometry infinite', () => {
  const element = { ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: (name: string) =>
    name === '--zero-modal-duration-multiplier' ? 'Infinity' : name === '--zero-modal-rise-y' ? 'Infinitypx' : name === '--zero-modal-motion-rise-enter' ? '99999999s' : '' }),
    CSS: { supports: () => true } } } } as unknown as Element;
  const motion = resolveModalMotion(element, {}, false);
  expect(motion.durationMultiplier).toBe(1.5); expect(motion.timings.riseEnter).toBe(900); expect(motion.geometry.riseY).toBe(18);
});
