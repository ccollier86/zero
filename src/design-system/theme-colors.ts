/**
 * theme-colors.ts
 *
 * Owns the dependency-free light/dark semantic paint defaults for the new Zero
 * theme. Arc's achromatic material hierarchy informs the palette; small-text,
 * control and state pairs are strengthened where needed for contrast. This
 * module does not install CSS, read browser state, load fonts or mutate existing
 * application themes. Literal values avoid inherited var() aliases resolving
 * against a different ancestor before a scoped theme reaches the paint site.
 *
 * Reference: docs-next/_work/arc-design-language-audit.md and Arc foundation.css
 * at 86330cc9270c4acc55b7204c9583fcbaa378192c. Named analytical colors preserve
 * the existing Zero Charts palette, not Arc's dynamically rotating hue order.
 */

/** Immutable server-safe light colors; interaction washes and selected control fills are distinct roles. */
export const THEME_LIGHT_COLORS = Object.freeze({
  '--zero-theme-canvas': '#ffffff',
  '--zero-theme-surface': '#ffffff',
  '--zero-theme-raised': '#ffffff',
  '--zero-theme-muted': '#f7f7f7',
  '--zero-theme-inset': '#f1f1f1',

  '--zero-theme-text-primary': '#1d1d1d',
  '--zero-theme-text-secondary': '#595959',
  '--zero-theme-text-muted': '#686868',

  // Quiet separators do not identify controls. Input/strong/ring roles do.
  '--zero-theme-border-default': '#e5e5e5',
  '--zero-theme-border-subtle': '#eeeeee',
  '--zero-theme-border-strong': '#8a8a8a',
  '--zero-theme-input': '#858585',
  '--zero-theme-ring': '#4b4b4b',

  '--zero-theme-primary-fill': '#363636',
  '--zero-theme-primary-hover': '#292929',
  '--zero-theme-primary-foreground': '#ffffff',
  '--zero-theme-interaction-fill': '#f3f3f3',
  '--zero-theme-interaction-hover': '#e9e9e9',
  '--zero-theme-interaction-foreground': '#1d1d1d',
  '--zero-theme-secondary-fill': '#f0f0f0',
  '--zero-theme-secondary-foreground': '#1d1d1d',
  '--zero-theme-selection-fill': '#1d1d1d',
  '--zero-theme-selection-foreground': '#ffffff',

  // Ink belongs on plain/wash surfaces; foreground belongs on the solid fill.
  '--zero-theme-success-ink': '#146c43',
  '--zero-theme-success-fill': '#16764a',
  '--zero-theme-success-foreground': '#ffffff',
  '--zero-theme-success-wash': '#e8f5ed',
  '--zero-theme-warning-ink': '#885600',
  '--zero-theme-warning-fill': '#9c6300',
  '--zero-theme-warning-foreground': '#ffffff',
  '--zero-theme-warning-wash': '#fff4dd',
  '--zero-theme-danger-ink': '#b92c27',
  '--zero-theme-danger-fill': '#b92c27',
  '--zero-theme-danger-foreground': '#ffffff',
  '--zero-theme-danger-wash': '#fdeceb',

  // Sidebar counterparts are literals so a nested scope cannot freeze a parent alias.
  '--zero-theme-sidebar-canvas': '#f7f7f7',
  '--zero-theme-sidebar-foreground': '#1d1d1d',
  '--zero-theme-sidebar-muted': '#686868',
  '--zero-theme-sidebar-border': '#e5e5e5',
  '--zero-theme-sidebar-primary': '#363636',
  '--zero-theme-sidebar-primary-foreground': '#ffffff',
  '--zero-theme-sidebar-accent': '#ededed',
  '--zero-theme-sidebar-accent-foreground': '#1d1d1d',
  '--zero-theme-sidebar-ring': '#4b4b4b',

  // Category paint is not text ink; visible labels keep semantic text colors.
  '--zero-theme-series-blue': '#2a78d6',
  '--zero-theme-series-orange': '#eb6834',
  '--zero-theme-series-green': '#1baf7a',
  '--zero-theme-series-amber': '#eda100',
  '--zero-theme-series-purple': '#8a5cd6',
  '--zero-theme-series-teal': '#0f9c86',
  '--zero-theme-series-rose': '#d9485f',
  '--zero-theme-series-olive': '#5d8a1f',
} satisfies Record<`--zero-theme-${string}`, string>);

/** Immutable server-safe dark colors with the same semantic keys and analytical identities as light mode. */
export const THEME_DARK_COLORS = Object.freeze({
  '--zero-theme-canvas': '#141414',
  '--zero-theme-surface': '#191919',
  '--zero-theme-raised': '#1f1f1f',
  '--zero-theme-muted': '#242424',
  '--zero-theme-inset': '#0b0b0b',

  '--zero-theme-text-primary': '#f2f2f2',
  '--zero-theme-text-secondary': '#b4b4b4',
  '--zero-theme-text-muted': '#9f9f9f',

  '--zero-theme-border-default': '#2b2b2b',
  '--zero-theme-border-subtle': '#222222',
  '--zero-theme-border-strong': '#777777',
  '--zero-theme-input': '#787878',
  '--zero-theme-ring': '#c9c9c9',

  '--zero-theme-primary-fill': '#bdbdbd',
  '--zero-theme-primary-hover': '#e0e0e0',
  '--zero-theme-primary-foreground': '#141414',
  '--zero-theme-interaction-fill': '#2b2b2b',
  '--zero-theme-interaction-hover': '#353535',
  '--zero-theme-interaction-foreground': '#f2f2f2',
  '--zero-theme-secondary-fill': '#292929',
  '--zero-theme-secondary-foreground': '#f2f2f2',
  '--zero-theme-selection-fill': '#e8e8e8',
  '--zero-theme-selection-foreground': '#141414',

  '--zero-theme-success-ink': '#73dda2',
  '--zero-theme-success-fill': '#58c98b',
  '--zero-theme-success-foreground': '#081a10',
  '--zero-theme-success-wash': '#163522',
  '--zero-theme-warning-ink': '#f0c36b',
  '--zero-theme-warning-fill': '#e8b44f',
  '--zero-theme-warning-foreground': '#241800',
  '--zero-theme-warning-wash': '#3a2d13',
  '--zero-theme-danger-ink': '#ffaba5',
  '--zero-theme-danger-fill': '#f28b82',
  '--zero-theme-danger-foreground': '#31120f',
  '--zero-theme-danger-wash': '#3a1b1b',

  '--zero-theme-sidebar-canvas': '#141414',
  '--zero-theme-sidebar-foreground': '#f2f2f2',
  '--zero-theme-sidebar-muted': '#9f9f9f',
  '--zero-theme-sidebar-border': '#2b2b2b',
  '--zero-theme-sidebar-primary': '#bdbdbd',
  '--zero-theme-sidebar-primary-foreground': '#141414',
  '--zero-theme-sidebar-accent': '#303030',
  '--zero-theme-sidebar-accent-foreground': '#f2f2f2',
  '--zero-theme-sidebar-ring': '#c9c9c9',

  '--zero-theme-series-blue': '#3987e5',
  '--zero-theme-series-orange': '#d95926',
  '--zero-theme-series-green': '#199e70',
  '--zero-theme-series-amber': '#c98500',
  '--zero-theme-series-purple': '#b08cff',
  '--zero-theme-series-teal': '#3fd0b4',
  '--zero-theme-series-rose': '#ff7a8f',
  '--zero-theme-series-olive': '#9ccc4f',
} satisfies Record<`--zero-theme-${string}`, string>);
