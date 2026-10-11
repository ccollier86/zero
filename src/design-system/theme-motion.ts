/**
 * theme-motion.ts
 *
 * Defines the opt-in theme foundation's task-specific motion recipes and CSS
 * values. This pure presentation module imports no browser globals, renderer,
 * component, animation library, timer, or legacy theme; it does not apply styles
 * or change focus, scrolling, confirmation admission, or existing defaults.
 *
 * Lineage: Zero sidebar/navbar physical springs; Arc's pinned foundation and
 * MorphSelect/ScrollArea sources (86330cc9270c4acc55b7204c9583fcbaa378192c);
 * approved Zero Modal Motion Lab/Tooltip Motion Kit and chart inspector policy.
 */

/** A physical spring preserves velocity when retargeted; its coefficients are not milliseconds. */
export interface ThemePhysicalSpringRecipe {
  readonly kind: 'physical-spring';
  readonly animate: boolean;
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/** Arc's duration/bounce inputs calibrate physical coefficients, not a guaranteed completion deadline. */
export interface ThemeCalibratedSpringRecipe extends ThemePhysicalSpringRecipe {
  readonly visualDurationMs: number;
  readonly bounce: number;
  readonly calibration: 'arc-angular-frequency';
}

/** A time-based visual transition, explicitly expressed in milliseconds. */
export interface ThemeTweenRecipe {
  readonly kind: 'tween';
  readonly animate: boolean;
  readonly durationMs: number;
  readonly easing: string;
}

/** Nearby anchored panels explain their trigger without using the modal's full geometry morph. */
export interface ThemeAnchoredSurfaceRecipe {
  readonly kind: 'anchored-surface';
  readonly animate: boolean;
  readonly enterDurationMs: number;
  readonly fadeDurationMs: number;
  readonly exitDurationMs: number;
  readonly offsetPx: number;
  readonly enterScale: number;
  readonly exitScale: number;
  readonly easing: string;
}

/** Browsable-card feedback only; quick-look geometry and safety remain owned by the modal manager. */
export interface ThemeCardFeedbackRecipe {
  readonly kind: 'card-feedback';
  readonly animate: boolean;
  readonly hoverLiftPx: number;
  readonly mediaZoom: number;
  readonly hoverInMs: number;
  readonly hoverOutMs: number;
  readonly statusEnterMs: number;
  readonly statusExitMs: number;
  readonly statusStaggerMs: number;
  readonly statusBlurPx: number;
}

/** Action-tray material moves independently of the stationary button and icon hit targets. */
export interface ThemeFloatingButtonGroupFeedbackRecipe {
  readonly kind: 'floating-button-group-feedback';
  readonly animate: boolean;
  readonly showDurationMs: number;
  readonly hideDurationMs: number;
  readonly pressPaintDurationMs: number;
  readonly firstEntryScale: number;
  readonly pressScale: number;
  readonly highlightOpacityThreshold: number;
  readonly easing: string;
}

/** Changing action labels exchange within their reserved slot; outgoing text is decorative only. */
export interface ThemeFloatingButtonGroupLabelRecipe {
  readonly kind: 'floating-button-group-label';
  readonly animate: boolean;
  readonly enterDurationMs: number;
  readonly exitDurationMs: number;
  readonly enterYpx: number;
  readonly exitYpx: number;
  readonly blurPx: number;
  readonly easing: string;
}

/** Native scroll affordances; reduced motion removes transitions, not scrolling or hide-delay policy. */
export interface ThemeScrollRecipe {
  readonly kind: 'native-scroll-affordance';
  readonly animate: boolean;
  readonly fadeSizePx: number;
  readonly edgeThresholdPx: number;
  readonly hideDelayMs: number;
  readonly showDurationMs: number;
  readonly hideDurationMs: number;
  readonly trackHitSizePx: number;
  readonly thumbSizePx: number;
  readonly activeThumbSizePx: number;
  readonly minimumThumbLengthPx: number;
  readonly thumbForegroundShare: number;
  readonly activeThumbForegroundShare: number;
  readonly easing: string;
}

/** Preserved modal presentation policy; the existing modal system remains its authoritative resolver. */
export interface ThemeModalRecipe {
  readonly kind: 'preserved-modal-policy';
  readonly animate: boolean;
  readonly entrance: 'origin';
  readonly fallbackEntrance: 'rise';
  readonly exit: 'mirror';
  readonly backdrop: 'blur';
  readonly backdropBlurPx: number;
  readonly pageRecedes: boolean;
  readonly pageRecedeScale: number;
  readonly durationMultiplier: number;
  readonly baseOriginEnterMs: number;
  readonly baseFallbackEnterMs: number;
  readonly originEnterMs: number;
  readonly fallbackEnterMs: number;
  readonly originExitMs: number;
  readonly fallbackExitMs: number;
}

/** Preserved tooltip policy separates animation time from hover intent and warm-group timing. */
export interface ThemeTooltipRecipe {
  readonly kind: 'preserved-tooltip-policy';
  readonly animate: boolean;
  readonly entrance: 'grow';
  readonly arrow: true;
  readonly durationMultiplier: number;
  readonly enterDurationMs: number;
  readonly fadeDurationMs: number;
  readonly exitDurationMs: number;
  readonly openDelayMs: number;
  readonly warmDurationMs: number;
  readonly graceDurationMs: number;
}

/** A real confirmation interval is safety policy, never animation pace or a reduced-motion casualty. */
export interface ThemeConfirmationRecipe {
  readonly kind: 'confirmation-interval';
  readonly durationMs: number;
  readonly presentationPaceApplies: false;
  readonly reducedMotionApplies: false;
}

/** Named task recipes keep navigation, compact pickers, and data inspectors intentionally distinct. */
export interface ThemeMotionRecipes {
  readonly feedbackInstant: ThemeTweenRecipe;
  readonly feedbackFast: ThemeTweenRecipe;
  readonly feedbackStandard: ThemeTweenRecipe;
  readonly feedbackConsidered: ThemeTweenRecipe;
  readonly magneticSidebar: ThemePhysicalSpringRecipe;
  readonly magneticNavigation: ThemePhysicalSpringRecipe;
  readonly pickerOpen: ThemeCalibratedSpringRecipe;
  readonly pickerClose: ThemeCalibratedSpringRecipe;
  readonly pickerHighlight: ThemeCalibratedSpringRecipe;
  readonly pickerWidth: ThemeCalibratedSpringRecipe;
  readonly pickerWidthNarrow: ThemeCalibratedSpringRecipe;
  readonly pickerLabel: ThemeCalibratedSpringRecipe;
  readonly anchoredSurface: ThemeAnchoredSurfaceRecipe;
  readonly cardFeedback: ThemeCardFeedbackRecipe;
  readonly floatingButtonGroupMove: ThemeCalibratedSpringRecipe;
  readonly floatingButtonGroupPress: ThemeCalibratedSpringRecipe;
  readonly floatingButtonGroupFeedback: ThemeFloatingButtonGroupFeedbackRecipe;
  readonly floatingButtonGroupLabel: ThemeFloatingButtonGroupLabelRecipe;
  readonly scrollArea: ThemeScrollRecipe;
  readonly modal: ThemeModalRecipe;
  readonly tooltip: ThemeTooltipRecipe;
  readonly chartInspector: ThemeTweenRecipe;
  readonly holdToConfirm: ThemeConfirmationRecipe;
}

const STANDARD = 'cubic-bezier(.22,1,.36,1)';
const ENTER = 'cubic-bezier(.16,1,.3,1)';
const EXIT = 'cubic-bezier(.7,0,.84,0)';
const IN_OUT = 'cubic-bezier(.65,0,.35,1)';
const SETTLE = 'linear(0, .0258, .09, .1763, .2732, .3724, .4683, .5573, .6376, .7082, .7689, .8202, .8628, .8976, .9256, .9476, .9648, .9778, .9875, .9945, .9994, 1.0026, 1.0047, 1.0058, 1.0062, 1.0062, 1.0059, 1.0055, 1.0049, 1.0043, 1.0036, 1.0031, 1.0025, 1.002, 1.0016, 1.0013, 1)';

function tween(durationMs: number): ThemeTweenRecipe {
  return Object.freeze({ kind: 'tween', animate: true, durationMs, easing: STANDARD });
}

function physical(stiffness: number, damping: number, mass = 1): ThemePhysicalSpringRecipe {
  return Object.freeze({ kind: 'physical-spring', animate: true, stiffness, damping, mass });
}

function calibrated(visualDurationMs: number, bounce: number): ThemeCalibratedSpringRecipe {
  // Exact MorphSelect conversion: ω = 2π / (visual seconds × 1.2).
  const angularFrequency = 2 * Math.PI / (visualDurationMs / 1000 * 1.2);
  return Object.freeze({ ...physical(angularFrequency ** 2, 2 * (1 - bounce) * angularFrequency),
    visualDurationMs, bounce, calibration: 'arc-angular-frequency' });
}

/** Frozen reference recipes only; importing them never switches existing components to the new theme. */
export const THEME_MOTION_RECIPES: Readonly<ThemeMotionRecipes> = Object.freeze({
  feedbackInstant: tween(120), feedbackFast: tween(160),
  feedbackStandard: tween(240), feedbackConsidered: tween(480),
  // Keep Zero's recognizable sidebar and front-page navigation magnetism.
  magneticSidebar: physical(350, 35), magneticNavigation: physical(360, 32, .7),
  // Arc MorphSelect GROW/SHRINK/GLIDE/WIDTH/NARROW/FLY; source timings are seconds.
  pickerOpen: calibrated(400, .12), pickerClose: calibrated(340, 0),
  pickerHighlight: calibrated(280, .08), pickerWidth: calibrated(420, .16),
  pickerWidthNarrow: calibrated(420, 0), pickerLabel: calibrated(300, .06),
  anchoredSurface: Object.freeze({ kind: 'anchored-surface', animate: true,
    enterDurationMs: 580, fadeDurationMs: 160, exitDurationMs: 140,
    offsetPx: 5, enterScale: .97, exitScale: .98, easing: SETTLE }),
  cardFeedback: Object.freeze({ kind: 'card-feedback', animate: true, hoverLiftPx: 2, mediaZoom: 1.04,
    hoverInMs: 960, hoverOutMs: 480, statusEnterMs: 240, statusExitMs: 160, statusStaggerMs: 40, statusBlurPx: 4 }),
  // FloatingButtonGroup owns these tracks; sharing calibration must not couple picker or navigation policies.
  floatingButtonGroupMove: calibrated(420, .16), floatingButtonGroupPress: calibrated(260, .12),
  floatingButtonGroupFeedback: Object.freeze({ kind: 'floating-button-group-feedback', animate: true,
    showDurationMs: 160, hideDurationMs: 240, pressPaintDurationMs: 120,
    firstEntryScale: .94, pressScale: .965, highlightOpacityThreshold: .15, easing: STANDARD }),
  floatingButtonGroupLabel: Object.freeze({ kind: 'floating-button-group-label', animate: true,
    enterDurationMs: 240, exitDurationMs: 160, enterYpx: 4, exitYpx: -3, blurPx: 4, easing: ENTER }),
  scrollArea: Object.freeze({ kind: 'native-scroll-affordance', animate: true,
    fadeSizePx: 28, edgeThresholdPx: .5, hideDelayMs: 900,
    showDurationMs: 160, hideDurationMs: 480, trackHitSizePx: 11,
    thumbSizePx: 5, activeThumbSizePx: 7, minimumThumbLengthPx: 28,
    thumbForegroundShare: .3, activeThumbForegroundShare: .46, easing: STANDARD }),
  // src/modals/modal-motion.ts: base × 1.5 is duration multiplication, not velocity.
  modal: Object.freeze({ kind: 'preserved-modal-policy', animate: true,
    entrance: 'origin', fallbackEntrance: 'rise', exit: 'mirror', backdrop: 'blur',
    backdropBlurPx: 6, pageRecedes: true, pageRecedeScale: .965, durationMultiplier: 1.5,
    baseOriginEnterMs: 650, baseFallbackEnterMs: 600,
    originEnterMs: 975, fallbackEnterMs: 900, originExitMs: 570, fallbackExitMs: 390 }),
  // src/components/tooltip/tooltip-motion.ts: intent timers deliberately do not scale.
  tooltip: Object.freeze({ kind: 'preserved-tooltip-policy', animate: true,
    entrance: 'grow', arrow: true, durationMultiplier: 1,
    enterDurationMs: 400, fadeDurationMs: 200, exitDurationMs: 200,
    openDelayMs: 450, warmDurationMs: 450, graceDurationMs: 70 }),
  // src/components/charts/chart-tokens.css and src/modals/hold-button.tsx.
  chartInspector: tween(120),
  holdToConfirm: Object.freeze({ kind: 'confirmation-interval', durationMs: 1500,
    presentationPaceApplies: false, reducedMotionApplies: false }),
});

/** CSS values are a new opt-in namespace; no --zero-modal/tooltip/chart or old global token is overwritten. */
export const THEME_MOTION_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  '--zero-theme-duration-instant': '120ms', '--zero-theme-duration-fast': '160ms',
  '--zero-theme-duration-standard': '240ms', '--zero-theme-duration-considered': '480ms',
  '--zero-theme-ease-standard': STANDARD, '--zero-theme-ease-enter': ENTER,
  '--zero-theme-ease-exit': EXIT, '--zero-theme-ease-in-out': IN_OUT,
  '--zero-theme-magnetic-sidebar-stiffness': '350', '--zero-theme-magnetic-sidebar-damping': '35',
  '--zero-theme-magnetic-sidebar-mass': '1', '--zero-theme-magnetic-navigation-stiffness': '360',
  '--zero-theme-magnetic-navigation-damping': '32', '--zero-theme-magnetic-navigation-mass': '.7',
  '--zero-theme-picker-open-duration': '400ms', '--zero-theme-picker-open-bounce': '.12',
  '--zero-theme-picker-close-duration': '340ms', '--zero-theme-picker-close-bounce': '0',
  '--zero-theme-picker-highlight-duration': '280ms', '--zero-theme-picker-highlight-bounce': '.08',
  '--zero-theme-picker-width-duration': '420ms', '--zero-theme-picker-width-bounce': '.16',
  '--zero-theme-picker-width-narrow-duration': '420ms', '--zero-theme-picker-width-narrow-bounce': '0',
  '--zero-theme-picker-label-duration': '300ms', '--zero-theme-picker-label-bounce': '.06',
  '--zero-theme-popover-enter-duration': '580ms', '--zero-theme-popover-fade-duration': '160ms',
  '--zero-theme-popover-exit-duration': '140ms', '--zero-theme-popover-offset': '5px',
  '--zero-theme-popover-enter-scale': '.97', '--zero-theme-popover-exit-scale': '.98',
  '--zero-theme-popover-spring-ease': SETTLE,
  '--zero-theme-card-hover-lift': '2px', '--zero-theme-card-media-zoom': '1.04',
  '--zero-theme-card-hover-in-duration': '960ms', '--zero-theme-card-hover-out-duration': '480ms',
  '--zero-theme-card-status-enter-duration': '240ms', '--zero-theme-card-status-exit-duration': '160ms',
  '--zero-theme-card-status-stagger': '40ms', '--zero-theme-card-status-blur': '4px',
  '--zero-theme-floating-button-group-move-duration': '420ms', '--zero-theme-floating-button-group-move-bounce': '.16',
  '--zero-theme-floating-button-group-press-duration': '260ms', '--zero-theme-floating-button-group-press-bounce': '.12',
  '--zero-theme-floating-button-group-show-duration': '160ms', '--zero-theme-floating-button-group-hide-duration': '240ms',
  '--zero-theme-floating-button-group-press-paint-duration': '120ms', '--zero-theme-floating-button-group-first-entry-scale': '.94',
  '--zero-theme-floating-button-group-press-scale': '.965', '--zero-theme-floating-button-group-highlight-opacity-threshold': '.15',
  '--zero-theme-floating-button-group-label-enter-duration': '240ms', '--zero-theme-floating-button-group-label-exit-duration': '160ms',
  '--zero-theme-floating-button-group-label-enter-y': '4px', '--zero-theme-floating-button-group-label-exit-y': '-3px',
  '--zero-theme-floating-button-group-label-blur': '4px', '--zero-theme-floating-button-group-label-enter-easing': ENTER,
  '--zero-theme-floating-button-group-feedback-easing': STANDARD,
  '--zero-theme-scroll-fade-size': '28px', '--zero-theme-scroll-edge-threshold': '.5px',
  '--zero-theme-scroll-hide-delay': '900ms', '--zero-theme-scroll-show-duration': '160ms',
  '--zero-theme-scroll-hide-duration': '480ms', '--zero-theme-scroll-track-hit-size': '11px',
  '--zero-theme-scroll-thumb-size': '5px', '--zero-theme-scroll-active-thumb-size': '7px',
  '--zero-theme-scroll-minimum-thumb-length': '28px', '--zero-theme-scroll-thumb-foreground-share': '30%',
  '--zero-theme-scroll-active-thumb-foreground-share': '46%',
  '--zero-theme-modal-entrance': 'origin', '--zero-theme-modal-fallback-entrance': 'rise',
  '--zero-theme-modal-exit': 'mirror', '--zero-theme-modal-backdrop': 'blur',
  '--zero-theme-modal-backdrop-blur': '6px', '--zero-theme-modal-page-recedes': 'true',
  '--zero-theme-modal-page-recede-scale': '.965', '--zero-theme-modal-duration-multiplier': '1.5',
  '--zero-theme-modal-base-origin-enter-duration': '650ms', '--zero-theme-modal-base-fallback-enter-duration': '600ms',
  '--zero-theme-modal-origin-enter-duration': '975ms', '--zero-theme-modal-fallback-enter-duration': '900ms',
  '--zero-theme-modal-origin-exit-duration': '570ms', '--zero-theme-modal-fallback-exit-duration': '390ms',
  '--zero-theme-tooltip-entrance': 'grow', '--zero-theme-tooltip-arrow': 'true',
  '--zero-theme-tooltip-duration-multiplier': '1', '--zero-theme-tooltip-enter-duration': '400ms',
  '--zero-theme-tooltip-fade-duration': '200ms', '--zero-theme-tooltip-exit-duration': '200ms',
  '--zero-theme-tooltip-open-delay': '450ms', '--zero-theme-tooltip-warm-duration': '450ms',
  '--zero-theme-tooltip-grace-duration': '70ms', '--zero-theme-chart-inspector-duration': '120ms',
  '--zero-theme-hold-confirm-duration': '1500ms',
});

