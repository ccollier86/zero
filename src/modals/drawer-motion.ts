/** Edge-facing drawer playback using the same cancellable animation ownership as managed dialogs. */
import { cancelModalAnimations, captureModalVisualState, playModalAnimation } from './modal-motion-animation';
import type { ModalAnimationPlayback, ResolvedModalMotion } from './modal-motion-types';
import type { DrawerSide } from './drawer-types';

/** Preserve interrupted presentation and settle cancellation; lifecycle and DOM removal stay in ModalManager. */
export function animateDrawer(shell: HTMLElement, side: DrawerSide, motion: ResolvedModalMotion, entering: boolean): ModalAnimationPlayback {
  const displaced = { left: 'translateX(-105%)', right: 'translateX(105%)', top: 'translateY(-105%)', bottom: 'translateY(105%)' }[side];
  const current = captureModalVisualState(shell);
  cancelModalAnimations(shell);
  const token = getComputedStyle(shell).getPropertyValue(entering ? '--zero-drawer-enter-ms' : '--zero-drawer-exit-ms').trim();
  const base = Number(token || (entering ? 320 : 240));
  const duration = motion.reducedMotion ? 1 : Math.min(4000, Math.max(1, Number.isFinite(base) ? base : 320)) * motion.durationMultiplier;
  const animation = playModalAnimation(shell, entering
    ? [{ transform: displaced, opacity: 0 }, { transform: 'none', opacity: 1 }]
    : [{ transform: current.transform, opacity: current.opacity }, { transform: motion.exit === 'fade' ? current.transform : displaced, opacity: 0 }],
  { duration, easing: motion.easing.out, fill: entering ? 'backwards' : 'forwards' });
  return { entrance: 'rise', finished: animation ? animation.finished.then(() => {}, () => {}) : Promise.resolve(),
    cancel: () => animation?.cancel(), finish: () => { if (animation && animation.playState !== 'idle') animation.finish(); } };
}
