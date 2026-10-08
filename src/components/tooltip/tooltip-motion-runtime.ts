/**
 * Interruptible, owned tooltip visual playback using the browser Animation API.
 * This module consumes resolved motion only; it does not install global handlers,
 * move focus, own portal roots or decide whether a tooltip should be visible.
 */
import type { ResolvedTooltipMotion, TooltipAnimationPlayback, TooltipSide, TooltipSwingController } from './tooltip-motion-types';

/** Current composited pose captured before cancelling an interrupted owned effect. */
export interface TooltipVisualState { readonly transform: string; readonly opacity: string; readonly filter: string }
/** HTML visual surfaces and Floating UI's SVG arrow share the same ownership boundary. */
export type TooltipAnimationElement = HTMLElement | SVGElement;
const owned = new WeakMap<TooltipAnimationElement, Set<Animation>>();

/** Capture the on-screen pose, including in-flight composited transforms. */
export function captureTooltipVisualState(element: HTMLElement): TooltipVisualState {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return { transform: style?.transform || 'none', opacity: style?.opacity || '1', filter: style?.filter || 'none' };
}

/** Play an owned effect without touching animations created by consumer content. */
export function playTooltipAnimation(element: TooltipAnimationElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof element.animate !== 'function') return null;
  const animation = element.animate(keyframes, options);
  const group = owned.get(element) ?? new Set<Animation>();
  group.add(animation); owned.set(element, group);
  void animation.finished.catch(() => {}).then(() => {
    // Filled exits must stay owned until their visual node is retired or reopened.
    if (options.fill !== 'forwards' && options.fill !== 'both') group.delete(animation);
    if (!group.size && owned.get(element) === group) owned.delete(element);
  });
  return animation;
}

/** Cancel only this tooltip runtime's effects. Read the visual state first when retargeting. */
export function cancelTooltipAnimations(element: TooltipAnimationElement): void {
  const group = owned.get(element); owned.delete(element);
  group?.forEach(animation => animation.cancel());
}

/** Settle owned effects promptly, for live reduced-motion changes or retirement. */
export function finishTooltipAnimations(element: TooltipAnimationElement): void {
  owned.get(element)?.forEach(animation => { if (animation.playState !== 'idle') animation.finish(); });
}

function playback(element: HTMLElement, animations: Array<Animation | null>): TooltipAnimationPlayback {
  const active = animations.filter((animation): animation is Animation => animation !== null);
  return {
    finished: Promise.all(active.map(animation => animation.finished.catch(() => {}))).then(() => {}),
    cancel: () => {
      active.forEach(animation => animation.cancel());
      const group = owned.get(element); active.forEach(animation => group?.delete(animation));
      if (!group?.size) owned.delete(element);
    },
    finish: () => active.forEach(animation => { if (animation.playState !== 'idle') animation.finish(); }),
  };
}

function nudge(side: TooltipSide, distance: number): string {
  return side === 'top' ? `translateY(${distance}px)` : side === 'bottom' ? `translateY(${-distance}px)`
    : side === 'left' ? `translateX(${distance}px)` : `translateX(${-distance}px)`;
}

/** Open from the arrow tip or supplied facing-edge origin, preserving interrupted poses. */
export function playTooltipEnter(element: HTMLElement, motion: ResolvedTooltipMotion, side: TooltipSide = 'top', origin?: string, startingPose?: TooltipVisualState): TooltipAnimationPlayback {
  const interrupted = !!startingPose || !!owned.get(element)?.size;
  const current = startingPose ?? captureTooltipVisualState(element);
  cancelTooltipAnimations(element);
  if (origin) element.style.transformOrigin = origin;
  if (motion.reducedMotion) return playback(element, [playTooltipAnimation(element,
    [{ transform: 'none', opacity: 1, filter: 'none' }, { transform: 'none', opacity: 1, filter: 'none' }], { duration: 1 })]);
  const g = motion.geometry; const t = motion.timings; const e = motion.easing;
  if (motion.motion === 'blur') return playback(element, [playTooltipAnimation(element,
    [{ opacity: interrupted ? current.opacity : 0, filter: interrupted ? current.filter : `blur(${g.blur}px)`,
      transform: interrupted ? current.transform : `${nudge(side, g.blurShift)} scale(${g.blurScale})` },
    { opacity: 1, filter: 'none', transform: 'none' }], { duration: t.blurEnter, easing: e.soft })]);
  const transform = motion.motion === 'grow' ? 'scale(0)' : motion.motion === 'spring' ? `scale(${g.springScale})`
    : `translateY(${side === 'bottom' ? -g.swingShift : g.swingShift}px) scale(${g.swingScale})`;
  const duration = motion.motion === 'grow' ? t.growEnter : motion.motion === 'spring' ? t.springEnter : t.swingEnter;
  const fade = motion.motion === 'grow' ? t.growFade : motion.motion === 'spring' ? t.springFade : t.swingFade;
  const easing = motion.motion === 'grow' ? e.out : motion.motion === 'spring' ? e.spring : e.bouncy;
  return playback(element, [
    playTooltipAnimation(element, [{ transform: interrupted ? current.transform : transform, filter: interrupted ? current.filter : 'none' },
      { transform: 'none', filter: 'none' }], { duration, easing }),
    playTooltipAnimation(element, [{ opacity: interrupted ? current.opacity : 0 }, { opacity: 1 }], { duration: fade, easing: e.out }),
  ]);
}