// Named animation times only. Interaction delays, geometry, calibration, and safety holds are not swept by suffix.
const REDUCED_TIMING_KEYS = Object.freeze([
  '--zero-theme-duration-instant', '--zero-theme-duration-fast', '--zero-theme-duration-standard', '--zero-theme-duration-considered',
  '--zero-theme-picker-open-duration', '--zero-theme-picker-close-duration', '--zero-theme-picker-highlight-duration',
  '--zero-theme-picker-width-duration', '--zero-theme-picker-width-narrow-duration', '--zero-theme-picker-label-duration',
  '--zero-theme-popover-enter-duration', '--zero-theme-popover-fade-duration', '--zero-theme-popover-exit-duration',
  '--zero-theme-card-hover-in-duration', '--zero-theme-card-hover-out-duration',
  '--zero-theme-card-status-enter-duration', '--zero-theme-card-status-exit-duration', '--zero-theme-card-status-stagger',
  '--zero-theme-floating-button-group-move-duration', '--zero-theme-floating-button-group-press-duration',
  '--zero-theme-floating-button-group-show-duration', '--zero-theme-floating-button-group-hide-duration',
  '--zero-theme-floating-button-group-press-paint-duration', '--zero-theme-floating-button-group-label-enter-duration',
  '--zero-theme-floating-button-group-label-exit-duration',
  '--zero-theme-scroll-show-duration', '--zero-theme-scroll-hide-duration',
  '--zero-theme-modal-base-origin-enter-duration', '--zero-theme-modal-base-fallback-enter-duration',
  '--zero-theme-modal-origin-enter-duration', '--zero-theme-modal-fallback-enter-duration',
  '--zero-theme-modal-origin-exit-duration', '--zero-theme-modal-fallback-exit-duration',
  '--zero-theme-tooltip-enter-duration', '--zero-theme-tooltip-fade-duration', '--zero-theme-tooltip-exit-duration',
  '--zero-theme-chart-inspector-duration',
]);

