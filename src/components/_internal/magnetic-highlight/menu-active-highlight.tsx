'use client';

/** Paint-only magnetic material. Native menu/calendar owners keep selection, focus, filtering and scrolling. */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, useAnimationControls } from 'motion/react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import './menu-active-highlight.css';

export interface MenuActiveHighlightProps {
  readonly container: HTMLElement | null;
  /** Native selected/highlighted state; no selection is made by this component. */
  readonly activeSelector?: string;
  /** Optional pointer/focus paint for owners that do not expose a hover state. */
  readonly hoverSelector?: string;
  /** Calendar/date ranges retain their committed selection fill. */
  readonly preserveSelectionFill?: boolean;
  readonly className?: string;
}

type Geometry = { x: number; y: number; width: number; height: number; visible: boolean; duration: number; bounce: number };

/** One measured layer in the existing positioned container; never a role, focus stop or additional viewport. */
export function MenuActiveHighlight({ container, activeSelector = '[data-highlighted]:not([data-highlighted="false"])',
  hoverSelector, preserveSelectionFill = true, className }: MenuActiveHighlightProps) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [geometry, setGeometry] = React.useState<Geometry | null>(null);
  const paintRef = React.useRef<HTMLSpanElement>(null);
  const controls = useAnimationControls();
  const initialized = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const view = container?.ownerDocument.defaultView;
    if (!container || !view) { setGeometry(null); return; }
    let frame = 0, disposed = false, hover: HTMLElement | null = null, marked: HTMLElement | null = null, observed: HTMLElement | null = null;
    const previousPosition = container.style.position;
    const positioned = view.getComputedStyle(container).position === 'static';
    if (positioned) container.style.position = 'relative';
    const previousReady = container.getAttribute('data-zero-menu-magnetic');
    container.setAttribute('data-zero-menu-magnetic', '');
    const choices = new Map<HTMLElement, { choice: string | null; static: string | null }>();
    const enabled = (element: HTMLElement | null) => !!element && container.contains(element) && !element.closest(
      '[disabled], [aria-disabled="true"], [data-disabled]:not([data-disabled="false"]), [hidden], [aria-hidden="true"]');
    const choiceFor = (target: EventTarget | null) => target instanceof view.Element && hoverSelector
      ? target.closest<HTMLElement>(hoverSelector) : null;
    const register = (element: HTMLElement) => {
      if (choices.has(element)) return;
      choices.set(element, { choice: element.getAttribute('data-zero-menu-choice'), static: element.getAttribute('data-zero-menu-static') });
      element.setAttribute('data-zero-menu-choice', '');
      if (view.getComputedStyle(element).position === 'static') element.setAttribute('data-zero-menu-static', '');
    };
    const restoreChoice = (element: HTMLElement, previous: { choice: string | null; static: string | null }) => {
      if (previous.choice === null) element.removeAttribute('data-zero-menu-choice'); else element.setAttribute('data-zero-menu-choice', previous.choice);
      if (previous.static === null) element.removeAttribute('data-zero-menu-static'); else element.setAttribute('data-zero-menu-static', previous.static);
    };
    const read = () => {
      frame = 0; if (disposed) return;
      // A long-lived virtual list must not retain every retired option node.
      for (const [element, previous] of choices) if (!container.contains(element)) { restoreChoice(element, previous); choices.delete(element); }
      if (hover && !container.contains(hover)) hover = null;
      // All stationary labels paint above the moving material, not just the
      // destination. Absolute virtual rows retain their existing positioning.
      container.querySelectorAll<HTMLElement>('[cmdk-item], [role="option"], button').forEach(register);
      const focused = choiceFor(container.ownerDocument.activeElement);
      const native = container.querySelector<HTMLElement>(activeSelector);
      const target = enabled(hover) ? hover : enabled(focused) ? focused : enabled(native) ? native : null;
      if (marked && marked !== target) marked.removeAttribute('data-zero-menu-material');
      marked = target;
      if (observed !== target) { if (observed) resize.unobserve(observed); observed = target; if (observed) resize.observe(observed); }
      if (!target) { setGeometry(current => current?.visible ? { ...current, visible: false } : current); return; }
      register(target);
      const committed = preserveSelectionFill && !!target.closest('[aria-selected="true"], [data-selected="true"]');
      if (committed) target.removeAttribute('data-zero-menu-material');
      else target.setAttribute('data-zero-menu-material', '');
      const bounds = container.getBoundingClientRect(), rect = target.getBoundingClientRect();
      const sx = bounds.width / (container.offsetWidth || bounds.width) || 1;
      const sy = bounds.height / (container.offsetHeight || bounds.height) || 1;
      const style = view.getComputedStyle(container);
      const raw = style.getPropertyValue('--zero-menu-highlight-duration') || style.getPropertyValue('--zero-theme-picker-highlight-duration');
      const value = Number.parseFloat(raw), duration = Number.isFinite(value) ? Math.max(0, value) * (raw.trim().endsWith('ms') ? 1 : raw.trim().endsWith('s') ? 1000 : 1) : 280;
      const configuredBounce = Number.parseFloat(style.getPropertyValue('--zero-menu-highlight-bounce') || style.getPropertyValue('--zero-theme-picker-highlight-bounce'));
      const next: Geometry = { x: (rect.left - bounds.left) / sx + container.scrollLeft - container.clientLeft,
        y: (rect.top - bounds.top) / sy + container.scrollTop - container.clientTop, width: rect.width / sx, height: rect.height / sy,
        visible: !committed && rect.width > 0 && rect.height > 0, duration,
        bounce: Number.isFinite(configuredBounce) ? Math.max(0, Math.min(.95, configuredBounce)) : .08 };
      setGeometry(current => current && Object.keys(next).every(key => current[key as keyof Geometry] === next[key as keyof Geometry]) ? current : next);
    };
    const schedule = () => { if (!disposed && !frame) frame = view.requestAnimationFrame(read); };
    const over = (event: PointerEvent) => { if (event.pointerType === 'touch' || !hoverSelector) return; hover = choiceFor(event.target); schedule(); };
    const leave = () => { hover = null; schedule(); };
    const focus = () => { hover = null; schedule(); };
    const mutation = new view.MutationObserver(records => {
      if (records.some(record => record.target !== paintRef.current && !paintRef.current?.contains(record.target))) schedule();
    });
    mutation.observe(container, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['data-highlighted', 'data-selected', 'data-active', 'aria-selected', 'aria-disabled', 'disabled', 'hidden', 'class', 'style'] });
    const resize = new view.ResizeObserver(schedule); resize.observe(container);
    container.addEventListener('scroll', schedule, { passive: true }); container.addEventListener('pointerover', over);
    container.addEventListener('pointerleave', leave); container.addEventListener('focusin', focus); container.addEventListener('focusout', schedule);
    // Roving focus/aria-activedescendant owners may keep DOM focus on the same
    // listbox/input while keys change the active row. Pointer paint must yield.
    container.addEventListener('keydown', focus);
    view.addEventListener('resize', schedule); container.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
    read();
    return () => {
      disposed = true; view.cancelAnimationFrame(frame); mutation.disconnect(); resize.disconnect();
      container.removeEventListener('scroll', schedule); container.removeEventListener('pointerover', over);
      container.removeEventListener('pointerleave', leave); container.removeEventListener('focusin', focus); container.removeEventListener('focusout', schedule);
      container.removeEventListener('keydown', focus);
      view.removeEventListener('resize', schedule); container.ownerDocument.fonts?.removeEventListener('loadingdone', schedule);
      marked?.removeAttribute('data-zero-menu-material');
      for (const [element, previous] of choices) restoreChoice(element, previous);
      choices.clear();
      if (previousReady === null) container.removeAttribute('data-zero-menu-magnetic'); else container.setAttribute('data-zero-menu-magnetic', previousReady);
      if (positioned && container.style.position === 'relative') container.style.position = previousPosition;
    };
  }, [container, activeSelector, hoverSelector, preserveSelectionFill]);
  React.useLayoutEffect(() => {
    if (!container || !geometry || !paintRef.current) return;
    const target = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, opacity: geometry.visible ? 1 : 0 };
    // Changing transition props alone does not interrupt an already-running
    // Motion spring with unchanged targets. Preference changes must snap now.
    if (reduced || !geometry.duration || initialized.current !== container) { controls.stop(); controls.set(target); }
    else {
      const angular = 2 * Math.PI / (geometry.duration / 1000 * 1.2);
      void controls.start(target, { type: 'spring', mass: 1, stiffness: angular * angular, damping: 2 * (1 - geometry.bounce) * angular });
    }
    initialized.current = container;
  }, [container, geometry, reduced, controls]);
  if (!container || !geometry) return null;
  return createPortal(<motion.span ref={paintRef} className={['zero-menu-active-highlight', className].filter(Boolean).join(' ')} aria-hidden="true"
    initial={false} animate={controls}
  />, container);
}
