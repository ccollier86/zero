/**
 * Tooltip presentation contracts. These types own motion and themed effect
 * amounts only; focus, trigger ownership, positioning and content belong to the
 * existing tooltip primitives.
 */

/** Named Tooltip Motion Kit presets; grow is the platform default. */
export type TooltipMotionPreset = 'grow' | 'spring' | 'blur' | 'swing';
/** Semantic tooltip surface; colors are inherited from the active Zero theme. */
export type TooltipVariant = 'neutral' | 'accent' | 'light';
/** Resolved floating placement, not a requested side that collision handling flipped. */
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

/** Provider defaults and per-tooltip overrides. */
export interface TooltipMotionOptions {
  readonly motion?: TooltipMotionPreset;
  /** Multiplies duration rather than velocity; .5–2.5, with 1 preserving the reference. */
  readonly durationMultiplier?: number;
  readonly arrow?: boolean;
  readonly variant?: TooltipVariant;
}

/** Effective, validated presentation options. */
export interface TooltipMotionSettings extends Required<TooltipMotionOptions> {}

/** Exact unscaled Motion Kit durations, also exposed as inherited CSS tokens. */
export interface TooltipMotionTimings {
  readonly growEnter: number; readonly growFade: number; readonly growExit: number;
  readonly springEnter: number; readonly springFade: number; readonly springExit: number;
  readonly blurEnter: number; readonly blurExit: number;
  readonly swingEnter: number; readonly swingFade: number; readonly swingExit: number;
  readonly morphMove: number; readonly morphTextOut: number; readonly morphTextIn: number; readonly morphTextDelay: number;
  readonly openDelay: number; readonly warm: number; readonly grace: number; readonly ui: number;
}

/** Hand-tuned curves, with capability-only fallbacks for sampled linear() springs. */
export interface TooltipMotionEasing {
  readonly out: string; readonly in: string; readonly soft: string;
  readonly spring: string; readonly bouncy: string;
}

/** Theme-controllable geometry and swing physics, independent from visual styling. */
export interface TooltipMotionGeometry {
  readonly gap: number; readonly gapWithoutArrow: number; readonly viewportPadding: number; readonly arrowSize: number; readonly arrowOriginOffset: number;
  readonly springScale: number; readonly springExitScale: number;
  readonly blur: number; readonly blurExit: number; readonly blurShift: number; readonly blurScale: number;
  readonly swingScale: number; readonly swingShift: number; readonly swingExitScale: number; readonly swingExitShift: number;
  readonly swingRotation: number; readonly swingDrift: number; readonly swingStiffness: number; readonly swingDamping: number;
  readonly morphTextOutX: number; readonly morphTextInX: number; readonly morphTextBlur: number;
}

/** Immutable admitted profile; callers must re-resolve live reduced-motion changes. */
export interface ResolvedTooltipMotion extends TooltipMotionSettings {
  readonly reducedMotion: boolean;
  readonly timings: Readonly<TooltipMotionTimings>;
  readonly easing: Readonly<TooltipMotionEasing>;
  readonly geometry: Readonly<TooltipMotionGeometry>;
}

/** Owned completion settles after either natural finish or cancellation. */
export interface TooltipAnimationPlayback {
  readonly finished: Promise<void>;
  cancel(): void;
  finish(): void;
}

/** Cursor motion is opt-in and must be stopped on close or owner retirement. */
export interface TooltipSwingController {
  track(trigger: Element, clientX: number): void;
  stop(): void;
  reset(): void;
}
