/**
 * theme-floating-button-group.ts
 *
 * Defines the action tray's scoped shape, material and consumer aliases. This
 * pure theme module consumes semantic foundation roles; it does not install
 * styles, create a toolbar controller, load fonts, or alter joined ButtonGroup.
 * Arc's pinned FloatingButtonGroup is the visual calibration, not a root theme.
 */
import type { ThemeTokenMap } from './theme-types';

const PREFIX = '--zero-theme-floating-button-group-';

/** Local tray geometry stays valid independently of the compact global control radius. */
export const THEME_FLOATING_BUTTON_GROUP_TOKENS: ThemeTokenMap = Object.freeze({
  [`${PREFIX}font-family`]: 'var(--zero-theme-font-body)',
  [`${PREFIX}foreground`]: 'var(--zero-theme-text-primary)',
  [`${PREFIX}secondary`]: 'var(--zero-theme-text-secondary)',
  [`${PREFIX}muted`]: 'var(--zero-theme-text-muted)',
  [`${PREFIX}floating-background`]: 'var(--zero-theme-raised)',
  [`${PREFIX}floating-border`]: 'var(--zero-theme-border-default)',
  [`${PREFIX}floating-shadow`]: 'var(--zero-theme-shadow-floating)',
  [`${PREFIX}focus`]: 'var(--zero-theme-ring)',
  [`${PREFIX}focus-width`]: 'var(--zero-theme-focus-width)',
  [`${PREFIX}focus-offset`]: 'var(--zero-theme-focus-offset)',
  [`${PREFIX}hit-target-min`]: 'var(--zero-theme-hit-target-min)',
  [`${PREFIX}disabled-opacity`]: 'var(--zero-theme-disabled-opacity)',
  [`${PREFIX}md-height`]: '2.25rem',
  [`${PREFIX}md-padding`]: '.25rem',
  [`${PREFIX}md-gap`]: '.25rem',
  [`${PREFIX}md-inline-padding`]: '.75rem',
  [`${PREFIX}md-radius`]: '1.125rem',
  [`${PREFIX}md-item-radius`]: '.8125rem',
  [`${PREFIX}md-font-size`]: 'var(--zero-type-control-size)',
  [`${PREFIX}sm-height`]: '1.875rem',
  [`${PREFIX}sm-padding`]: '.1875rem',
  [`${PREFIX}sm-gap`]: '.1875rem',
  [`${PREFIX}sm-inline-padding`]: '.625rem',
  [`${PREFIX}sm-radius`]: '.9375rem',
  [`${PREFIX}sm-item-radius`]: '.6875rem',
  [`${PREFIX}sm-font-size`]: 'var(--zero-type-caption-size)',
  [`${PREFIX}font-weight`]: 'var(--zero-type-control-weight)',
  [`${PREFIX}line-height`]: 'var(--zero-type-control-leading)',
  [`${PREFIX}tracking`]: 'var(--zero-type-control-tracking)',
  [`${PREFIX}icon-size`]: '1rem',
  [`${PREFIX}icon-gap`]: '.375rem',
  [`${PREFIX}separator-thickness`]: '1px',
  [`${PREFIX}separator-margin`]: '.125rem',
  [`${PREFIX}separator-length-share`]: '.5',
});

/** Hover, press and persistent mode material deliberately have separate palette-aware roles. */
export const THEME_FLOATING_BUTTON_GROUP_PAINT: Readonly<Record<'light' | 'dark', ThemeTokenMap>> = Object.freeze({
  light: Object.freeze({
    [`${PREFIX}background`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 4.5%, transparent)',
    [`${PREFIX}tray-edge`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 3%, transparent)',
    [`${PREFIX}highlight`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 7%, transparent)',
    [`${PREFIX}highlight-press`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 12%, transparent)',
    [`${PREFIX}mode-tint`]: 'color-mix(in oklab, var(--zero-theme-selection-fill) 12%, transparent)',
    [`${PREFIX}rule`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 12%, transparent)',
  }),
  dark: Object.freeze({
    [`${PREFIX}background`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 6%, transparent)',
    [`${PREFIX}tray-edge`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 5%, transparent)',
    [`${PREFIX}highlight`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 9%, transparent)',
    [`${PREFIX}highlight-press`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 15%, transparent)',
    [`${PREFIX}mode-tint`]: 'color-mix(in oklab, var(--zero-theme-selection-fill) 16%, transparent)',
    [`${PREFIX}rule`]: 'color-mix(in oklab, var(--zero-theme-text-primary) 12%, transparent)',
  }),
});

const MOTION_SUFFIXES = Object.freeze([
  'move-duration', 'move-bounce', 'press-duration', 'press-bounce',
  'show-duration', 'hide-duration', 'press-paint-duration', 'first-entry-scale',
  'press-scale', 'highlight-opacity-threshold', 'label-enter-duration',
  'label-exit-duration', 'label-enter-y', 'label-exit-y', 'label-blur',
  'label-enter-easing', 'feedback-easing',
]);

/** Component names are aliases, not a second palette; explicit local CSS customization remains possible. */
export const THEME_FLOATING_BUTTON_GROUP_ALIASES: ThemeTokenMap = Object.freeze(Object.fromEntries([
  ...Object.keys(THEME_FLOATING_BUTTON_GROUP_TOKENS),
  ...Object.keys(THEME_FLOATING_BUTTON_GROUP_PAINT.light),
  ...MOTION_SUFFIXES.map(suffix => `${PREFIX}${suffix}`),
].map(name => [name.replace('--zero-theme-', '--zero-'), `var(${name})`])));
