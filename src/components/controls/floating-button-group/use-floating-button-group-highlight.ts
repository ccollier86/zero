'use client';

/** One paint-only motion-value layer. Owns local measurement/retargeting, not actions, roving focus, portals or data. */
import * as React from 'react';
import { animate, useMotionValue, type MotionValue } from 'motion/react';
import { observePresentationTheme } from '../../../lib/observe-presentation-theme';
import { resolveFloatingButtonGroupGeometry } from './floating-button-group-geometry';

export interface FloatingButtonGroupFeedback {
  reduced: boolean; moveMs: number; moveBounce: number; pressMs: number; pressBounce: number;
  showMs: number; hideMs: number; initialScale: number; pressScale: number; threshold: number;
  labelEnterMs: number; labelExitMs: number; labelEnterY: number; labelExitY: number; labelBlur: number;
  enterEasing: [number, number, number, number]; feedbackEasing: [number, number, number, number];
}
const FALLBACK: FloatingButtonGroupFeedback = { reduced: false, moveMs: 420, moveBounce: .16, pressMs: 260, pressBounce: .12,
  showMs: 160, hideMs: 240, initialScale: .94, pressScale: .965, threshold: .15,
  labelEnterMs: 240, labelExitMs: 160, labelEnterY: 4, labelExitY: -3, labelBlur: 4,
  enterEasing: [.16, 1, .3, 1], feedbackEasing: [.22, 1, .36, 1] };
