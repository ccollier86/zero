/** Hand-tuned table motion contract shared by WAAPI presentation and CSS tokens. */
export const DATA_TABLE_MOTION = Object.freeze({
  ease: 'cubic-bezier(.2, 0, 0, 1)',
  ui: 120,
  fast: 350,
  base: 525,
  move: 700,
  moveExtra: 230,
  moveDistanceFactor: 0.35,
  pageOut: 230,
  odo: 525,
  height: 580,
  enterDelay: 120,
  stagger: 45,
  highlight: 2000,
  highlightHold: 0.35,
  skeletonPulse: 1400,
  skeletonOffset: 70,
  searchDebounce: 90,
  carryStagger: 30,
  loaderDelay: 300,
  loaderMinimum: 400,
  keyboardFactor: 0.7,
});

/** Distance affects settling time, never the displacement or easing curve. */
export function dataTableMoveDuration(distance: number): number {
  return DATA_TABLE_MOTION.move + Math.min(DATA_TABLE_MOTION.moveExtra, Math.abs(distance) * DATA_TABLE_MOTION.moveDistanceFactor);
}

/** Reduced motion preserves the operation but removes perceptible timing. */
export function dataTableMotionDuration(duration: number, reduced: boolean, factor = 1): number {
  return reduced ? 1 : duration * factor;
}
