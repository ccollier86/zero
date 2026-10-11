'use client';

/** Visual lifecycle only. Radix owns the live menu; departing paint never registers as an overlay. */
import * as React from 'react';
import { selectClipCss, selectMotionTime, selectLocalTriggerClip, selectDepartureTarget, stepSelectSpring, type SelectClip, type SelectSpring } from './select-motion-geometry';
import { selectPaintCopy, restoreSelectPaintScroll } from './select-paint';

export interface SelectPickedPaint { readonly text: string; readonly rect: DOMRect; readonly element: HTMLElement }
export interface SelectVisualSource {
  trigger: HTMLButtonElement | null;
  open: boolean;
  alive: boolean;
  picked: SelectPickedPaint | null;
  cancelPaint: (() => void) | null;
}
interface MorphOptions { readonly source: SelectVisualSource; readonly active: boolean; readonly container?: HTMLElement | null; readonly popper: boolean }

function numeric(style: CSSStyleDeclaration, local: string, canonical: string, fallback: number): number {
  const raw = style.getPropertyValue(local).trim() || style.getPropertyValue(canonical).trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= .5 ? value : fallback;
}
function radius(style: CSSStyleDeclaration): number {
  const value = parseFloat(style.borderTopLeftRadius);
  return Number.isFinite(value) ? Math.max(0, value) : 8;
}
function springs(from: SelectClip, to: SelectClip): SelectSpring[] {
  return from.map((value, i) => ({ value, velocity: 0, target: to[i]! }));
}
function asClip(states: readonly SelectSpring[]): SelectClip { return states.map(state => state.value) as unknown as SelectClip; }

/** Fixed paint follows the same portal coordinate space, including ordinary scaled portal ancestors. */
function placeFixed(element: HTMLElement, rect: DOMRect, container: HTMLElement) {
  const doc = container.ownerDocument, view = doc.defaultView!;
  const probe = doc.createElement('span');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden';
  container.append(probe); const origin = probe.getBoundingClientRect(); probe.remove();
  const sx = origin.width || 1, sy = origin.height || 1;
  Object.assign(element.style, { position: 'fixed', margin: '0', left: `${(rect.left - origin.left) / sx}px`, top: `${(rect.top - origin.top) / sy}px`,
    width: `${rect.width / sx}px`, height: `${rect.height / sy}px`, minWidth: '0', maxWidth: 'none', minHeight: '0', maxHeight: 'none',
    transform: 'none', pointerEvents: 'none', boxSizing: 'border-box' });
  return { sx, sy, view };
}

