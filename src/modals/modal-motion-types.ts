/**
 * Modal presentation contracts. These types describe motion only; they do not
 * admit actions, choose focus, own records, or change the modal lifecycle.
 */

/** Named Motion Lab entrances; origin safely falls back to rise. */
export type ModalMotionEntrance = 'rise' | 'grow' | 'origin' | 'spring' | 'focus' | 'drop';

/** Application/provider defaults and per-instance presentation overrides. */
export interface ModalMotionOptions {
  readonly entrance?: ModalMotionEntrance;
  readonly exit?: 'mirror' | 'fade';
  readonly backdrop?: 'dim' | 'blur';
  readonly pageRecedes?: boolean;
  /** Multiplies duration, not velocity: 1.5 is slower. Allowed range .5–2.5. */
  readonly durationMultiplier?: number;
}

/** Frozen effective options after provider/theme/call admission. */
export interface ModalMotionSettings extends Required<ModalMotionOptions> {}

/** Exact base timing names, also exposed as inherited CSS tokens. */
export interface ModalMotionTimings {
  readonly riseEnter: number; readonly riseFade: number; readonly riseExit: number;
  readonly growEnter: number; readonly growFade: number; readonly growExit: number;
  readonly originEnter: number; readonly originFade: number; readonly originExit: number;
  readonly originShellFade: number; readonly originContentDelay: number; readonly originContentExit: number;
  readonly springEnter: number; readonly springFade: number; readonly springExit: number;
  readonly focusEnter: number; readonly focusFade: number; readonly focusExit: number;
  readonly dropEnter: number; readonly dropFade: number; readonly dropExit: number;
  readonly fadeExit: number; readonly backdropIn: number; readonly backdropOut: number;
  readonly recedeIn: number; readonly recedeOut: number; readonly stack: number;
  readonly tabs: number; readonly nudge: number; readonly ui: number;
}

/** Theme-resolved Motion Lab curves; sampled springs never become library presets. */
export interface ModalMotionEasing {
  readonly out: string; readonly in: string; readonly soft: string;
  readonly spring: string; readonly bouncy: string;
}

/** Theme-controllable effect amounts, separate from layout and visual styling. */
export interface ModalMotionGeometry {
  readonly riseY: number; readonly riseScale: number; readonly riseExitY: number;
  readonly growScale: number; readonly growExitScale: number;
  readonly springScale: number; readonly springExitScale: number;
  readonly focusScale: number; readonly focusBlur: number; readonly focusExitScale: number; readonly focusExitBlur: number;
  readonly dropY: number; readonly dropExitY: number; readonly fadeExitScale: number;
  readonly backdropBlur: number; readonly recedeScale: number; readonly recedeOrigin: string;
  readonly recedeRadius: string; readonly stackY: number; readonly stackScale: number;
}

/** One admitted profile. Live reduced-motion preference must override its timing. */
export interface ResolvedModalMotion extends ModalMotionSettings {
  readonly reducedMotion: boolean;
  readonly timings: Readonly<ModalMotionTimings>;
  readonly easing: Readonly<ModalMotionEasing>;
  readonly geometry: Readonly<ModalMotionGeometry>;
}

/** Owned animation completion always settles, including cancellation or retirement. */
export interface ModalAnimationPlayback {
  readonly finished: Promise<void>;
  /** Actual entrance, not a requested origin that fell back to rise. */
  readonly entrance: ModalMotionEntrance;
  cancel(): void;
  finish(): void;
}
