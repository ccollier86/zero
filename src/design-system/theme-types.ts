/** Pure theme-foundation contracts shared by server tooling and browser consumers; no auth, DOM or transport policy. */

/** Explicit palette selection; system selection is performed by CSS, not during SSR. */
export type ThemeMode = 'light' | 'dark' | 'system';
/** Presentation density changes geometry, not semantic selection or interaction behavior. */
export type ThemeDensity = 'compact' | 'comfortable' | 'touch';
/** Immutable CSS declarations; public construction validates names, values and reference graphs. */
export type ThemeTokenMap = Readonly<Record<string, string>>;
/** Resolved token construction uses a concrete palette and never reads system preferences. */
export interface ThemeTokenOptions {
  readonly mode?: Exclude<ThemeMode, 'system'>;
  readonly density?: ThemeDensity;
  readonly reducedMotion?: boolean;
  readonly overrides?: ThemeTokenMap;
}
/** DOM attributes choose an explicit experimental boundary; no live application is changed automatically. */
export interface ThemeAttributeOptions {
  readonly mode?: ThemeMode;
  readonly density?: ThemeDensity;
}
/** Audit inputs are supplied source text, not filesystem access or an application bootstrap. */
export interface ThemeAuditSource { readonly name: string; readonly content: string }
/** A gap is source evidence for a migration task, not permission to rewrite the source. */
export interface ThemeAuditFinding {
  readonly source: string;
  readonly line: number;
  readonly kind: 'unresolved-reference' | 'legacy-reference' | 'literal-color';
  readonly token?: string;
  readonly detail: string;
}
