'use client';

/** One moving material behind stationary native options, measured in the actual viewport's coordinates. */
import * as React from 'react';
import { selectMotionTime, stepSelectSpring, type SelectSpring } from './select-motion-geometry';

export function useSelectMagnetic(viewport: HTMLElement | null) {
  React.useLayoutEffect(() => {
    const view = viewport?.ownerDocument.defaultView;
    if (!viewport?.isConnected || !view) return;
    const paint = viewport.ownerDocument.createElement('span');
    paint.className = 'zero-select-highlight'; paint.setAttribute('aria-hidden', 'true'); paint.inert = true;
    viewport.append(paint); viewport.setAttribute('data-zero-select-magnetic', '');
    const states: SelectSpring[] = Array.from({ length: 4 }, () => ({ value: 0, target: 0, velocity: 0 }));
    const mq = view.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = 0, initialized = false, duration = 280, bounce = .08;
    const draw = () => {
      paint.style.transform = `translate(${states[0]!.value.toFixed(3)}px,${states[1]!.value.toFixed(3)}px)`;
      paint.style.width = `${Math.max(0, states[2]!.value).toFixed(3)}px`;
      paint.style.height = `${Math.max(0, states[3]!.value).toFixed(3)}px`;
    };
    const tick = (now: number) => {
      frame = 0;
      if (!viewport.isConnected) return;
      const dt = last ? (now - last) / 1000 : 1 / 60; last = now;
      let moving = false;
      for (const state of states) moving = stepSelectSpring(state, mq.matches ? 0 : duration, bounce, dt) || moving;
      draw();
      if (moving) frame = view.requestAnimationFrame(tick); else last = 0;
    };
    const update = () => {
      const item = viewport.querySelector<HTMLElement>('.zero-select-item[data-highlighted]:not([data-disabled])');
      if (!item) { paint.style.opacity = '0'; return; }
      const a = viewport.getBoundingClientRect(), b = item.getBoundingClientRect();
      const sx = a.width / (viewport.offsetWidth || a.width) || 1, sy = a.height / (viewport.offsetHeight || a.height) || 1;
      const target = [(b.left - a.left) / sx + viewport.scrollLeft - viewport.clientLeft,
        (b.top - a.top) / sy + viewport.scrollTop - viewport.clientTop, b.width / sx, b.height / sy];
      const style = view.getComputedStyle(viewport);
      duration = selectMotionTime(style.getPropertyValue('--zero-select-motion-glide'), 280);
      const configured = Number(style.getPropertyValue('--zero-select-bounce-glide') || style.getPropertyValue('--zero-theme-picker-highlight-bounce') || '.08');
      bounce = Number.isFinite(configured) ? configured : .08;
      states.forEach((state, i) => { state.target = target[i]!; if (!initialized || mq.matches) { state.value = state.target; state.velocity = 0; } });
      initialized = true; paint.style.opacity = '1';
      if (!frame) frame = view.requestAnimationFrame(tick);
    };
    const mutation = new MutationObserver(update);
    mutation.observe(viewport, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-highlighted', 'data-disabled'] });
    const resize = new ResizeObserver(update); resize.observe(viewport);
    // Native keyboard/typeahead and scroll buttons all scroll this exact viewport.
    viewport.addEventListener('scroll', update, { passive: true }); mq.addEventListener('change', update);
    update();
    return () => {
      view.cancelAnimationFrame(frame); mutation.disconnect(); resize.disconnect();
      viewport.removeEventListener('scroll', update); mq.removeEventListener('change', update);
      viewport.removeAttribute('data-zero-select-magnetic'); paint.remove();
    };
  }, [viewport]);
}
