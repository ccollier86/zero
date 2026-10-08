/**
 * Interruptible, instance-owned Web Animations playback for modal shells.
 * Layout/stack transforms must live on separate elements. This module never
 * changes focus, removes a modal, owns scroll locks, or runs application actions.
 */
import type { ModalAnimationPlayback, ModalMotionEntrance, ResolvedModalMotion } from './modal-motion-types';

interface VisualState { transform: string; opacity: string; filter: string; borderRadius: string }
interface OwnedAnimation { animations: Animation[] }
const owned = new WeakMap<HTMLElement, OwnedAnimation>();
const nudges = new WeakMap<HTMLElement, Animation>();

/** Capture current composited presentation before retiring only our own animations. */
export function captureModalVisualState(element: HTMLElement): VisualState {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return { transform: style?.transform || 'none', opacity: style?.opacity || '1',
    filter: style?.filter || 'none', borderRadius: style?.borderRadius || '0px' };
}

/** Begin owned playback; the returned completion also settles on cancellation. */
export function playModalAnimation(element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof element.animate !== 'function') return null;
  // Exact linear() support is resolved before playback, not approximated by a spring library.
  const animation = element.animate(keyframes, options);
  const group = owned.get(element) ?? { animations: [] };
  group.animations.push(animation);
  owned.set(element, group);
  // A rejected finished promise is normal when an instance retires or retargets.
  void animation.finished.catch(() => {});
  return animation;
}

/** Retire presentation effects without cancelling animations owned by consumer content. */
export function cancelModalAnimations(element: HTMLElement): void {
  const group = owned.get(element);
  owned.delete(element);
  group?.animations.forEach(animation => animation.cancel());
}

/** Settle owned effects immediately, e.g. after a live reduced-motion change. */
export function finishModalAnimations(element: HTMLElement): void {
  owned.get(element)?.animations.forEach(animation => {
    if (animation.playState !== 'idle') animation.finish();
  });
}

/** Required-step feedback adds to, rather than interrupts, the shell's entrance. */
export function animateModalNudge(shell: HTMLElement, motion: ResolvedModalMotion): void {
  if (motion.reducedMotion) return;
  nudges.get(shell)?.cancel();
  const animation = playModalAnimation(shell,
    [{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }],
    { duration: motion.timings.nudge, easing: motion.easing.out, composite: 'add' });
  if (animation) {
    nudges.set(shell, animation);
    void animation.finished.catch(() => {}).then(() => {
      if (nudges.get(shell) === animation) nudges.delete(shell);
    });
  }
}

function supports(element: Element, property: string, value: string): boolean {
  const css = element.ownerDocument.defaultView?.CSS ?? (typeof CSS !== 'undefined' ? CSS : undefined);
  return !css?.supports || css.supports(property, value);
}

/** Check current visibility/document ownership; stale/offscreen triggers cannot fly back. */
export function usableModalTrigger(trigger: Element | null | undefined, shell: HTMLElement): trigger is Element {
  if (!trigger?.isConnected || !shell.isConnected || trigger.ownerDocument !== shell.ownerDocument) return false;
  if (typeof trigger.checkVisibility === 'function' && !trigger.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const view = shell.ownerDocument.defaultView;
  const triggerRect = trigger.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  const values = [triggerRect.left, triggerRect.top, triggerRect.width, triggerRect.height,
    shellRect.left, shellRect.top, shellRect.width, shellRect.height];
  if (!values.every(Number.isFinite) || triggerRect.width <= 0 || triggerRect.height <= 0 || shellRect.width <= 0 || shellRect.height <= 0) return false;
  const style = view?.getComputedStyle(trigger);
  if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || Number(style?.opacity ?? '1') === 0) return false;
  const viewport = view?.visualViewport;
  const left = viewport?.offsetLeft ?? 0; const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? view?.innerWidth ?? shell.ownerDocument.documentElement.clientWidth;
  const height = viewport?.height ?? view?.innerHeight ?? shell.ownerDocument.documentElement.clientHeight;
  return triggerRect.left < left + width && triggerRect.left + triggerRect.width > left
    && triggerRect.top < top + height && triggerRect.top + triggerRect.height > top;
}

