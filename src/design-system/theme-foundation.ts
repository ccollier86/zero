/**
 * Shared type, spacing, shape, state-presentation and density roles for the next
 * theme. Values are Zero-authored mappings of the pinned Arc/user references;
 * this module does not change styles, load fonts or control UI interactions.
 */
import type { ThemeDensity, ThemeTokenMap } from './theme-types';

/** New foundation identity; legacy styles remain a separate implementation. */
export const THEME_FOUNDATION_ID = 'next' as const;
/** Schema version for deterministic catalogs and generated CSS, not a framework release number. */
export const THEME_FOUNDATION_VERSION = 1 as const;

/** Shared scales and task geometry; dimensional CSS values remain zoom-scalable where appropriate. */
export const THEME_BASE_TOKENS: ThemeTokenMap = Object.freeze({
  '--zero-theme-font-body': 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  '--zero-theme-font-display': 'Geist, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  '--zero-theme-font-mono': '"Geist Mono", "SF Mono", "Cascadia Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  '--zero-theme-type-caption': '.75rem',
  '--zero-theme-type-body': '.8125rem',
  '--zero-theme-type-control': '.8125rem',
  '--zero-theme-type-subtitle': '.875rem',
  '--zero-theme-type-section': '.9375rem',
  '--zero-theme-type-heading': '1.375rem',
  '--zero-theme-type-page': '1.75rem',
  '--zero-theme-type-display': '2.25rem',
  '--zero-theme-type-hero': '3.25rem',
  '--zero-theme-leading-tight': '1.1',
  '--zero-theme-leading-label': '1.4',
  '--zero-theme-leading-body': '1.5',
  '--zero-theme-tracking-heading': '-.03em',
  '--zero-theme-tracking-label': '-.01em',
  '--zero-theme-weight-regular': '400',
  '--zero-theme-weight-medium': '500',
  '--zero-theme-weight-semibold': '600',
  '--zero-theme-space-1': '.25rem',
  '--zero-theme-space-2': '.5rem',
  '--zero-theme-space-3': '.75rem',
  '--zero-theme-space-4': '1rem',
  '--zero-theme-space-5': '1.25rem',
  '--zero-theme-space-6': '1.5rem',
  '--zero-theme-space-8': '2rem',
  '--zero-theme-space-10': '2.5rem',
  '--zero-theme-space-12': '3rem',
  '--zero-theme-space-16': '4rem',
  '--zero-theme-space-20': '5rem',
  '--zero-theme-space-24': '6rem',
  '--zero-theme-radius-control': '.375rem',
  '--zero-theme-radius-panel': '.5rem',
  '--zero-theme-radius-surface': '.625rem',
  '--zero-theme-radius-pill': '9999px',
  '--zero-theme-border-width': '1px',
  '--zero-theme-focus-width': '2px',
  '--zero-theme-focus-offset': '2px',
  '--zero-theme-icon-size': '1rem',
  '--zero-theme-icon-small': '.875rem',
  '--zero-theme-disabled-opacity': '.5',
  '--zero-theme-transparent': 'transparent',
  '--zero-theme-picker-panel-width': '17rem',
  '--zero-theme-picker-list-max-height': '18.5rem',
  '--zero-theme-picker-mark-size': '1.25rem',
  '--zero-theme-picker-open-radius': '1.375rem',
  '--zero-theme-picker-highlight-radius': '1rem',
  '--zero-theme-menu-section-gap': '.25rem',
  '--zero-theme-menu-separator-inset': '.5rem',
  '--zero-theme-card-padding-compact': 'var(--zero-theme-space-4)',
  '--zero-theme-card-padding-default': 'var(--zero-theme-space-5)',
  '--zero-theme-card-padding-comfortable': 'var(--zero-theme-space-6)',
  '--zero-theme-card-gap': 'var(--zero-theme-space-3)',
  '--zero-theme-card-radius': 'var(--zero-theme-radius-panel)',
  '--zero-theme-card-media-min-height': '7rem',
  '--zero-theme-scroll-track-size': '11px',
  '--zero-theme-scroll-thumb-size': '5px',
  '--zero-theme-scroll-thumb-active-size': '7px',
  '--zero-theme-scroll-thumb-min-size': '28px',
  '--zero-theme-scroll-thumb-opacity': '.30',
  '--zero-theme-scroll-thumb-active-opacity': '.46',
  '--zero-theme-scroll-overflow-tolerance': '.5px',
  '--zero-theme-scroll-page-fraction': '.9',
  '--zero-theme-modal-radius': '14px',
  '--zero-theme-modal-close-glyph': '14px',
  '--zero-theme-modal-close-target': '32px',
  '--zero-theme-tooltip-radius': '8px',
  '--zero-theme-inspector-radius': '10px',
  '--zero-theme-inspector-padding': '9px 12px',
  '--zero-theme-inspector-size': '12px',
  '--zero-theme-inspector-leading': '1.45',
  '--zero-theme-inspector-value-size': '17px',
  '--zero-theme-inspector-value-leading': '1.3',
  '--zero-theme-inspector-max-width': '260px',
  '--zero-theme-inspector-row-gap': '24px',
});