export function useSelectMorphMotion(options: MorphOptions): React.RefCallback<HTMLDivElement> {
  const latest = React.useRef(options); latest.current = options;
  const running = React.useRef<{ readonly element: HTMLDivElement; pending: boolean; cancel: () => void; release: () => void } | null>(null);
  const disposed = React.useRef(false);
  React.useLayoutEffect(() => {
    disposed.current = false;
    return () => { disposed.current = true; running.current?.cancel(); latest.current.source.cancelPaint?.(); };
  }, []);
  React.useLayoutEffect(() => {
    if (!options.active) options.source.cancelPaint?.();
  }, [options.active, options.source]);

  return React.useCallback(element => {
    if (!element) return;
    // Radix can recompose a native callback ref while retaining the same DOM node.
    // Defer disposal through the commit, so theme/selection bookkeeping cannot restart the entrance.
    const existing = running.current;
    if (existing?.element === element && existing.pending) { existing.pending = false; return existing.release; }
    const source = latest.current.source, view = element.ownerDocument.defaultView;
    if (!view) return;
    source.cancelPaint?.(); source.cancelPaint = null;
    running.current?.cancel();
    const mq = view.matchMedia('(prefers-reduced-motion: reduce)');
    const original = { clip: element.style.clipPath, opacity: element.style.opacity };
    const style = view.getComputedStyle(element);
    const grow = selectMotionTime(style.getPropertyValue('--zero-select-motion-grow'), 400);
    const width = selectMotionTime(style.getPropertyValue('--zero-select-motion-width'), 420);
    const bounce = numeric(style, '--zero-select-bounce-grow', '--zero-theme-picker-open-bounce', .12);
    const widthBounce = numeric(style, '--zero-select-bounce-width', '--zero-theme-picker-width-bounce', .16);
    let states: SelectSpring[] | null = null, frame = 0, last = 0, placed = false, stopped = false, wait = 0;
    let bounds: DOMRect | null = null;
    const lid = element.querySelector<HTMLElement>('.zero-select-lid-label');
    const value = () => source.trigger?.querySelector<HTMLElement>('[data-slot="select-value"]');
    if (lid) lid.textContent = value()?.textContent || source.trigger?.textContent || '';
    const full = (): SelectClip => [0, 0, 0, 0, radius(view.getComputedStyle(element))];
    const restore = () => { element.style.clipPath = original.clip; element.style.opacity = original.opacity; };
    const cancel = () => { stopped = true; session.pending = false; view.cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); mq.removeEventListener('change', reduced); restore(); };
    const retarget = () => {
      if (stopped || !element.isConnected || !source.trigger?.isConnected) return;
      const next = element.getBoundingClientRect();
      if (next.width <= 0 || next.height <= 0 || next.bottom < 0 || next.top > view.innerHeight || next.right < 0 || next.left > view.innerWidth) return;
      bounds = next;
      if (!states) {
        const from = selectLocalTriggerClip(next, source.trigger.getBoundingClientRect(), radius(view.getComputedStyle(source.trigger)),
          next.width / (element.offsetWidth || next.width), next.height / (element.offsetHeight || next.height));
        states = springs(from, full()); placed = true;
      } else states.forEach((state, i) => { state.target = full()[i]!; });
      if (!frame) frame = view.requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      frame = 0;
      if (stopped || !element.isConnected) return;
      if (!placed) {
        retarget();
        if (!placed && ++wait < 90) frame = view.requestAnimationFrame(tick);
        else if (!placed) { restore(); element.setAttribute('data-zero-select-motion', 'settled'); }
        return;
      }
      element.style.opacity = original.opacity;
      const dt = last ? (now - last) / 1000 : 1 / 60; last = now;
      let moving = false;
      for (const [i, state] of states!.entries()) moving = stepSelectSpring(state, mq.matches ? 0 : i === 1 || i === 3 ? width : grow, i === 1 || i === 3 ? widthBounce : bounce, dt) || moving;
      element.style.clipPath = selectClipCss(asClip(states!));
      if (moving) { element.setAttribute('data-zero-select-motion', 'opening'); frame = view.requestAnimationFrame(tick); }
      else { restore(); element.setAttribute('data-zero-select-motion', 'settled'); last = 0; }
    };
    const reduced = () => { if (mq.matches && states) { states.forEach(state => { state.value = state.target; state.velocity = 0; }); restore(); } };
    const resize = new ResizeObserver(retarget); resize.observe(element);
    const mutation = new MutationObserver(retarget); mutation.observe(element, { attributes: true, attributeFilter: ['data-side'] });
    mq.addEventListener('change', reduced);
    // Popper starts off-screen before its first placement. Never paint that initial transform.
    // Opacity (not visibility/display) preserves Radix's immediate native autofocus.
    if (!mq.matches) element.style.opacity = '0';
    frame = view.requestAnimationFrame(tick);
    const release = () => {
      session.pending = true;
      const snapshot = placed && bounds ? element.getBoundingClientRect() : null;
      const from = states ? asClip(states) : null;
      const paint = snapshot && from && !mq.matches && !disposed.current && source.alive && !source.open && latest.current.active && source.trigger?.isConnected
        ? selectPaintCopy(element) : null;
      const captured = paint ? element.ownerDocument.createElement('span').style : null;
      if (captured) {
        const current = view.getComputedStyle(element);
        for (let i = 0; i < current.length; i++) { const name = current.item(i); captured.setProperty(name, current.getPropertyValue(name)); }
      }
      queueMicrotask(() => {
        if (!session.pending || stopped) return;
        cancel(); if (running.current === session) running.current = null;
        if (paint && snapshot && from && captured && !disposed.current && source.alive && !source.open && latest.current.active)
          closePaint(paint, snapshot, from, captured, latest.current, mq);
      });
    };
    const session = { element, pending: false, cancel, release }; running.current = session;
    return release;
  }, []);
}