/** Close from the current on-screen pose; caller owns removal after the settled completion. */
export function playTooltipExit(element: HTMLElement, motion: ResolvedTooltipMotion, side: TooltipSide = 'top', origin?: string): TooltipAnimationPlayback {
  const current = captureTooltipVisualState(element); cancelTooltipAnimations(element);
  if (origin) element.style.transformOrigin = origin;
  const start: Keyframe = { transform: current.transform, opacity: current.opacity, filter: current.filter };
  if (motion.reducedMotion) return playback(element, [playTooltipAnimation(element, [start, { opacity: 0 }], { duration: 1, fill: 'forwards' })]);
  const g = motion.geometry; const t = motion.timings; const e = motion.easing;
  if (motion.motion === 'grow') return playback(element, [playTooltipAnimation(element,
    [{ ...start, offset: 0 }, { opacity: current.opacity, offset: .55 }, { opacity: 0, transform: 'scale(0)', filter: 'none' }],
    { duration: t.growExit, easing: e.in, fill: 'forwards' })]);
  if (motion.motion === 'spring') return playback(element, [playTooltipAnimation(element,
    [start, { opacity: 0, transform: `scale(${g.springExitScale})`, filter: 'none' }], { duration: t.springExit, easing: e.out, fill: 'forwards' })]);
  if (motion.motion === 'blur') return playback(element, [playTooltipAnimation(element,
    [start, { opacity: 0, filter: `blur(${g.blurExit}px)` }], { duration: t.blurExit, easing: e.out, fill: 'forwards' })]);
  return playback(element, [playTooltipAnimation(element,
    [start, { opacity: 0, transform: `translateY(${side === 'bottom' ? -g.swingExitShift : g.swingExitShift}px) scale(${g.swingExitScale})`, filter: 'none' }],
    { duration: t.swingExit, easing: e.in, fill: 'forwards' })]);
}

/** Opt-in cursor drift on a separate wrapper, with explicit cleanup and no idle RAF loop. */
export function createTooltipSwingController(element: HTMLElement, motion: ResolvedTooltipMotion): TooltipSwingController {
  const view = element.ownerDocument.defaultView;
  let frame = 0; let last = 0; let rotation = 0; let rotationVelocity = 0; let drift = 0; let driftVelocity = 0;
  let targetRotation = 0; let targetDrift = 0; let stopped = false;
  const tick = (now: number) => {
    frame = 0;
    if (stopped || !view || !element.isConnected || motion.reducedMotion) return;
    const dt = Math.min(.032, (now - last) / 1000) / motion.durationMultiplier; last = now;
    const g = motion.geometry;
    rotationVelocity += (-g.swingStiffness * (rotation - targetRotation) - g.swingDamping * rotationVelocity) * dt;
    rotation += rotationVelocity * dt;
    driftVelocity += (-g.swingStiffness * (drift - targetDrift) - g.swingDamping * driftVelocity) * dt;
    drift += driftVelocity * dt;
    element.style.transform = `translateX(${drift.toFixed(2)}px) rotate(${rotation.toFixed(2)}deg)`;
    if (Math.max(Math.abs(rotation - targetRotation), Math.abs(drift - targetDrift), Math.abs(rotationVelocity), Math.abs(driftVelocity)) > .001) {
      frame = view.requestAnimationFrame(tick);
    }
  };
  const stop = () => { stopped = true; if (frame) view?.cancelAnimationFrame(frame); frame = 0; };
  return {
    track: (trigger, clientX) => {
      if (motion.reducedMotion || !view || !element.isConnected || !trigger.isConnected || trigger.ownerDocument !== element.ownerDocument || !Number.isFinite(clientX)) return;
      const rect = trigger.getBoundingClientRect(); if (!(rect.width > 0)) return;
      const offset = Math.max(-1, Math.min(1, (clientX - (rect.left + rect.width / 2)) / (rect.width / 2)));
      targetRotation = offset * motion.geometry.swingRotation; targetDrift = offset * motion.geometry.swingDrift;
      stopped = false;
      if (!frame) { last = view.performance.now(); frame = view.requestAnimationFrame(tick); }
    },
    stop,
    reset: () => { stop(); rotation = rotationVelocity = drift = driftVelocity = targetRotation = targetDrift = 0; element.style.transform = ''; },
  };
}
