/**
 * Coordinates shared backdrop/page presentation on explicitly supplied safe
 * surfaces. The modal host owns owner leases, inert/scroll/focus and layer removal;
 * this controller owns only its own effects and exact style restoration.
 */
import { cancelModalAnimations, captureModalVisualState, finishModalAnimations, playModalAnimation } from './modal-motion-animation';
import type { ResolvedModalMotion } from './modal-motion-types';

/** Host-derived scene demand; do not infer owners from DOM or a global app root. */
export interface ModalSceneMotionState {
  readonly visible: boolean;
  readonly recedes: boolean;
  readonly motion: ResolvedModalMotion;
}

/** A single host controller with epoch-safe cleanup for rapid close/reopen. */
export interface ModalSceneMotionController {
  update(state: ModalSceneMotionState): Promise<void>;
  /** Finish presentation immediately without changing the host's leases. */
  finish(): void;
  /** Retire effects and restore precisely the supplied elements' original styles. */
  dispose(): void;
}

type SurfaceProperty = 'transform' | 'transform-origin' | 'border-radius' | 'overflow' | 'will-change';
const surfaceProperties: SurfaceProperty[] = ['transform', 'transform-origin', 'border-radius', 'overflow', 'will-change'];
const backdropProperties = ['opacity', 'backdrop-filter', '-webkit-backdrop-filter'] as const;

function snapshot(element: HTMLElement, properties: readonly string[]) {
  return new Map(properties.map(property => [property, { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) }]));
}

function restore(element: HTMLElement, values: Map<string, { value: string; priority: string }>): void {
  for (const [property, { value, priority }] of values) {
    if (value) element.style.setProperty(property, value, priority); else element.style.removeProperty(property);
  }
}

/** Create one presentation owner; a missing safe recede surface is a graceful no-op. */
export function createModalSceneMotion(backdrop: HTMLElement, surface: HTMLElement | null = null): ModalSceneMotionController {
  const backdropStyles = snapshot(backdrop, backdropProperties);
  let surfaceStyles: ReturnType<typeof snapshot> | null = null;
  let baseTransform = 'none'; let baseRadius = '0px';
  let epoch = 0; let retired = false;
  let previousVisible = false; let previousRecede = false;
  let previousBackdrop = ''; let previousReduced = false;
  let surfaceAnimation: Animation | null = null;
  let backdropAnimation: Animation | null = null;
  let settlement = Promise.resolve();

  function restoreSurface() {
    if (surface && surfaceStyles) { restore(surface, surfaceStyles); surfaceStyles = null; }
  }

  return {
    update(state) {
      if (retired) return Promise.resolve();
      const { motion } = state;
      const recede = !!surface && state.recedes && !motion.reducedMotion;
      if (state.visible === previousVisible && recede === previousRecede
        && previousBackdrop === motion.backdrop && previousReduced === motion.reducedMotion) return settlement;
      const myEpoch = ++epoch;
      const animations: (Animation | null)[] = [];
      const reducedChanged = previousReduced !== motion.reducedMotion;
      const backdropChanged = previousBackdrop !== motion.backdrop;
      const currentBackdrop = captureModalVisualState(backdrop);
      // The active modal controls backdrop policy. A fixed blur fades with opacity,
      // never animating backdrop-filter every frame or creating another backdrop.
      const css = backdrop.ownerDocument.defaultView?.CSS ?? (typeof CSS !== 'undefined' ? CSS : undefined);
      const supportedBlur = !css?.supports || css.supports('backdrop-filter', 'blur(1px)') || css.supports('-webkit-backdrop-filter', 'blur(1px)');
      const blur = motion.backdrop === 'blur' && supportedBlur && !motion.reducedMotion
        ? `blur(${motion.geometry.backdropBlur}px)` : 'none';
      backdrop.style.setProperty('backdrop-filter', blur);
      backdrop.style.setProperty('-webkit-backdrop-filter', blur);
      if (state.visible !== previousVisible || reducedChanged || backdropChanged) {
        cancelModalAnimations(backdrop);
        backdropAnimation = null;
        const target = state.visible ? '1' : '0';
        backdrop.style.opacity = target;
        backdropAnimation = playModalAnimation(backdrop, [{ opacity: currentBackdrop.opacity }, { opacity: target }], {
          duration: motion.reducedMotion ? 1 : state.visible ? motion.timings.backdropIn : motion.timings.backdropOut, easing: 'linear',
        });
      }
      animations.push(backdropAnimation);
      if (surface && (recede !== previousRecede || reducedChanged)) {
        const current = captureModalVisualState(surface);
        cancelModalAnimations(surface);
        // WAAPI creates a new pending finished promise after cancellation. A
        // reduced-preference change with no surface styles has no replacement
        // effect, so retaining the cancelled handle would strand the host lease.
        surfaceAnimation = null;
        if (recede && !surfaceStyles) {
          surfaceStyles = snapshot(surface, surfaceProperties);
          baseTransform = current.transform; baseRadius = current.borderRadius;
        }
        if (surfaceStyles) {
          const target = recede ? `${baseTransform === 'none' ? '' : `${baseTransform} `}scale(${motion.geometry.recedeScale})` : baseTransform;
          const radius = recede ? motion.geometry.recedeRadius : baseRadius;
          surface.style.transformOrigin = motion.geometry.recedeOrigin;
          surface.style.overflow = 'hidden';
          surface.style.willChange = 'transform';
          surface.style.transform = target; surface.style.borderRadius = radius;
          const targetRadius = captureModalVisualState(surface).borderRadius;
          surfaceAnimation = playModalAnimation(surface, [{ transform: current.transform, borderRadius: current.borderRadius }, { transform: target, borderRadius: targetRadius }], {
            duration: motion.reducedMotion ? 1 : recede ? motion.timings.recedeIn : motion.timings.recedeOut,
            easing: recede ? motion.easing.spring : motion.easing.out,
          });
        }
      }
      animations.push(surfaceAnimation);
      previousVisible = state.visible; previousRecede = recede; previousBackdrop = motion.backdrop; previousReduced = motion.reducedMotion;
      settlement = Promise.all(animations.filter((a): a is Animation => !!a).map(a => a.finished.catch(() => {}))).then(() => {
        if (retired || epoch !== myEpoch) return;
        if (!recede) restoreSurface();
        else if (surface && surfaceStyles) {
          const original = surfaceStyles.get('will-change');
          if (original?.value) surface.style.setProperty('will-change', original.value, original.priority); else surface.style.removeProperty('will-change');
        }
      });
      return settlement;
    },
    finish() { finishModalAnimations(backdrop); if (surface) finishModalAnimations(surface); },
    dispose() {
      if (retired) return;
      retired = true; epoch += 1;
      cancelModalAnimations(backdrop); restore(backdrop, backdropStyles);
      if (surface) cancelModalAnimations(surface);
      restoreSurface();
    },
  };
}

/** Bound step-back geometry without mixing it into shell/origin transforms. */
export function modalStackTransform(depth: number, motion: ResolvedModalMotion): string {
  const admitted = Number.isFinite(depth) ? Math.max(0, Math.min(6, Math.trunc(depth))) : 0;
  return `translateY(${motion.geometry.stackY * admitted}px) scale(${Math.max(.5, 1 - motion.geometry.stackScale * admitted)})`;
}