/** Explicit environment input keeps SSR deterministic; live preference subscription belongs to the caller. */
export interface ThemeMotionResolveOptions {
  readonly reducedMotion?: boolean;
}

/** Resolved values never apply themselves to a page or mutate the reference recipes. */
export interface ResolvedThemeMotion {
  readonly reducedMotion: boolean;
  readonly recipes: Readonly<ThemeMotionRecipes>;
  readonly tokens: Readonly<Record<string, string>>;
}

/**
 * Resolve visual motion without reading global media state. Reduced motion snaps
 * physical springs, zeros transition times and disables page receding; native
 * scrolling, edge geometry, hover intent, and the 1500ms confirmation hold stay.
 * Token override admission intentionally belongs to the theme facade, not here.
 */
export function resolveThemeMotion(options: ThemeMotionResolveOptions = {}): ResolvedThemeMotion {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
    || Reflect.ownKeys(options).some(key => key !== 'reducedMotion')) {
    throw new TypeError('Theme motion options must contain an optional boolean reducedMotion.');
  }
  // Snapshot getter-backed configuration before validation or policy selection.
  const { reducedMotion = false } = options;
  if (typeof reducedMotion !== 'boolean') throw new TypeError('Theme motion options must contain an optional boolean reducedMotion.');
  if (!reducedMotion) return Object.freeze({ reducedMotion, recipes: THEME_MOTION_RECIPES, tokens: THEME_MOTION_TOKENS });

  const instant = (recipe: ThemeTweenRecipe): ThemeTweenRecipe => Object.freeze({ ...recipe, animate: false, durationMs: 0 });
  const snap = <T extends ThemePhysicalSpringRecipe>(recipe: T): T => Object.freeze({ ...recipe, animate: false });
  const recipes: Readonly<ThemeMotionRecipes> = Object.freeze({
    feedbackInstant: instant(THEME_MOTION_RECIPES.feedbackInstant), feedbackFast: instant(THEME_MOTION_RECIPES.feedbackFast),
    feedbackStandard: instant(THEME_MOTION_RECIPES.feedbackStandard), feedbackConsidered: instant(THEME_MOTION_RECIPES.feedbackConsidered),
    magneticSidebar: snap(THEME_MOTION_RECIPES.magneticSidebar), magneticNavigation: snap(THEME_MOTION_RECIPES.magneticNavigation),
    pickerOpen: snap(THEME_MOTION_RECIPES.pickerOpen), pickerClose: snap(THEME_MOTION_RECIPES.pickerClose),
    pickerHighlight: snap(THEME_MOTION_RECIPES.pickerHighlight), pickerWidth: snap(THEME_MOTION_RECIPES.pickerWidth),
    pickerWidthNarrow: snap(THEME_MOTION_RECIPES.pickerWidthNarrow), pickerLabel: snap(THEME_MOTION_RECIPES.pickerLabel),
    anchoredSurface: Object.freeze({ ...THEME_MOTION_RECIPES.anchoredSurface, animate: false,
      enterDurationMs: 0, fadeDurationMs: 0, exitDurationMs: 0, offsetPx: 0, enterScale: 1, exitScale: 1 }),
    cardFeedback: Object.freeze({ ...THEME_MOTION_RECIPES.cardFeedback, animate: false, hoverLiftPx: 0, mediaZoom: 1,
      hoverInMs: 0, hoverOutMs: 0, statusEnterMs: 0, statusExitMs: 0, statusStaggerMs: 0, statusBlurPx: 0 }),
    floatingButtonGroupMove: snap(THEME_MOTION_RECIPES.floatingButtonGroupMove),
    floatingButtonGroupPress: snap(THEME_MOTION_RECIPES.floatingButtonGroupPress),
    floatingButtonGroupFeedback: Object.freeze({ ...THEME_MOTION_RECIPES.floatingButtonGroupFeedback, animate: false,
      showDurationMs: 0, hideDurationMs: 0, pressPaintDurationMs: 0, firstEntryScale: 1, pressScale: 1 }),
    floatingButtonGroupLabel: Object.freeze({ ...THEME_MOTION_RECIPES.floatingButtonGroupLabel, animate: false,
      enterDurationMs: 0, exitDurationMs: 0, enterYpx: 0, exitYpx: 0, blurPx: 0 }),
    scrollArea: Object.freeze({ ...THEME_MOTION_RECIPES.scrollArea, animate: false, showDurationMs: 0, hideDurationMs: 0 }),
    modal: Object.freeze({ ...THEME_MOTION_RECIPES.modal, animate: false, pageRecedes: false,
      originEnterMs: 0, fallbackEnterMs: 0, originExitMs: 0, fallbackExitMs: 0 }),
    tooltip: Object.freeze({ ...THEME_MOTION_RECIPES.tooltip, animate: false,
      enterDurationMs: 0, fadeDurationMs: 0, exitDurationMs: 0 }),
    chartInspector: instant(THEME_MOTION_RECIPES.chartInspector), holdToConfirm: THEME_MOTION_RECIPES.holdToConfirm,
  });
  const tokens = { ...THEME_MOTION_TOKENS };
  for (const key of REDUCED_TIMING_KEYS) tokens[key] = '0ms';
  tokens['--zero-theme-modal-page-recedes'] = 'false';
  tokens['--zero-theme-card-hover-lift'] = '0px';
  tokens['--zero-theme-card-media-zoom'] = '1';
  tokens['--zero-theme-card-status-blur'] = '0px';
  tokens['--zero-theme-floating-button-group-first-entry-scale'] = '1';
  tokens['--zero-theme-floating-button-group-press-scale'] = '1';
  tokens['--zero-theme-floating-button-group-label-enter-y'] = '0px';
  tokens['--zero-theme-floating-button-group-label-exit-y'] = '0px';
  tokens['--zero-theme-floating-button-group-label-blur'] = '0px';
  return Object.freeze({ reducedMotion, recipes, tokens: Object.freeze(tokens) });
}
