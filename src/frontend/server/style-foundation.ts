/**
 * Admits the managed stylesheet foundation without selecting browser theme,
 * loading fonts or activating an application scope. Next is the managed default;
 * the retained legacy foundation requires an explicit selection.
 */

/** Stylesheet build selection; the next supplement still requires a presentation markup boundary. */
export type AppThemeFoundation = 'legacy' | 'next';

/** Resolve only primitive supported selections; malformed explicit input never silently defaults. */
export function resolveAppThemeFoundation(value: unknown): AppThemeFoundation {
  if (value === undefined) return 'next';
  if (value !== 'legacy' && value !== 'next') {
    throw new TypeError('[app] themeFoundation must be legacy or next.');
  }
  return value;
}
