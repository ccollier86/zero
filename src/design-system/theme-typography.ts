/**
 * CSS-first typography catalog and consumer recipes. Owns shared text hierarchy
 * and explicit analytical compatibility profiles; does not load fonts, select
 * HTML semantics, fetch data or introduce another theme provider.
 */
import type { ThemeTokenMap } from './theme-types';

/** Arc's shared rem scale. Compact and analytical exceptions are named recipes, not extra general steps. */
export const TYPOGRAPHY_SCALE = Object.freeze({
  xs: '.75rem', sm: '.875rem', base: '1rem', lg: '1.125rem', heading: '1.375rem',
  page: '1.75rem', display: '2.25rem', hero: '3.25rem', 'display-large': '4.5rem',
});

/** One complete visual recipe; family purpose is independent of the native element or heading level. */
export interface TypographyRecipe {
  readonly family: 'body' | 'display' | 'mono' | 'inherit';
  readonly size: string;
  readonly leading: string;
  readonly weight: string;
  readonly tracking: string;
  readonly numeric: string;
}

function recipe(size: string, leading = '1.4', weight = '400', family: TypographyRecipe['family'] = 'body',
  tracking = 'normal', numeric = 'normal'): Readonly<TypographyRecipe> {
  const leadingRole = ({ '1.1': 'tight', '1.4': 'label', '1.5': 'body' } as Record<string, string>)[leading];
  const weightRole = ({ '400': 'regular', '500': 'medium', '600': 'semibold' } as Record<string, string>)[weight];
  const trackingRole = ({ '-.03em': 'heading', '-.01em': 'label' } as Record<string, string>)[tracking];
  return Object.freeze({ family, size,
    leading: leadingRole ? `var(--zero-theme-leading-${leadingRole}, ${leading})` : leading,
    weight: weightRole ? `var(--zero-theme-weight-${weightRole}, ${weight})` : weight,
    tracking: trackingRole ? `var(--zero-theme-tracking-${trackingRole}, ${tracking})` : tracking, numeric });
}

/** Shared product roles and preserved task-specific text. Existing type token values remain compatible. */
export const TYPOGRAPHY_RECIPES = Object.freeze({
  body: recipe('var(--zero-theme-type-subtitle, .875rem)', '1.5'),
  control: recipe('var(--zero-theme-type-control, .8125rem)', '1.4', '500'),
  caption: recipe('var(--zero-theme-type-caption, .75rem)'),
  support: recipe('.8125rem', '1.45'),
  label: recipe('.875rem', '1.4', '500'),
  input: recipe('1rem', '1.5'),
  'input-small': recipe('.875rem', '1.5'),
  navigation: recipe('.875rem'),
  section: recipe('1rem', '1.4', '600'),
  heading: recipe('var(--zero-theme-type-heading, 1.375rem)', '1.25', '600'),
  page: recipe('var(--zero-theme-type-page, 1.75rem)', '1.2', '600'),
  metric: recipe('var(--zero-theme-type-heading, 1.375rem)', '1.2', '600', 'body', 'normal', 'tabular-nums'),
  eyebrow: recipe('.75rem', '1.4', '500', 'body', '.06em'),
  display: recipe('var(--zero-theme-type-display, 2.25rem)', '1.1', '600', 'display', '-.03em'),
  hero: recipe('var(--zero-theme-type-hero, 3.25rem)', '1.1', '600', 'display', '-.03em'),
  'display-large': recipe('4.5rem', '1.1', '600', 'display', '-.03em'),
  reading: recipe('1rem', '1.8', '400', 'inherit'),
  'reading-title': recipe('2rem', '1.2', '600', 'inherit'),
  'reading-heading': recipe('1.5rem', '1.3', '600', 'inherit'),
  'reading-subheading': recipe('1.125rem', '1.4', '600', 'inherit'),
  technical: recipe('.8125rem', '1.75', '400', 'mono'),
  'modal-title': recipe('1.02rem', '1.35', '600', 'body', '-.01em'),
  'modal-body': recipe('.875rem', '1.5'),
  'modal-description': recipe('.86rem', '1.5'),
  'modal-meta': recipe('.8rem', '1.45'),
  tooltip: recipe('.78125rem', '1.4', '500'),
  'tooltip-title': recipe('.78125rem', '1.4', '600'),
  'tooltip-mono': recipe('.75rem', '1.45', '400', 'mono'),
  'tooltip-key': recipe('.6875rem', '1.4', '500', 'mono'),
  'analytical-title': recipe('14px', '1.4', '500'),
  'analytical-label': recipe('12.5px'),
  'analytical-readout': recipe('14px', '1.3', '500', 'body', 'normal', 'tabular-nums'),
  'analytical-metadata': recipe('11.5px'),
  inspector: recipe('var(--zero-theme-inspector-size, 12px)', 'var(--zero-theme-inspector-leading, 1.45)'),
  'inspector-value': recipe('var(--zero-theme-inspector-value-size, 17px)', 'var(--zero-theme-inspector-value-leading, 1.3)', '500', 'body', '-.01em', 'tabular-nums'),
  'list-title': recipe('.875rem', '1.4', '500'),
  'list-description': recipe('.8125rem', '1.45'),
});