function closePaint(paint: HTMLElement, bounds: DOMRect, from: SelectClip, style: CSSStyleDeclaration, options: MorphOptions, mq: MediaQueryList) {
  const { source } = options, trigger = source.trigger!, doc = trigger.ownerDocument, view = doc.defaultView!;
  const container = options.container?.isConnected ? options.container : doc.body;
  paint.classList.add('zero-select-exit-paint'); paint.setAttribute('data-zero-select-paint', 'exit');
  // Preserve resolved source typography/colors outside a nearer application boundary.
  for (let i = 0; i < style.length; i++) { const name = style.item(i); if (name.startsWith('--')) paint.style.setProperty(name, style.getPropertyValue(name)); }
  for (const property of ['font-family', 'font-size', 'font-weight', 'color', 'background-color', 'border-color', 'z-index', 'color-scheme']) paint.style.setProperty(property, style.getPropertyValue(property));
  const { sx, sy } = placeFixed(paint, bounds, container); container.append(paint);
  restoreSelectPaintScroll(paint);
  const close = selectMotionTime(style.getPropertyValue('--zero-select-motion-shrink'), 340);
  const narrow = selectMotionTime(style.getPropertyValue('--zero-select-motion-width-narrow'), 420);
  const bounce = numeric(style, '--zero-select-bounce-shrink', '--zero-theme-picker-close-bounce', 0);
  const narrowBounce = numeric(style, '--zero-select-bounce-width-narrow', '--zero-theme-picker-width-narrow-bounce', 0);
  const labelBounce = numeric(style, '--zero-select-bounce-label', '--zero-theme-picker-label-bounce', .06);
  const targetClip = () => selectDepartureTarget(bounds, trigger.getBoundingClientRect(), radius(view.getComputedStyle(trigger)), sx, sy);
  const states = springs(from, targetClip().clip);
  const translation: SelectSpring[] = [{ value: 0, velocity: 0, target: 0 }, { value: 0, velocity: 0, target: 0 }];
  let frame = 0, last = 0, stopped = false, label: HTMLElement | null = null, labelTarget: HTMLElement | null = null, oldOpacity = '';
  let labelStates: SelectSpring[] | null = null;
  const labelDuration = selectMotionTime(style.getPropertyValue('--zero-select-motion-label'), 300);
  const cancel = () => {
    if (stopped) return; stopped = true; view.cancelAnimationFrame(frame); paint.remove(); label?.remove();
    doc.removeEventListener('visibilitychange', hidden);
    if (labelTarget?.style.opacity === '0') labelTarget.style.opacity = oldOpacity;
    if (source.cancelPaint === cancel) source.cancelPaint = null;
  };
  const hidden = () => { if (doc.hidden) cancel(); };
  doc.addEventListener('visibilitychange', hidden);
  source.cancelPaint = cancel;
  const picked = source.picked; source.picked = null;
  const tick = (now: number) => {
    frame = 0;
    if (stopped || source.open || !source.alive || !trigger.isConnected || !container.isConnected || mq.matches || doc.hidden) { cancel(); return; }
    if (!last && picked) {
      const target = trigger.querySelector<HTMLElement>('[data-slot="select-value"]');
      if (target?.textContent?.trim() === picked.text && target.getBoundingClientRect().width > 0) {
        // Opacity keeps the real selected value in the trigger's accessible name during its visual return.
        labelTarget = target; oldOpacity = target.style.opacity; target.style.opacity = '0';
        label = selectPaintCopy(picked.element); label.classList.add('zero-select-label-paint'); label.setAttribute('data-zero-select-paint', 'label');
        const end = target.getBoundingClientRect();
        const targetStyle = view.getComputedStyle(target);
        for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color']) label.style.setProperty(property, targetStyle.getPropertyValue(property));
        label.style.zIndex = style.zIndex;
        placeFixed(label, picked.rect, container); container.append(label);
        labelStates = springs([picked.rect.top, picked.rect.left, 0, 0, 0], [end.top, end.left, 0, 0, 0]);
        const lid = paint.querySelector<HTMLElement>('.zero-select-lid-label'); if (lid) lid.textContent = picked.text;
      }
    }
    const dt = last ? (now - last) / 1000 : 1 / 60; last = now;
    const target = targetClip();
    let moving = false;
    states.forEach((state, i) => { state.target = target.clip[i]!; const horizontal = i === 1 || i === 3;
      moving = stepSelectSpring(state, horizontal ? narrow : close, horizontal ? narrowBounce : bounce, dt) || moving; });
    translation[0]!.target = target.x; translation[1]!.target = target.y;
    for (const [i, state] of translation.entries()) moving = stepSelectSpring(state, i === 0 ? narrow : close, i === 0 ? narrowBounce : bounce, dt) || moving;
    paint.style.clipPath = selectClipCss(asClip(states));
    paint.style.transform = `translate(${translation[0]!.value.toFixed(3)}px,${translation[1]!.value.toFixed(3)}px)`;
    if (label && labelStates) {
      if (!labelTarget?.isConnected || labelTarget.textContent?.trim() !== picked!.text) {
        label.remove(); label = null; if (labelTarget?.style.opacity === '0') labelTarget.style.opacity = oldOpacity; labelTarget = null;
      } else {
        const target = labelTarget.getBoundingClientRect(); labelStates[0]!.target = target.top; labelStates[1]!.target = target.left;
      }
    }
    if (label && labelStates) {
      let labelMoving = false;
      for (const state of labelStates) labelMoving = stepSelectSpring(state, labelDuration, labelBounce, dt) || labelMoving;
      label.style.transform = `translate(${(labelStates[1]!.value - picked!.rect.left) / sx}px,${(labelStates[0]!.value - picked!.rect.top) / sy}px)`;
      if (!labelMoving) { label.remove(); label = null; if (labelTarget?.style.opacity === '0') labelTarget.style.opacity = oldOpacity; labelTarget = null; }
      moving = labelMoving || moving;
    }
    if (moving) frame = view.requestAnimationFrame(tick); else cancel();
  };
  frame = view.requestAnimationFrame(tick);
}