function readEasing(style: CSSStyleDeclaration, suffix: string, fallback: [number, number, number, number]) {
  const raw = style.getPropertyValue(`--zero-floating-button-group-${suffix}`).trim();
  const match = /^cubic-bezier\(([^)]+)\)$/u.exec(raw), parts = match?.[1]?.split(',').map(Number);
  return parts?.length === 4 && parts.every(Number.isFinite) && parts[0]! >= 0 && parts[0]! <= 1 && parts[2]! >= 0 && parts[2]! <= 1
    ? parts as [number, number, number, number] : fallback;
}
function readNumber(style: CSSStyleDeclaration, suffix: string, fallback: number, min = 0, max = 10000) {
  const raw = style.getPropertyValue(`--zero-floating-button-group-${suffix}`).trim();
  const parsed = Number.parseFloat(raw), value = raw.endsWith('s') && !raw.endsWith('ms') ? parsed * 1000 : parsed;
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
function readFeedback(root: HTMLElement, reduced: boolean): FloatingButtonGroupFeedback {
  const style = root.ownerDocument.defaultView!.getComputedStyle(root);
  return { reduced,
    moveMs: reduced ? 0 : readNumber(style, 'move-duration', 420), moveBounce: readNumber(style, 'move-bounce', .16, 0, .95),
    pressMs: reduced ? 0 : readNumber(style, 'press-duration', 260), pressBounce: readNumber(style, 'press-bounce', .12, 0, .95),
    showMs: reduced ? 0 : readNumber(style, 'show-duration', 160), hideMs: reduced ? 0 : readNumber(style, 'hide-duration', 240),
    initialScale: reduced ? 1 : readNumber(style, 'first-entry-scale', .94, 0, 1),
    pressScale: reduced ? 1 : readNumber(style, 'press-scale', .965, 0, 1), threshold: readNumber(style, 'highlight-opacity-threshold', .15, 0, 1),
    labelEnterMs: reduced ? 0 : readNumber(style, 'label-enter-duration', 240), labelExitMs: reduced ? 0 : readNumber(style, 'label-exit-duration', 160),
    labelEnterY: reduced ? 0 : readNumber(style, 'label-enter-y', 4, -100, 100),
    labelExitY: reduced ? 0 : readNumber(style, 'label-exit-y', -3, -100, 100), labelBlur: reduced ? 0 : readNumber(style, 'label-blur', 4, 0, 20),
    enterEasing: readEasing(style, 'label-enter-easing', FALLBACK.enterEasing), feedbackEasing: readEasing(style, 'feedback-easing', FALLBACK.feedbackEasing) };
}

/** Motion values do not re-render commands during travel; listeners/observers are scoped to the actual tray document. */
export function useFloatingButtonGroupHighlight(root: HTMLDivElement | null, nodes: ReadonlyMap<string, HTMLButtonElement>,
  nodeVersion: number, activeId: string | null, pressing: boolean) {
  const x = useMotionValue(0), y = useMotionValue(0), width = useMotionValue(0), height = useMotionValue(0);
  const opacity = useMotionValue(0), scale = useMotionValue(1);
  const [feedback, setFeedback] = React.useState(FALLBACK);
  const latest = React.useRef({ activeId, pressing }); latest.current = { activeId, pressing };
  const refresh = React.useRef<() => void>(() => {});
  React.useLayoutEffect(() => {
    const view = root?.ownerDocument.defaultView;
    if (!root || !view) return;
    let disposed = false, frame = 0, lastPose = '', lastSettings = '', lastScale = '', lastVisibility = '';
    const controls = new Map<MotionValue<number>, { stop: () => void }>();
    const media = view.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = (value: MotionValue<number>) => { controls.get(value)?.stop(); controls.delete(value); };
    const jump = (value: MotionValue<number>, target: number) => { stop(value); value.jump(target); };
    const tween = (value: MotionValue<number>, target: number, duration: number, ease: [number, number, number, number]) => {
      stop(value); if (!duration) value.jump(target);
      else controls.set(value, animate(value, target, { duration: duration / 1000, ease }));
    };
    const spring = (value: MotionValue<number>, target: number, duration: number, bounce: number) => {
      const velocity = value.getVelocity(); stop(value);
      if (!duration) value.jump(target);
      else { const angular = 2 * Math.PI / (duration / 1000 * 1.2);
        controls.set(value, animate(value, target, { type: 'spring', mass: 1, stiffness: angular * angular,
          damping: 2 * (1 - bounce) * angular, velocity })); }
    };
    const read = () => {
      frame = 0; if (disposed) return;
      const settings = readFeedback(root, media.matches), settingsKey = JSON.stringify(settings);
      if (settingsKey !== lastSettings) { lastSettings = settingsKey; setFeedback(settings); lastPose = ''; lastScale = ''; lastVisibility = ''; }
      const target = latest.current.activeId ? nodes.get(latest.current.activeId) : undefined;
      const eligible = root.isConnected && target?.isConnected && root.contains(target) && !target.closest('[inert], [hidden], [aria-hidden="true"], [aria-disabled="true"]');
      const transforms: string[] = [];
      const inspectTransform = (element: Element) => {
        const computed = view.getComputedStyle(element);
        transforms.push(computed.transform);
        if (computed.rotate && computed.rotate !== 'none' && computed.rotate !== '0deg') transforms.push('unsupported-individual-rotation');
        if (computed.scale !== 'none' && computed.scale.split(/\s+/u).some(value => Number(value) <= 0)) transforms.push('unsupported-individual-reflection');
        if (computed.perspective && computed.perspective !== 'none') transforms.push('unsupported-perspective');
      };
      const visited = new Set<Element>();
      let ancestor: Element | null = target ?? root;
      while (ancestor && !visited.has(ancestor)) {
        visited.add(ancestor); inspectTransform(ancestor);
        const scope = ancestor.getRootNode();
        ancestor = ancestor.assignedSlot ?? ancestor.parentElement ?? ('host' in scope ? scope.host as Element : null);
      }
      const pose = eligible ? resolveFloatingButtonGroupGeometry({ ownerRect: root.getBoundingClientRect(), targetRect: target!.getBoundingClientRect(),
        ownerOffsetWidth: root.offsetWidth, ownerOffsetHeight: root.offsetHeight,
        ownerClientLeft: root.clientLeft, ownerClientTop: root.clientTop, scrollLeft: root.scrollLeft, scrollTop: root.scrollTop,
        devicePixelRatio: view.devicePixelRatio, transforms }) : null;
      const visible = !!pose;
      if (!pose) {
        if (lastVisibility !== `hidden:${settingsKey}`) { tween(opacity, 0, settings.hideMs, settings.feedbackEasing); lastVisibility = `hidden:${settingsKey}`; }
        lastPose = ''; return;
      }
      const nextPose = JSON.stringify(pose);
      if (nextPose !== lastPose) {
        const traveling = opacity.get() > settings.threshold && !settings.reduced;
        for (const [value, destination] of [[x, pose.x], [y, pose.y], [width, pose.width], [height, pose.height]] as const) {
          if (traveling) spring(value, destination, settings.moveMs, settings.moveBounce); else jump(value, destination);
        }
        if (!traveling) jump(scale, settings.initialScale);
        lastPose = nextPose; lastScale = '';
      }
      if (lastVisibility !== `visible:${settingsKey}`) { tween(opacity, visible ? 1 : 0, settings.showMs, settings.feedbackEasing); lastVisibility = `visible:${settingsKey}`; }
      const targetScale = latest.current.pressing ? settings.pressScale : 1;
      if (lastScale !== String(targetScale)) { spring(scale, targetScale, settings.pressMs, settings.pressBounce); lastScale = String(targetScale); }
    };
    const schedule = () => { if (!disposed && !frame) frame = view.requestAnimationFrame(read); };
    refresh.current = schedule;
    const Resize = view.ResizeObserver;
    const resize = Resize ? new Resize(schedule) : null;
    resize?.observe(root); for (const node of nodes.values()) resize?.observe(node);
    // Transform-only changes do not resize boxes. Observe targets/wrappers, not
    // the animated paint layer, so admission can retire unsafe geometry without
    // a per-frame style-observer feedback loop.
    const Mutation = view.MutationObserver;
    const mutation = Mutation ? new Mutation(schedule) : null;
    const observed = new Set<Element>();
    for (const node of nodes.values()) {
      let element: Element | null = node;
      while (element && element !== root && !observed.has(element)) {
        observed.add(element);
        mutation?.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'inert', 'aria-hidden'] });
        const scope = element.getRootNode();
        element = element.assignedSlot ?? element.parentElement ?? ('host' in scope ? scope.host as Element : null);
      }
    }
    const releaseTheme = observePresentationTheme(root, schedule);
    root.addEventListener('scroll', schedule, { passive: true }); view.addEventListener('resize', schedule);
    root.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
    media.addEventListener('change', read);
    read();
    return () => {
      disposed = true; view.cancelAnimationFrame(frame); resize?.disconnect(); mutation?.disconnect(); releaseTheme(); refresh.current = () => {};
      for (const control of controls.values()) control.stop(); controls.clear();
      root.removeEventListener('scroll', schedule); view.removeEventListener('resize', schedule);
      root.ownerDocument.fonts?.removeEventListener('loadingdone', schedule); media.removeEventListener('change', read);
    };
  }, [root, nodes, nodeVersion, x, y, width, height, opacity, scale]);
  React.useLayoutEffect(() => { refresh.current(); }, [activeId, pressing]);
  return { style: { x, y, width, height, opacity, scale }, feedback };
}
