/** Shared anchored timing contracts; visual positioning and interruption are qualified in a real browser. */
import { expect, test } from 'bun:test';
import type { CSSProperties } from 'react';
import { ANCHORED_SURFACE_MOTION, anchoredSurfaceExitDuration, anchoredSurfacePresence, hasAnchoredSurfaceMotionOverride, projectAnchoredSurfaceTheme } from './anchored-surface-motion';

test('anchored defaults retain approved reference timings without affecting other motion profiles', () => {
  expect(ANCHORED_SURFACE_MOTION).toEqual({ enterDuration: 580, fadeDuration: 160, exitDuration: 140,
    reducedDuration: 120, offset: 5, enterScale: .97, exitScale: .98 });
  expect(anchoredSurfaceExitDuration(undefined, false)).toBe(140);
  expect(anchoredSurfaceExitDuration(undefined, true)).toBe(120);
  expect(anchoredSurfacePresence(undefined, false)).toEqual({ initial: false,
    animate: { '--zero-anchored-presence': 0 }, exit: { '--zero-anchored-presence': 1 },
    transition: { duration: .14, ease: 'linear' } });
});
test('bounded local timing overrides precede the inherited canonical theme and reduced motion', () => {
  const style = { '--zero-popover-exit-duration': '.25s', '--zero-theme-popover-exit-duration': '500ms',
    '--zero-popover-reduced-duration': '80ms', '--zero-theme-duration-instant': '100ms' } as CSSProperties;
  expect(anchoredSurfaceExitDuration(style, false)).toBe(250);
  expect(anchoredSurfaceExitDuration(style, true)).toBe(80);
  expect(anchoredSurfaceExitDuration({ '--zero-popover-exit-duration': '-4ms', '--zero-theme-popover-exit-duration': '200ms' } as CSSProperties, false)).toBe(200);
  expect(anchoredSurfaceExitDuration({ '--zero-popover-exit-duration': '999999s' } as CSSProperties, false)).toBe(140);
  expect(anchoredSurfaceExitDuration({ '--zero-popover-exit-duration': '0ms' } as CSSProperties, false)).toBe(0);
});
test('only explicit Motion prescriptions opt out of the shared anchored visuals', () => {
  expect(hasAnchoredSurfaceMotionOverride({})).toBe(false);
  expect(hasAnchoredSurfaceMotionOverride({ transition: undefined, initial: undefined })).toBe(false);
  for (const property of ['initial', 'animate', 'exit', 'transition', 'variants'] as const) {
    expect(hasAnchoredSurfaceMotionOverride({ [property]: property === 'initial' ? false : {} })).toBe(true);
  }
});
test('nested anchored source projection retains app tokens while Radix geometry and private presence stay local', () => {
  expect(projectAnchoredSurfaceTheme({ '--radix-popper-transform-origin': '20px 0px',
    '--radix-dropdown-menu-content-available-height': '9px', '--zero-anchored-y': '-2.5px',
    '--zero-anchored-presence': 1, '--zero-popover-offset': '7px', '--zero-theme-font-body': 'serif',
    colorScheme: 'dark', zIndex: 1402 } as CSSProperties)).toEqual({ '--zero-popover-offset': '7px',
    '--zero-theme-font-body': 'serif', colorScheme: 'dark', zIndex: 1402 } as CSSProperties);
});