/** Intentional density roles; compact is the dashboard default, not a universal tiny hit target. */
export const THEME_DENSITY_TOKENS: Readonly<Record<ThemeDensity, ThemeTokenMap>> = Object.freeze({
  compact: Object.freeze({
    '--zero-theme-control-height': '2rem', '--zero-theme-control-height-small': '1.75rem',
    '--zero-theme-control-padding-inline': '.625rem', '--zero-theme-menu-row-min-height': '2.25rem',
    '--zero-theme-menu-row-padding-inline': '.625rem', '--zero-theme-menu-row-padding-block': '.375rem',
    '--zero-theme-card-padding': '1rem', '--zero-theme-section-gap': '1rem',
    '--zero-theme-heading-gap': '.25rem', '--zero-theme-toolbar-gap': '.5rem',
    '--zero-theme-hit-target-min': '2rem',
  }),
  comfortable: Object.freeze({
    '--zero-theme-control-height': '2.25rem', '--zero-theme-control-height-small': '2rem',
    '--zero-theme-control-padding-inline': '.75rem', '--zero-theme-menu-row-min-height': '2.5rem',
    '--zero-theme-menu-row-padding-inline': '.75rem', '--zero-theme-menu-row-padding-block': '.5rem',
    '--zero-theme-card-padding': '1.25rem', '--zero-theme-section-gap': '1.5rem',
    '--zero-theme-heading-gap': '.375rem', '--zero-theme-toolbar-gap': '.625rem',
    '--zero-theme-hit-target-min': '2.25rem',
  }),
  touch: Object.freeze({
    '--zero-theme-control-height': '2.75rem', '--zero-theme-control-height-small': '2.75rem',
    '--zero-theme-control-padding-inline': '.875rem', '--zero-theme-menu-row-min-height': '2.75rem',
    '--zero-theme-menu-row-padding-inline': '.875rem', '--zero-theme-menu-row-padding-block': '.625rem',
    '--zero-theme-card-padding': '1.25rem', '--zero-theme-section-gap': '1.5rem',
    '--zero-theme-heading-gap': '.375rem', '--zero-theme-toolbar-gap': '.75rem',
    '--zero-theme-hit-target-min': '2.75rem',
  }),
});

/** Named elevations are palette-aware; geometry and local inspector overrides remain independent. */
export const THEME_LIGHT_ELEVATION: ThemeTokenMap = Object.freeze({
  '--zero-theme-shadow-resting': '0 1px 2px rgb(0 0 0 / .035)',
  '--zero-theme-shadow-raised': '0 6px 18px rgb(0 0 0 / .065), 0 1px 3px rgb(0 0 0 / .035)',
  '--zero-theme-shadow-floating': '0 20px 48px rgb(0 0 0 / .105), 0 3px 10px rgb(0 0 0 / .045)',
  '--zero-theme-shadow-inspector': '0 1px 2px rgb(0 0 0 / .05), 0 10px 28px -6px rgb(0 0 0 / .16)',
  '--zero-theme-backdrop': 'rgb(16 20 32 / .42)',
});
/** Dark elevation avoids unreadable pale rims or changing the task's geometry. */
export const THEME_DARK_ELEVATION: ThemeTokenMap = Object.freeze({
  '--zero-theme-shadow-resting': '0 1px 2px rgb(0 0 0 / .18)',
  '--zero-theme-shadow-raised': '0 8px 22px rgb(0 0 0 / .22), 0 1px 3px rgb(0 0 0 / .16)',
  '--zero-theme-shadow-floating': '0 22px 55px rgb(0 0 0 / .34), 0 3px 10px rgb(0 0 0 / .22)',
  '--zero-theme-shadow-inspector': '0 1px 2px rgb(0 0 0 / .18), 0 10px 28px -6px rgb(0 0 0 / .34)',
  '--zero-theme-backdrop': 'rgb(0 0 0 / .62)',
});