/** Trigger-to-final-shell geometry uses one viewport coordinate space and independent scales. */
export function modalOriginTransform(trigger: Element | null | undefined, shell: HTMLElement): string | null {
  if (!usableModalTrigger(trigger, shell)) return null;
  const a = trigger.getBoundingClientRect(); const b = shell.getBoundingClientRect();
  const dx = a.left + a.width / 2 - (b.left + b.width / 2); const dy = a.top + a.height / 2 - (b.top + b.height / 2);
  const sx = a.width / b.width; const sy = a.height / b.height;
  if (![dx, dy, sx, sy].every(Number.isFinite) || sx <= 0 || sy <= 0) return null;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

function entranceFrames(kind: Exclude<ModalMotionEntrance, 'origin'>, motion: ResolvedModalMotion, blur: boolean): Keyframe[] {
  const g = motion.geometry;
  switch (kind) {
    case 'rise': return [{ transform: `translateY(${g.riseY}px) scale(${g.riseScale})` }, { transform: 'none' }];
    case 'grow': return [{ transform: `scale(${g.growScale})` }, { transform: 'none' }];
    case 'spring': return [{ transform: `scale(${g.springScale})` }, { transform: 'none' }];
    case 'drop': return [{ transform: `translateY(${g.dropY}px)` }, { transform: 'none' }];
    case 'focus': return blur
      ? [{ transform: `scale(${g.focusScale})`, filter: `blur(${g.focusBlur}px)` }, { transform: 'none', filter: 'blur(0px)' }]
      : [{ transform: `scale(${g.focusScale})` }, { transform: 'none' }];
  }
}

function exitFrames(kind: Exclude<ModalMotionEntrance, 'origin'>, motion: ResolvedModalMotion, current: VisualState, blur: boolean): Keyframe[] {
  const g = motion.geometry;
  const start = { opacity: current.opacity, transform: current.transform, ...(blur ? { filter: current.filter } : {}) };
  switch (kind) {
    case 'rise': return [start, { opacity: 0, transform: `translateY(${g.riseExitY}px) scale(${g.riseScale})` }];
    case 'grow': return [start, { opacity: 0, transform: `scale(${g.growExitScale})` }];
    case 'spring': return [start, { opacity: 0, transform: `scale(${g.springExitScale})` }];
    case 'drop': return [start, { opacity: 0, transform: `translateY(${g.dropExitY}px)` }];
    case 'focus': return [start, { opacity: 0, transform: `scale(${g.focusExitScale})`, ...(blur ? { filter: `blur(${g.focusExitBlur}px)` } : {}) }];
  }
}

function easing(kind: Exclude<ModalMotionEntrance, 'origin'>, motion: ResolvedModalMotion): string {
  return kind === 'grow' ? motion.easing.out : kind === 'spring' ? motion.easing.bouncy : kind === 'focus' ? motion.easing.soft : motion.easing.spring;
}

function playback(elements: HTMLElement[], animations: (Animation | null)[], entrance: ModalMotionEntrance): ModalAnimationPlayback {
  const active = animations.filter((animation): animation is Animation => animation !== null);
  return { entrance, finished: Promise.all(active.map(animation => animation.finished.catch(() => {}))).then(() => {}),
    cancel: () => {
      active.forEach(animation => animation.cancel());
      for (const element of elements) {
        const group = owned.get(element);
        if (group) group.animations = group.animations.filter(animation => !active.includes(animation));
      }
    },
    finish: () => active.forEach(animation => { if (animation.playState !== 'idle') animation.finish(); }) };
}

/** Open the shell promptly. Origin without a currently usable initiating control uses rise. */
export function animateModalIn(shell: HTMLElement, inner: HTMLElement | null, trigger: Element | null | undefined, motion: ResolvedModalMotion): ModalAnimationPlayback {
  const interrupted = !!owned.get(shell)?.animations.length;
  const current = captureModalVisualState(shell);
  const innerCurrent = inner ? captureModalVisualState(inner) : null;
  cancelModalAnimations(shell); if (inner) cancelModalAnimations(inner);
  const elements = inner ? [shell, inner] : [shell];
  if (motion.reducedMotion) {
    return playback(elements, [playModalAnimation(shell, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: 'none', filter: 'none', opacity: 1 }], { duration: 1 })], 'rise');
  }
  const from = motion.entrance === 'origin' ? modalOriginTransform(trigger, shell) : null;
  const kind = motion.entrance === 'origin' && !from ? 'rise' : motion.entrance;
  const t = motion.timings;
  if (kind === 'origin' && from) {
    const final = captureModalVisualState(shell);
    const triggerRadius = trigger ? trigger.ownerDocument.defaultView?.getComputedStyle(trigger).borderRadius : final.borderRadius;
    const animations = [
      playModalAnimation(shell, [{ transform: interrupted ? current.transform : from, borderRadius: interrupted ? current.borderRadius : triggerRadius || final.borderRadius }, { transform: 'none', borderRadius: final.borderRadius }], { duration: t.originEnter, easing: motion.easing.spring }),
      playModalAnimation(shell, [{ opacity: interrupted ? current.opacity : 0 }, { opacity: 1 }], { duration: t.originShellFade, easing: motion.easing.out }),
      inner ? playModalAnimation(inner, [{ opacity: interrupted ? innerCurrent?.opacity ?? 0 : 0 }, { opacity: 1 }], { duration: t.originFade, delay: t.originContentDelay, easing: motion.easing.out, fill: 'backwards' }) : null,
    ];
    return playback(elements, animations, 'origin');
  }
  const preset = kind as Exclude<ModalMotionEntrance, 'origin'>;
  const frames = entranceFrames(preset, motion, supports(shell, 'filter', 'blur(1px)'));
  if (interrupted) frames[0] = { ...frames[0], transform: current.transform, ...(preset === 'focus' ? { filter: current.filter } : {}) };
  return playback(elements, [
    playModalAnimation(shell, frames, { duration: t[`${preset}Enter`], easing: easing(preset, motion) }),
    playModalAnimation(shell, [{ opacity: interrupted ? current.opacity : 0 }, { opacity: 1 }], { duration: t[`${preset}Fade`], easing: motion.easing.out }),
  ], preset);
}

