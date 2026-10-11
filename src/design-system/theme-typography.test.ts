/** Pure recipe/override qualification; no provider, environment, font installation or application bootstrap. */
import { expect, test } from 'bun:test';
import { createThemeDeclarations, createThemeTokens, getThemeTokenCatalog } from './theme-tokens';
import { getTypographyRecipe, renderTypographyCss, THEME_TYPOGRAPHY_TOKENS, TYPOGRAPHY_RECIPES, TYPOGRAPHY_SCALE } from './theme-typography';
import { assertThemeTokenGraph } from './theme-validation';

test('the standard scale and complete recipes are immutable, with explicitly preserved specialty values', () => {
  expect(Object.values(TYPOGRAPHY_SCALE)).toEqual(['.75rem', '.875rem', '1rem', '1.125rem', '1.375rem', '1.75rem', '2.25rem', '3.25rem', '4.5rem']);
  expect(Object.isFrozen(TYPOGRAPHY_SCALE)).toBe(true);
  expect(Object.isFrozen(TYPOGRAPHY_RECIPES)).toBe(true);
  for (const [role, value] of Object.entries(TYPOGRAPHY_RECIPES)) {
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.keys(value)).toEqual(['family', 'size', 'leading', 'weight', 'tracking', 'numeric']);
    expect(getTypographyRecipe(role as keyof typeof TYPOGRAPHY_RECIPES)).toBe(value);
  }
  expect(getTypographyRecipe('modal-title')).toMatchObject({ size: '1.02rem', leading: '1.35', weight: 'var(--zero-theme-weight-semibold, 600)' });
  expect(getTypographyRecipe('analytical-label').size).toBe('12.5px');
  expect(getTypographyRecipe('reading')).toMatchObject({ size: '1rem', leading: '1.8', family: 'inherit' });
  expect(getTypographyRecipe('input').size).toBe('1rem');
  expect(getTypographyRecipe('input-small').size).toBe('.875rem');
  for (const role of ['missing', 'constructor', ['body'], new String('body'), null])
    expect(() => getTypographyRecipe(role as never)).toThrow('Unknown typography role');
});

test('role variables belong to the pure validated override/catalog graph while legacy primitives keep their values', () => {
  const oldDefaults = { '--zero-theme-type-body': '.8125rem', '--zero-theme-type-control': '.8125rem',
    '--zero-theme-type-section': '.9375rem', '--zero-theme-inspector-size': '12px' };
  expect(createThemeTokens()).toMatchObject(oldDefaults);
  for (const mode of ['light', 'dark'] as const) {
    const tokens = createThemeTokens({ mode });
    for (const name of Object.keys(THEME_TYPOGRAPHY_TOKENS)) expect(tokens[name]).toBeDefined();
    expect(() => assertThemeTokenGraph(createThemeDeclarations({ mode }))).not.toThrow();
  }
  const custom = createThemeDeclarations({ overrides: { '--zero-type-section-size': '1.125rem', '--zero-type-metric-weight': '500' } });
  expect(custom['--zero-type-section-size']).toBe('1.125rem');
  expect(createThemeTokens()['--zero-type-section-size']).toBe('1rem');
  expect(getThemeTokenCatalog().filter(item => item.group === 'typography')).toHaveLength(Object.keys(THEME_TYPOGRAPHY_TOKENS).length);
  expect(() => createThemeTokens({ overrides: { '--zero-type-section-size': 'var(--zero-type-section-size)' } })).toThrow('Cyclic');
});

test('marked recipes use the base layer and direct family lookup, without activating unmarked legacy roots', () => {
  const css = renderTypographyCss();
  expect(css).toBe(renderTypographyCss());
  expect(css).toStartWith('@layer base {');
  expect(css).not.toContain(':root');
  expect(css).not.toContain('!important');
  expect(css).not.toContain('@font-face');
  expect(css).toContain('font-family: var(--zero-theme-font-body, var(--font-platform-sans, inherit))');
  expect(css).toContain('font-family: var(--zero-theme-font-display, var(--font-platform-sans, inherit))');
  expect(css).toContain('font-family: var(--zero-theme-font-mono, var(--font-platform-mono, monospace))');
  for (const role of Object.keys(TYPOGRAPHY_RECIPES)) expect(css).toContain(`[data-zero-typography="${role}"]`);
});
