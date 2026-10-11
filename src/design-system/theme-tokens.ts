/** Pure token composition/catalog facade; palette/density choices are explicit and no globals, DOM or CSS are installed. */
import { THEME_DARK_COLORS, THEME_LIGHT_COLORS } from './theme-colors';
import { THEME_BASE_TOKENS, THEME_DARK_ELEVATION, THEME_DENSITY_TOKENS, THEME_FOUNDATION_ID, THEME_LIGHT_ELEVATION } from './theme-foundation';
import { THEME_COMPONENT_ALIASES, THEME_COMPATIBILITY_ALIASES, THEME_LEGACY_CHART_COLORS, THEME_MODE_COMPONENT_PAINT } from './theme-compatibility';
import { resolveThemeMotion } from './theme-motion';
import { THEME_UTILITY_ALIASES } from './theme-utility-aliases';
import { THEME_TYPOGRAPHY_TOKENS } from './theme-typography';
import { THEME_FLOATING_BUTTON_GROUP_ALIASES, THEME_FLOATING_BUTTON_GROUP_PAINT, THEME_FLOATING_BUTTON_GROUP_TOKENS } from './theme-floating-button-group';
import { applyThemeTokenOverrides, assertThemeTokenGraph } from './theme-validation';
import type { ThemeAttributeOptions, ThemeTokenMap, ThemeTokenOptions } from './theme-types';

function assertOptions(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key)))
    throw new TypeError('Invalid theme options.');
}

/** Read trusted getter-backed configuration once so foundation and compatibility paint share the same selection. */
function snapshotOptions<T extends object>(value: T, keys: readonly string[]): T {
  assertOptions(value, keys);
  return Object.fromEntries(Object.getOwnPropertyNames(value).map(name => [name, Reflect.get(value, name)])) as T;
}

/** Return an immutable resolved foundation. Mode must be concrete for SSR; system choice belongs to the stylesheet. */
export function createThemeTokens(options: ThemeTokenOptions = {}): ThemeTokenMap {
  options = snapshotOptions(options, ['mode', 'density', 'reducedMotion', 'overrides']);
  const mode = options.mode === undefined ? 'light' : options.mode, density = options.density === undefined ? 'compact' : options.density;
  if (mode !== 'light' && mode !== 'dark') throw new TypeError('Resolved theme mode must be light or dark.');
  if (typeof density !== 'string' || !Object.hasOwn(THEME_DENSITY_TOKENS, density)) throw new TypeError('Unknown theme density.');
  if (options.reducedMotion !== undefined && typeof options.reducedMotion !== 'boolean') throw new TypeError('reducedMotion must be boolean.');
  return applyThemeTokenOverrides({
    ...THEME_BASE_TOKENS, ...THEME_TYPOGRAPHY_TOKENS, ...(mode === 'dark' ? THEME_DARK_COLORS : THEME_LIGHT_COLORS),
    ...(mode === 'dark' ? THEME_DARK_ELEVATION : THEME_LIGHT_ELEVATION),
    ...THEME_DENSITY_TOKENS[density], ...THEME_FLOATING_BUTTON_GROUP_TOKENS,
    ...THEME_FLOATING_BUTTON_GROUP_PAINT[mode], ...resolveThemeMotion({ reducedMotion: options.reducedMotion }).tokens,
  }, options.overrides);
}

/** Bridge the new foundation to existing semantic consumers at this boundary; no legacy motion is overridden. */
export function createThemeDeclarations(options: ThemeTokenOptions = {}): ThemeTokenMap {
  options = snapshotOptions(options, ['mode', 'density', 'reducedMotion', 'overrides']);
  const tokens = Object.freeze({ ...createThemeTokens(options), ...THEME_COMPATIBILITY_ALIASES,
    ...THEME_LEGACY_CHART_COLORS[options.mode ?? 'light'], ...THEME_COMPONENT_ALIASES, ...THEME_MODE_COMPONENT_PAINT[options.mode ?? 'light'],
    ...THEME_FLOATING_BUTTON_GROUP_ALIASES, ...THEME_UTILITY_ALIASES });
  assertThemeTokenGraph(tokens);
  return tokens;
}

/** Attributes activate a boundary only where applied; omitted mode follows the existing .dark host/ancestor class. */
export function createThemeAttributes(options: ThemeAttributeOptions = {}): Readonly<Record<string, string>> {
  options = snapshotOptions(options, ['mode', 'density']);
  const mode = options.mode, density = options.density === undefined ? 'compact' : options.density;
  if (mode !== undefined && !['light', 'dark', 'system'].includes(mode)) throw new TypeError('Unknown theme mode.');
  if (typeof density !== 'string' || !Object.hasOwn(THEME_DENSITY_TOKENS, density)) throw new TypeError('Unknown theme density.');
  return Object.freeze({ 'data-zero-theme': THEME_FOUNDATION_ID, ...(mode ? { 'data-zero-mode': mode } : {}), 'data-zero-density': density });
}

/** Readable catalog for tools and migration docs; compatibility declarations are reported separately from new roles. */
export function getThemeTokenCatalog(): ReadonlyArray<{ readonly name: string; readonly light: string; readonly dark: string; readonly group: string }> {
  const light = createThemeTokens(), dark = createThemeTokens({ mode: 'dark' });
  return Object.freeze(Object.keys(light).sort().map(name => Object.freeze({ name, light: light[name]!, dark: dark[name]!,
    group: Object.hasOwn(THEME_LIGHT_COLORS, name) || Object.hasOwn(THEME_FLOATING_BUTTON_GROUP_PAINT.light, name) ? 'paint' : Object.hasOwn(THEME_LIGHT_ELEVATION, name) ? 'elevation'
      : Object.hasOwn(THEME_DENSITY_TOKENS.compact, name) ? 'density' : Object.hasOwn(THEME_TYPOGRAPHY_TOKENS, name) ? 'typography'
      : Object.hasOwn(THEME_BASE_TOKENS, name) || Object.hasOwn(THEME_FLOATING_BUTTON_GROUP_TOKENS, name) ? 'foundation' : 'motion',
  })));
}