/** Exit from the current composited state. Lost origin triggers use rise, never stale geometry. */
export function animateModalOut(shell: HTMLElement, inner: HTMLElement | null, trigger: Element | null | undefined, motion: ResolvedModalMotion, entered: ModalMotionEntrance = motion.entrance): ModalAnimationPlayback {
  const current = captureModalVisualState(shell); const innerCurrent = inner ? captureModalVisualState(inner) : null;
  cancelModalAnimations(shell); if (inner) cancelModalAnimations(inner);
  const elements = inner ? [shell, inner] : [shell]; const t = motion.timings;
  if (motion.reducedMotion) return playback(elements, [playModalAnimation(shell, [{ opacity: current.opacity }, { opacity: 0 }], { duration: 1, fill: 'forwards' })], entered);
  if (motion.exit === 'fade') return playback(elements, [playModalAnimation(shell,
    [{ opacity: current.opacity, transform: current.transform, filter: current.filter }, { opacity: 0, transform: `scale(${motion.geometry.fadeExitScale})`, filter: 'none' }],
    { duration: t.fadeExit, easing: motion.easing.out, fill: 'forwards' })], entered);
  const to = entered === 'origin' ? modalOriginTransform(trigger, shell) : null;
  if (entered === 'origin' && to) {
    const radius = trigger?.ownerDocument.defaultView?.getComputedStyle(trigger).borderRadius || current.borderRadius;
    const opacity = Number(current.opacity);
    const returnOpacity = Number.isFinite(opacity) ? Math.min(.9, Math.max(0, opacity)) : .9;
    return playback(elements, [
      inner ? playModalAnimation(inner, [{ opacity: innerCurrent?.opacity ?? 1 }, { opacity: 0 }], { duration: t.originContentExit, easing: motion.easing.out, fill: 'forwards' }) : null,
      playModalAnimation(shell, [{ transform: current.transform, opacity: current.opacity, borderRadius: current.borderRadius },
        { transform: to, opacity: returnOpacity, borderRadius: radius, offset: .85 }, { transform: to, opacity: 0, borderRadius: radius }],
      { duration: t.originExit, easing: motion.easing.out, fill: 'forwards' }),
    ], entered);
  }
  const preset = entered === 'origin' ? 'rise' : entered;
  return playback(elements, [playModalAnimation(shell, exitFrames(preset, motion, current, supports(shell, 'filter', 'blur(1px)')),
    { duration: t[`${preset}Exit`], easing: motion.easing.in, fill: 'forwards' })], preset);
}
