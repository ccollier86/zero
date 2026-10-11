/** Pure action-tray role/motion qualification; no DOM, configuration, application services or stylesheet writes. */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { THEME_FLOATING_BUTTON_GROUP_ALIASES, THEME_FLOATING_BUTTON_GROUP_PAINT, THEME_FLOATING_BUTTON_GROUP_TOKENS } from './theme-floating-button-group';
import { createThemeDeclarations, createThemeTokens, getThemeTokenCatalog } from './theme-tokens';
import { renderThemeFoundationCss } from './theme-css';
import { THEME_MOTION_RECIPES, THEME_MOTION_TOKENS, resolveThemeMotion } from './theme-motion';
import { assertThemeTokenGraph } from './theme-validation';

const ROLE = '--zero-theme-floating-button-group-';
const ALIAS = '--zero-floating-button-group-';

describe('FloatingButtonGroup scoped theme', () => {
  test('keeps all paints separate and matches both mode calibrations without literal colors', () => {
    const percentages = { light: { background: 4.5, 'tray-edge': 3, highlight: 7, 'highlight-press': 12, 'mode-tint': 12, rule: 12 },
      dark: { background: 6, 'tray-edge': 5, highlight: 9, 'highlight-press': 15, 'mode-tint': 16, rule: 12 } };
    expect(Object.keys(THEME_FLOATING_BUTTON_GROUP_PAINT.light)).toEqual(Object.keys(THEME_FLOATING_BUTTON_GROUP_PAINT.dark));
    for (const mode of ['light', 'dark'] as const) {
      const tokens = createThemeTokens({ mode });
      expect(Object.isFrozen(THEME_FLOATING_BUTTON_GROUP_PAINT[mode])).toBe(true);
      for (const [suffix, percent] of Object.entries(percentages[mode])) {
        const paint = `color-mix(in oklab, var(--zero-theme-${suffix === 'mode-tint' ? 'selection-fill' : 'text-primary'}) ${percent}%, transparent)`;
        expect(THEME_FLOATING_BUTTON_GROUP_PAINT[mode][`${ROLE}${suffix}`]).toBe(paint);
        expect(tokens[`${ROLE}${suffix}`]).toBe(paint);
      }
    }
    expect(createThemeTokens()[`${ROLE}floating-background`]).toBe('var(--zero-theme-raised)');
    expect(createThemeTokens()[`${ROLE}floating-shadow`]).toBe('var(--zero-theme-shadow-floating)');
    expect(Object.isFrozen(THEME_FLOATING_BUTTON_GROUP_PAINT)).toBe(true);
  });

  test('concentric density shapes do not borrow or shrink the global control radius or touch target', () => {
    const expected = { md: { height: 36, padding: 4, gap: 4, 'inline-padding': 12, radius: 18, 'item-radius': 13 },
      sm: { height: 30, padding: 3, gap: 3, 'inline-padding': 10, radius: 15, 'item-radius': 11 } };
    for (const size of ['md', 'sm'] as const) {
      for (const [suffix, pixels] of Object.entries(expected[size]))
        expect(Number.parseFloat(THEME_FLOATING_BUTTON_GROUP_TOKENS[`${ROLE}${size}-${suffix}`]!) * 16).toBe(pixels);
      const outer = expected[size].radius, inner = expected[size]['item-radius'];
      expect(inner).toBe(outer - expected[size].padding - 1);
      expect(inner).toBeGreaterThan(0);
    }
    for (const density of ['compact', 'comfortable', 'touch'] as const) {
      const tokens = createThemeTokens({ density });
      expect(tokens['--zero-theme-radius-control']).toBe('.375rem');
      expect(tokens[`${ROLE}hit-target-min`]).toBe('var(--zero-theme-hit-target-min)');
      for (const size of ['md', 'sm']) {
        const target = Math.max(Number.parseFloat(tokens[`${ROLE}${size}-height`]!) * 16,
          Number.parseFloat(tokens['--zero-theme-hit-target-min']!) * 16);
        expect(target).toBeGreaterThanOrEqual(density === 'touch' ? 44 : 32);
      }
    }
    expect(createThemeTokens()[`${ROLE}md-font-size`]).toBe('var(--zero-type-control-size)');
    expect(createThemeTokens()[`${ROLE}sm-font-size`]).toBe('var(--zero-type-caption-size)');
    expect(Object.isFrozen(THEME_FLOATING_BUTTON_GROUP_TOKENS)).toBe(true);
  });

  test('aliases and known overrides resolve within the complete catalog, retaining strict override admission', () => {
    const custom = { [`${ROLE}md-radius`]: '1.25rem', [`${ROLE}highlight`]: 'var(--app-action-hover, transparent)',
      [`${ROLE}label-enter-duration`]: '320ms' };
    for (const mode of ['light', 'dark'] as const) for (const reducedMotion of [false, true]) {
      const declarations = createThemeDeclarations({ mode, reducedMotion, overrides: custom });
      expect(() => assertThemeTokenGraph(declarations)).not.toThrow();
      for (const [name, value] of Object.entries(custom)) expect(declarations[name]).toBe(value);
      for (const [name, value] of Object.entries(THEME_FLOATING_BUTTON_GROUP_ALIASES)) {
        expect(name.startsWith(ALIAS)).toBe(true);
        expect(value).toBe(`var(${name.replace('--zero-', '--zero-theme-')})`);
        expect(declarations[name]).toBe(value);
      }
    }
    expect(createThemeTokens()[`${ROLE}md-radius`]).toBe('1.125rem');
    expect(custom[`${ROLE}md-radius`]).toBe('1.25rem');
    expect(() => createThemeTokens({ overrides: { [`${ROLE}unknown`]: '1px' } })).toThrow('Unknown theme token');
    expect(() => createThemeTokens({ overrides: { [`${ROLE}highlight`]: `var(${ROLE}highlight)` } })).toThrow('Cyclic');
    expect(Object.isFrozen(THEME_FLOATING_BUTTON_GROUP_ALIASES)).toBe(true);
    const catalog = getThemeTokenCatalog();
    expect(catalog.find(item => item.name === `${ROLE}highlight`)?.group).toBe('paint');
    expect(catalog.find(item => item.name === `${ROLE}md-radius`)?.group).toBe('foundation');
    expect(catalog.find(item => item.name === `${ROLE}move-duration`)?.group).toBe('motion');
  });

  test('rendered dark/system boundaries restate local material and coarse/reduced rules preserve state', () => {
    const css = renderThemeFoundationCss();
    for (const [name, value] of Object.entries(THEME_FLOATING_BUTTON_GROUP_ALIASES)) expect(css).toContain(`${name}: ${value};`);
    for (const paint of Object.values(THEME_FLOATING_BUTTON_GROUP_PAINT.dark)) expect(css).toContain(paint);
    expect(css).toContain('[data-zero-mode="dark"]');
    expect(css).toContain('[data-zero-mode="system"]');
    expect(css).toContain('--zero-theme-hit-target-min: 2.75rem;');
    expect(css).toContain(`${ROLE}label-blur: 0px;`);
    expect(css).toContain(`${ROLE}first-entry-scale: 1;`);
    expect(css).not.toContain(':root');
  });

  test('the pure theme module never starts a component, portal, global browser owner or environment read', () => {
    const source = readFileSync(new URL('./theme-floating-button-group.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"](?:react|motion|@radix-ui|.*components).*['"]/u);
    expect(source).not.toMatch(/\b(?:window|document|matchMedia|getComputedStyle|requestAnimationFrame|fetch|process\.env)\s*[.(]/u);
  });
});

describe('FloatingButtonGroup task-specific motion', () => {
  test('movement and first-entry/press are named calibrated springs, not a navigation or picker retune', () => {
    for (const [suffix, recipe, ms, bounce] of [
      ['move', THEME_MOTION_RECIPES.floatingButtonGroupMove, 420, .16],
      ['press', THEME_MOTION_RECIPES.floatingButtonGroupPress, 260, .12],
    ] as const) {
      const w = 2 * Math.PI / (ms / 1000 * 1.2);
      expect(recipe).toMatchObject({ kind: 'physical-spring', animate: true, visualDurationMs: ms, bounce, mass: 1,
        calibration: 'arc-angular-frequency' });
      expect(recipe.stiffness).toBeCloseTo(w ** 2, 12);
      expect(recipe.damping).toBeCloseTo(2 * (1 - bounce) * w, 12);
      expect(THEME_MOTION_TOKENS[`${ROLE}${suffix}-duration`]).toBe(`${ms}ms`);
      expect(Number(THEME_MOTION_TOKENS[`${ROLE}${suffix}-bounce`])).toBe(bounce);
    }
    expect(THEME_MOTION_RECIPES.floatingButtonGroupMove).not.toBe(THEME_MOTION_RECIPES.pickerWidth);
    expect(THEME_MOTION_RECIPES.magneticSidebar).toMatchObject({ stiffness: 350, damping: 35, mass: 1 });
    expect(THEME_MOTION_RECIPES.magneticNavigation).toMatchObject({ stiffness: 360, damping: 32, mass: .7 });
    expect(THEME_MOTION_RECIPES.pickerHighlight).toMatchObject({ visualDurationMs: 280, bounce: .08 });
  });

  test('material and label tracks retain independently calibrated feedback and blur', () => {
    expect(THEME_MOTION_RECIPES.floatingButtonGroupFeedback).toEqual({ kind: 'floating-button-group-feedback', animate: true,
      showDurationMs: 160, hideDurationMs: 240, pressPaintDurationMs: 120,
      firstEntryScale: .94, pressScale: .965, highlightOpacityThreshold: .15, easing: 'cubic-bezier(.22,1,.36,1)' });
    expect(THEME_MOTION_RECIPES.floatingButtonGroupLabel).toEqual({ kind: 'floating-button-group-label', animate: true,
      enterDurationMs: 240, exitDurationMs: 160, enterYpx: 4, exitYpx: -3, blurPx: 4, easing: 'cubic-bezier(.16,1,.3,1)' });
    expect(THEME_MOTION_RECIPES.tooltip).toMatchObject({ entrance: 'grow', arrow: true, enterDurationMs: 400,
      openDelayMs: 450, warmDurationMs: 450, graceDurationMs: 70 });
  });

  test('reduced motion snaps travel, scale, label blur and feedback but preserves visible state and safety intervals', () => {
    const reduced = resolveThemeMotion({ reducedMotion: true });
    expect(reduced.recipes.floatingButtonGroupMove).toMatchObject({ animate: false, visualDurationMs: 420, bounce: .16 });
    expect(reduced.recipes.floatingButtonGroupPress).toMatchObject({ animate: false, visualDurationMs: 260, bounce: .12 });
    expect(reduced.recipes.floatingButtonGroupFeedback).toMatchObject({ animate: false, showDurationMs: 0,
      hideDurationMs: 0, pressPaintDurationMs: 0, firstEntryScale: 1, pressScale: 1, highlightOpacityThreshold: .15 });
    expect(reduced.recipes.floatingButtonGroupLabel).toMatchObject({ animate: false, enterDurationMs: 0,
      exitDurationMs: 0, enterYpx: 0, exitYpx: 0, blurPx: 0 });
    for (const suffix of ['move-duration', 'press-duration', 'show-duration', 'hide-duration', 'press-paint-duration',
      'label-enter-duration', 'label-exit-duration']) expect(reduced.tokens[`${ROLE}${suffix}`]).toBe('0ms');
    for (const suffix of ['first-entry-scale', 'press-scale']) expect(reduced.tokens[`${ROLE}${suffix}`]).toBe('1');
    for (const suffix of ['label-enter-y', 'label-exit-y', 'label-blur']) expect(reduced.tokens[`${ROLE}${suffix}`]).toBe('0px');
    expect(reduced.recipes.holdToConfirm.durationMs).toBe(1500);
    expect(reduced.recipes.scrollArea.hideDelayMs).toBe(900);
    expect(resolveThemeMotion().recipes.floatingButtonGroupLabel.blurPx).toBe(4);
    expect(Object.isFrozen(reduced.recipes.floatingButtonGroupLabel)).toBe(true);
    expect(Object.isFrozen(reduced.recipes.floatingButtonGroupFeedback)).toBe(true);
  });
});