/** Valid visual roles for CSS consumers and optional Text/Heading components. */
export type TypographyRole = keyof typeof TYPOGRAPHY_RECIPES;

/** Immutable role variables are part of the validated pure theme override contract. */
export const THEME_TYPOGRAPHY_TOKENS: ThemeTokenMap = Object.freeze(Object.fromEntries(
  Object.entries(TYPOGRAPHY_RECIPES).flatMap(([role, value]) =>
    (['size', 'leading', 'weight', 'tracking', 'numeric'] as const).map(property =>
      [`--zero-type-${role}-${property}`, value[property]])),
));

/** Return the stable complete recipe for tools/SSR; unknown roles fail without touching browser state. */
export function getTypographyRecipe(role: TypographyRole): Readonly<TypographyRecipe> {
  if (typeof role !== 'string' || !Object.hasOwn(TYPOGRAPHY_RECIPES, role)) throw new TypeError('Unknown typography role.');
  return TYPOGRAPHY_RECIPES[role];
}

function fontFor(family: TypographyRecipe['family']): string {
  if (family === 'inherit') return 'inherit';
  return `var(--zero-theme-font-${family}, var(--font-platform-${family === 'mono' ? 'mono' : 'sans'}, ${family === 'mono' ? 'monospace' : 'inherit'}))`;
}

/**
 * Apply marked recipes in the base layer so app utility classes/styles still win.
 * Families are consumed directly, not frozen into a root alias; nested local
 * font overrides therefore take effect without adding providers or wrappers.
 */
export function renderTypographyCss(): string {
  const scope = ':where([data-zero-theme="next"])[data-zero-theme]';
  const rules = [
    `${scope} {\n  font-family: ${fontFor('body')};\n  font-size: var(--zero-type-body-size, ${TYPOGRAPHY_RECIPES.body.size});\n` +
      '  line-height: var(--zero-type-body-leading, 1.5);\n  font-weight: var(--zero-type-body-weight, 400);\n' +
      '  letter-spacing: var(--zero-type-body-tracking, normal);\n  font-variant-numeric: var(--zero-type-body-numeric, normal);\n}',
    ...Object.entries(TYPOGRAPHY_RECIPES).map(([role, value]) =>
      `[data-zero-typography="${role}"] {\n` +
      `  font-family: ${fontFor(value.family)};\n` +
      `  font-size: var(--zero-type-${role}-size, ${value.size});\n` +
      `  line-height: var(--zero-type-${role}-leading, ${value.leading});\n` +
      `  font-weight: var(--zero-type-${role}-weight, ${value.weight});\n` +
      `  letter-spacing: var(--zero-type-${role}-tracking, ${value.tracking});\n` +
      `  font-variant-numeric: var(--zero-type-${role}-numeric, ${value.numeric});\n}`),
  ];
  return `@layer base {\n${rules.join('\n\n')}\n}`;
}
