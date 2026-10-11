/** Pure theme motion contract tests; no browser, application configuration, timers, or live services. */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { THEME_MOTION_RECIPES, THEME_MOTION_TOKENS, resolveThemeMotion } from './theme-motion';

describe('opt-in theme motion recipes', () => {
  test('keeps Zero magnetic physical springs distinct from time-based transitions', () => {
    expect(THEME_MOTION_RECIPES.magneticSidebar).toEqual({ kind: 'physical-spring', animate: true, stiffness: 350, damping: 35, mass: 1 });
    expect(THEME_MOTION_RECIPES.magneticNavigation).toEqual({ kind: 'physical-spring', animate: true, stiffness: 360, damping: 32, mass: .7 });
    expect(THEME_MOTION_RECIPES.feedbackInstant.durationMs).toBe(120);
    expect(THEME_MOTION_RECIPES.feedbackFast.durationMs).toBe(160);
    expect(THEME_MOTION_RECIPES.feedbackStandard.durationMs).toBe(240);
    expect(THEME_MOTION_RECIPES.feedbackConsidered.durationMs).toBe(480);
    expect(THEME_MOTION_RECIPES.magneticSidebar).not.toHaveProperty('durationMs');
  });

  test('preserves MorphSelect physical calibration and its nonovershooting narrowing profile', () => {
    const cases = [
      [THEME_MOTION_RECIPES.pickerOpen, 400, .12], [THEME_MOTION_RECIPES.pickerClose, 340, 0],
      [THEME_MOTION_RECIPES.pickerHighlight, 280, .08], [THEME_MOTION_RECIPES.pickerWidth, 420, .16],
      [THEME_MOTION_RECIPES.pickerWidthNarrow, 420, 0], [THEME_MOTION_RECIPES.pickerLabel, 300, .06],
    ] as const;
    for (const [recipe, visualDurationMs, bounce] of cases) {
      const angularFrequency = 2 * Math.PI / (visualDurationMs / 1000 * 1.2);
      expect(recipe.kind).toBe('physical-spring');
      expect(recipe.visualDurationMs).toBe(visualDurationMs);
      expect(recipe.bounce).toBe(bounce);
      expect(recipe.calibration).toBe('arc-angular-frequency');
      expect(recipe.stiffness).toBeCloseTo(angularFrequency ** 2, 12);
      expect(recipe.damping).toBeCloseTo(2 * (1 - bounce) * angularFrequency, 12);
      expect(recipe.mass).toBe(1);
      expect(recipe).not.toHaveProperty('durationMs');
    }
    expect(THEME_MOTION_RECIPES.pickerWidthNarrow.damping).toBeGreaterThan(THEME_MOTION_RECIPES.pickerWidth.damping);
  });

  test('records edge fades, native scroll geometry and structural hide delay independently', () => {
    expect(THEME_MOTION_RECIPES.scrollArea).toEqual({ kind: 'native-scroll-affordance', animate: true,
      fadeSizePx: 28, edgeThresholdPx: .5, hideDelayMs: 900, showDurationMs: 160, hideDurationMs: 480,
      trackHitSizePx: 11, thumbSizePx: 5, activeThumbSizePx: 7, minimumThumbLengthPx: 28,
      thumbForegroundShare: .3, activeThumbForegroundShare: .46, easing: 'cubic-bezier(.22,1,.36,1)' });
  });

  test('nearby anchored surfaces have their own restrained recipe, not modal origin or tooltip grow', () => {
    expect(THEME_MOTION_RECIPES.anchoredSurface).toMatchObject({ kind: 'anchored-surface', animate: true,
      enterDurationMs: 580, fadeDurationMs: 160, exitDurationMs: 140, offsetPx: 5, enterScale: .97, exitScale: .98 });
    expect(THEME_MOTION_RECIPES.anchoredSurface.easing).toStartWith('linear(');
    expect(THEME_MOTION_TOKENS['--zero-theme-popover-enter-duration']).toBe('580ms');
    expect(THEME_MOTION_TOKENS['--zero-theme-popover-exit-duration']).toBe('140ms');
    expect(resolveThemeMotion({ reducedMotion: true }).recipes.anchoredSurface).toMatchObject({
      animate: false, enterDurationMs: 0, fadeDurationMs: 0, exitDurationMs: 0, offsetPx: 0, enterScale: 1, exitScale: 1 });
    expect(resolveThemeMotion({ reducedMotion: true }).tokens['--zero-theme-popover-enter-duration']).toBe('0ms');
    expect(THEME_MOTION_RECIPES.tooltip.enterDurationMs).toBe(400);
    expect(THEME_MOTION_RECIPES.chartInspector.durationMs).toBe(120);
    expect(THEME_MOTION_RECIPES.modal.originEnterMs).toBe(975);
  });

  test('describes approved modal, tooltip, inspector and safety policy without rewriting legacy tokens', () => {
    const modal = THEME_MOTION_RECIPES.modal;
    expect(modal.entrance).toBe('origin'); expect(modal.fallbackEntrance).toBe('rise'); expect(modal.exit).toBe('mirror');
    expect(modal.backdrop).toBe('blur'); expect(modal.backdropBlurPx).toBe(6); expect(modal.pageRecedes).toBe(true);
    expect(modal.originEnterMs).toBe(modal.baseOriginEnterMs * modal.durationMultiplier);
    expect(modal.fallbackEnterMs).toBe(modal.baseFallbackEnterMs * modal.durationMultiplier);
    expect(modal.originEnterMs).toBe(975); expect(modal.fallbackEnterMs).toBe(900);
    expect(THEME_MOTION_RECIPES.tooltip.entrance).toBe('grow'); expect(THEME_MOTION_RECIPES.tooltip.arrow).toBe(true);
    expect(THEME_MOTION_RECIPES.tooltip.enterDurationMs).toBe(400);
    expect(THEME_MOTION_RECIPES.chartInspector.durationMs).toBe(120);
    expect(THEME_MOTION_RECIPES.holdToConfirm).toEqual({ kind: 'confirmation-interval', durationMs: 1500,
      presentationPaceApplies: false, reducedMotionApplies: false });
    for (const [key, value] of Object.entries(THEME_MOTION_TOKENS)) {
      expect(key.startsWith('--zero-theme-')).toBe(true); expect(typeof value).toBe('string'); expect(value.length).toBeGreaterThan(0);
      expect(key.startsWith('--zero-modal-')).toBe(false); expect(key.startsWith('--zero-tooltip-')).toBe(false); expect(key.startsWith('--zero-chart-')).toBe(false);
    }
  });

  test('card feedback has calibrated hover/status roles without replacing quick-look modal timing', () => {
    expect(THEME_MOTION_RECIPES.cardFeedback).toEqual({ kind: 'card-feedback', animate: true,
      hoverLiftPx: 2, mediaZoom: 1.04, hoverInMs: 960, hoverOutMs: 480, statusEnterMs: 240,
      statusExitMs: 160, statusStaggerMs: 40, statusBlurPx: 4 });
    const reduced = resolveThemeMotion({ reducedMotion: true });
    expect(reduced.recipes.cardFeedback).toMatchObject({ animate: false, hoverLiftPx: 0, mediaZoom: 1,
      hoverInMs: 0, hoverOutMs: 0, statusEnterMs: 0, statusExitMs: 0, statusStaggerMs: 0, statusBlurPx: 0 });
    expect(reduced.tokens['--zero-theme-card-status-stagger']).toBe('0ms');
    expect(reduced.tokens['--zero-theme-card-media-zoom']).toBe('1');
    expect(reduced.tokens['--zero-theme-card-status-blur']).toBe('0px');
    expect(THEME_MOTION_RECIPES.modal.originEnterMs).toBe(975);
    expect(THEME_MOTION_RECIPES.modal.fallbackEntrance).toBe('rise');
    expect(THEME_MOTION_RECIPES.holdToConfirm.durationMs).toBe(1500);
  });

  test('normal resolution is immutable and requires no global environment', () => {
    const resolved = resolveThemeMotion();
    expect(resolved.reducedMotion).toBe(false); expect(resolved.recipes).toBe(THEME_MOTION_RECIPES); expect(resolved.tokens).toBe(THEME_MOTION_TOKENS);
    expect(Object.isFrozen(resolved)).toBe(true); expect(Object.isFrozen(resolved.recipes)).toBe(true); expect(Object.isFrozen(resolved.tokens)).toBe(true);
    for (const recipe of Object.values(THEME_MOTION_RECIPES)) expect(Object.isFrozen(recipe)).toBe(true);
    const source = readFileSync(new URL('./theme-motion.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import\s/mu);
    expect(source).not.toMatch(/\b(?:window|document|matchMedia|getComputedStyle|requestAnimationFrame)\s*[.(]/u);
  });

  test('reduced motion suppresses visual travel but preserves interaction and real confirmation time', () => {
    const resolved = resolveThemeMotion({ reducedMotion: true });
    expect(resolved.reducedMotion).toBe(true);
    for (const [id, recipe] of Object.entries(resolved.recipes)) if (id !== 'holdToConfirm') expect(recipe).toHaveProperty('animate', false);
    expect(resolved.recipes.feedbackInstant.durationMs).toBe(0); expect(resolved.recipes.chartInspector.durationMs).toBe(0);
    expect(resolved.recipes.magneticSidebar.stiffness).toBe(350);
    expect(resolved.recipes.pickerOpen.stiffness).toBe(THEME_MOTION_RECIPES.pickerOpen.stiffness);
    expect(resolved.recipes.pickerOpen.visualDurationMs).toBe(400);
    expect(resolved.recipes.scrollArea.showDurationMs).toBe(0); expect(resolved.recipes.scrollArea.hideDurationMs).toBe(0);
    expect(resolved.recipes.scrollArea.hideDelayMs).toBe(900); expect(resolved.recipes.scrollArea.fadeSizePx).toBe(28);
    expect(resolved.recipes.modal.pageRecedes).toBe(false); expect(resolved.recipes.modal.originEnterMs).toBe(0);
    expect(resolved.recipes.tooltip.enterDurationMs).toBe(0); expect(resolved.recipes.tooltip.arrow).toBe(true);
    expect(resolved.recipes.tooltip.openDelayMs).toBe(450); expect(resolved.recipes.tooltip.warmDurationMs).toBe(450); expect(resolved.recipes.tooltip.graceDurationMs).toBe(70);
    expect(resolved.recipes.holdToConfirm.durationMs).toBe(1500);
    expect(resolved.tokens['--zero-theme-scroll-show-duration']).toBe('0ms'); expect(resolved.tokens['--zero-theme-scroll-hide-duration']).toBe('0ms');
    expect(resolved.tokens['--zero-theme-scroll-hide-delay']).toBe('900ms'); expect(resolved.tokens['--zero-theme-scroll-fade-size']).toBe('28px');
    expect(resolved.tokens['--zero-theme-tooltip-open-delay']).toBe('450ms'); expect(resolved.tokens['--zero-theme-hold-confirm-duration']).toBe('1500ms');
    expect(resolved.tokens['--zero-theme-modal-page-recedes']).toBe('false');
    expect(Object.isFrozen(resolved)).toBe(true); expect(Object.isFrozen(resolved.tokens)).toBe(true); expect(Object.isFrozen(resolved.recipes)).toBe(true);
    for (const recipe of Object.values(resolved.recipes)) expect(Object.isFrozen(recipe)).toBe(true);
    // Preference resolution must never mutate approved defaults for a later caller.
    expect(resolveThemeMotion().recipes.modal.originEnterMs).toBe(975); expect(THEME_MOTION_TOKENS['--zero-theme-tooltip-enter-duration']).toBe('400ms');
  });

  test('rejects malformed untyped preference input without reflecting caller data', () => {
    for (const invalid of [null, [], new Date(), 'reduce', true, { reducedMotion: 'yes' }, { reducedMotion: 1 }, { reducedMotion: null },
      { tokens: { '--zero-theme-duration-fast': 'url(unsafe)' } }, { reduceMotion: true },
      Object.defineProperty({}, 'reduceMotion', { value: true }), { [Symbol('reducedMotion')]: true }]) {
      expect(() => resolveThemeMotion(invalid as never)).toThrow('Theme motion options must contain an optional boolean reducedMotion.');
    }
    expect(resolveThemeMotion({ reducedMotion: false }).reducedMotion).toBe(false);
  });

  test('getter-backed preference is read once before validation and policy resolution', () => {
    let reads = 0;
    const resolved = resolveThemeMotion({ get reducedMotion() { return ++reads === 1; } });
    expect(reads).toBe(1);
    expect(resolved.reducedMotion).toBe(true);
    expect(resolved.recipes.modal.pageRecedes).toBe(false);
    expect(resolved.tokens['--zero-theme-duration-fast']).toBe('0ms');
    expect(resolved.tokens['--zero-theme-hold-confirm-duration']).toBe('1500ms');
    expect(resolveThemeMotion(Object.defineProperty({}, 'reducedMotion', { value: true })).reducedMotion).toBe(true);
  });

  test('CSS defaults agree with each typed recipe calibration and duration', () => {
    const pairs = [
      ['picker-open', THEME_MOTION_RECIPES.pickerOpen], ['picker-close', THEME_MOTION_RECIPES.pickerClose],
      ['picker-highlight', THEME_MOTION_RECIPES.pickerHighlight], ['picker-width', THEME_MOTION_RECIPES.pickerWidth],
      ['picker-width-narrow', THEME_MOTION_RECIPES.pickerWidthNarrow], ['picker-label', THEME_MOTION_RECIPES.pickerLabel],
    ] as const;
    for (const [prefix, recipe] of pairs) {
      expect(Number.parseFloat(THEME_MOTION_TOKENS[`--zero-theme-${prefix}-duration`]!)).toBe(recipe.visualDurationMs);
      expect(Number(THEME_MOTION_TOKENS[`--zero-theme-${prefix}-bounce`])).toBe(recipe.bounce);
    }
    expect(Number.parseFloat(THEME_MOTION_TOKENS['--zero-theme-modal-origin-enter-duration']!)).toBe(THEME_MOTION_RECIPES.modal.originEnterMs);
    expect(Number.parseFloat(THEME_MOTION_TOKENS['--zero-theme-modal-fallback-enter-duration']!)).toBe(THEME_MOTION_RECIPES.modal.fallbackEnterMs);
    expect(Number.parseFloat(THEME_MOTION_TOKENS['--zero-theme-chart-inspector-duration']!)).toBe(THEME_MOTION_RECIPES.chartInspector.durationMs);
  });
});
