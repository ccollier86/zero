'use client';

/** Observes one existing native viewport and decorates its hidden edges; it owns no focus, nested viewport or data loading. */
import * as React from 'react';
import { observePresentationTheme } from '../../../lib/observe-presentation-theme';
import { measureScrollViewport, type ScrollViewportMetrics, type ScrollViewportOrientation } from './scroll-viewport-metrics';

/** Live dimensions and scroll intent for sibling-only overlay affordances. */
export function useScrollViewport(viewport: HTMLElement | null, orientation: ScrollViewportOrientation, fadeEdges: boolean) {
  const [metrics, setMetrics] = React.useState<ScrollViewportMetrics | null>(null);
  const [active, setActive] = React.useState(false);
  const [viewportHovered, setViewportHovered] = React.useState(false);
  const [railHovered, setHovered] = React.useState(false);
  const [dragging, setDragging] = React.useState<'x' | 'y' | null>(null);
  React.useLayoutEffect(() => {
    // Intent belongs to this exact native viewport, not a replacement branch.
    setActive(false); setViewportHovered(false); setHovered(false); setDragging(null);
    const view = viewport?.ownerDocument.defaultView;
    if (!viewport || !view) { setMetrics(null); return; }
    let disposed = false, frame = 0, timer = 0, last = '';
    const attributes = ['data-zero-scroll-fade', 'data-zero-scroll-orientation'];
    const previousAttributes = attributes.map(name => viewport.getAttribute(name));
    const edgeProperties = ['top', 'bottom', 'left', 'right'].map(edge => `--zero-scroll-edge-${edge}`);
    const previousProperties = edgeProperties.map(name => [viewport.style.getPropertyValue(name), viewport.style.getPropertyPriority(name)] as const);
    const hadClass = viewport.classList.contains('zero-scroll-viewport');
    const parsedStyle = viewport.ownerDocument.createElement('span').style;
    const withoutEdges = (value: string | null) => {
      parsedStyle.cssText = value ?? '';
      return JSON.stringify(Array.from(parsedStyle).filter(name => !edgeProperties.includes(name)).sort()
        .map(name => [name, parsedStyle.getPropertyValue(name), parsedStyle.getPropertyPriority(name)]));
    };
    const ownEdgeMutation = (record: MutationRecord) => record.target === viewport && record.attributeName === 'style'
      && withoutEdges(record.oldValue) === withoutEdges(viewport.getAttribute('style'));
    viewport.classList.add('zero-scroll-viewport');
    viewport.dataset.zeroScrollOrientation = orientation;
    viewport.dataset.zeroScrollFade = fadeEdges ? orientation : 'none';
    let resize: ResizeObserver | null = null, mutation: MutationObserver | null = null, layoutRoot: Element | null = null;
    const resizeTargets = new Set<Element>();
    const observeLayout = () => {
      const parent = viewport.parentElement, owner = viewport.offsetParent;
      // Observe the bounded positioned owner so a sibling header can move the
      // viewport without resizing it. Never subscribe to an entire document.
      const root = owner && owner !== viewport.ownerDocument.body && owner !== viewport.ownerDocument.documentElement
        && parent && owner.contains(parent) ? owner : parent ?? viewport;
      if (layoutRoot !== root) {
        mutation?.disconnect(); layoutRoot = root;
        mutation?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true });
      }
      const next = new Set<Element>([viewport, ...Array.from(viewport.children), root]);
      if (parent) next.add(parent);
      for (const target of resizeTargets) if (!next.has(target)) { resize?.unobserve(target); resizeTargets.delete(target); }
      for (const target of next) if (!resizeTargets.has(target)) { resize?.observe(target); resizeTargets.add(target); }
    };
    const read = () => {
      frame = 0; if (disposed) return;
      observeLayout();
      const style = view.getComputedStyle(viewport);
      const number = (local: string, canonical: string, fallback: number) => {
        const value = Number.parseFloat(style.getPropertyValue(local) || style.getPropertyValue(canonical));
        return Number.isFinite(value) && value >= 0 ? value : fallback;
      };
      const result = measureScrollViewport({ width: viewport.clientWidth, height: viewport.clientHeight,
        contentWidth: viewport.scrollWidth, contentHeight: viewport.scrollHeight, left: viewport.scrollLeft,
        top: viewport.scrollTop, rtl: style.direction === 'rtl' }, orientation,
      number('--zero-scroll-edge-threshold', '--zero-theme-scroll-edge-threshold', .5),
      number('--zero-scroll-minimum-thumb-length', '--zero-theme-scroll-minimum-thumb-length', 28));
      const active = viewport.ownerDocument.activeElement;
      let focused: Element | null = active && viewport.contains(active) ? active : null;
      if ((!focused || focused === viewport) && active) {
        const id = active.getAttribute('aria-activedescendant');
        const target = id ? viewport.ownerDocument.getElementById(id) : null;
        if (target && viewport.contains(target)) focused = target;
      }
      focused ??= viewport.querySelector('[data-highlighted]:not([data-highlighted="false"]), [data-selected="true"]');
      let focusEdges: Record<string, number> | null = null;
      if (focused && focused !== viewport) {
        const bounds = viewport.getBoundingClientRect(), target = focused.getBoundingClientRect();
        const scaleX = viewport.offsetWidth > 0 && bounds.width > 0 ? bounds.width / viewport.offsetWidth : 1;
        const scaleY = viewport.offsetHeight > 0 && bounds.height > 0 ? bounds.height / viewport.offsetHeight : 1;
        const left = bounds.left + viewport.clientLeft * scaleX, top = bounds.top + viewport.clientTop * scaleY;
        const right = left + viewport.clientWidth * scaleX, bottom = top + viewport.clientHeight * scaleY;
        if (target.right > left && target.left < right && target.bottom > top && target.top < bottom) {
          // Native focus/selection still owns scrollIntoView. Limit only the mask
          // so a nearest-edge row and its 2px focus ring remain legible.
          focusEdges = { top: Math.max(0, (target.top - top) / scaleY - 2), bottom: Math.max(0, (bottom - target.bottom) / scaleY - 2),
            left: Math.max(0, (target.left - left) / scaleX - 2), right: Math.max(0, (right - target.right) / scaleX - 2) };
        }
      }
      for (const [edge, hidden] of Object.entries(result.edges)) {
        // CSS resolves the fade cap, including rem/calc overrides, without a hidden measurement node.
        const available = Math.min(hidden, focusEdges?.[edge] ?? hidden);
        const value = available > .5 && fadeEdges ? `min(var(--zero-scroll-fade-size, var(--zero-theme-scroll-fade-size, 28px)), ${available}px)` : '0px';
        const name = `--zero-scroll-edge-${edge}`;
        if (viewport.style.getPropertyValue(name) !== value) viewport.style.setProperty(name, value);
      }
      const key = `${JSON.stringify(result)}|${viewport.offsetLeft}|${viewport.offsetTop}|${viewport.clientLeft}|${viewport.clientTop}`;
      if (key !== last) { last = key; setMetrics(result); }
    };
    const schedule = () => { if (!disposed && !frame) frame = view.requestAnimationFrame(read); };
    const scroll = () => {
      setActive(true); view.clearTimeout(timer);
      const style = view.getComputedStyle(viewport);
      const raw = style.getPropertyValue('--zero-scroll-hide-delay') || style.getPropertyValue('--zero-theme-scroll-hide-delay');
      const parsed = Number.parseFloat(raw), delay = Number.isFinite(parsed) ? Math.max(0, parsed) * (raw.trim().endsWith('ms') ? 1 : raw.trim().endsWith('s') ? 1000 : 1) : 900;
      timer = view.setTimeout(() => setActive(false), delay);
      schedule();
    };
    const enter = (event: PointerEvent) => { if (event.pointerType === 'mouse') setViewportHovered(true); };
    const leave = () => { setViewportHovered(false); };
    viewport.addEventListener('scroll', scroll, { passive: true });
    viewport.addEventListener('pointerenter', enter); viewport.addEventListener('pointerleave', leave);
    resize = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : null;
    const layoutAttributes = new Set(['class', 'style', 'hidden', 'open', 'width', 'height', 'src', 'srcset', 'sizes', 'dir',
      'aria-expanded', 'aria-hidden', 'aria-activedescendant', 'data-state', 'data-highlighted', 'data-selected']);
    mutation = new view.MutationObserver(records => {
      if (records.some(record => record.type !== 'attributes'
        || layoutAttributes.has(record.attributeName ?? '') && !ownEdgeMutation(record))) { observeLayout(); schedule(); }
    });
    const releaseTheme = observePresentationTheme(viewport, schedule, { ignoreMutation: ownEdgeMutation });
    // Intrinsic image/font sizes and nearby input focus can change hidden edges
    // without a DOM child insertion or a viewport resize.
    const document = viewport.ownerDocument;
    const focus = (event: FocusEvent) => { if (event.target instanceof view.Element && layoutRoot?.contains(event.target)) schedule(); };
    const load = (event: Event) => { if (event.target instanceof view.Element && layoutRoot?.contains(event.target)) schedule(); };
    document.addEventListener('focusin', focus); document.addEventListener('focusout', focus);
    document.addEventListener('load', load, true); document.addEventListener('error', load, true);
    document.fonts?.addEventListener('loadingdone', schedule); document.fonts?.addEventListener('loadingerror', schedule);
    observeLayout(); read();
    return () => {
      disposed = true; view.cancelAnimationFrame(frame); view.clearTimeout(timer);
      mutation?.disconnect(); resize?.disconnect(); resizeTargets.clear(); releaseTheme();
      viewport.removeEventListener('scroll', scroll); viewport.removeEventListener('pointerenter', enter); viewport.removeEventListener('pointerleave', leave);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focus);
      document.removeEventListener('load', load, true); document.removeEventListener('error', load, true);
      document.fonts?.removeEventListener('loadingdone', schedule); document.fonts?.removeEventListener('loadingerror', schedule);
      if (!hadClass) viewport.classList.remove('zero-scroll-viewport');
      attributes.forEach((name, index) => { const previous = previousAttributes[index]; if (previous === null) viewport.removeAttribute(name); else viewport.setAttribute(name, previous!); });
      edgeProperties.forEach((name, index) => { const [value, priority] = previousProperties[index]!; if (value) viewport.style.setProperty(name, value, priority); else viewport.style.removeProperty(name); });
    };
  }, [viewport, orientation, fadeEdges]);
  return { metrics, visible: active || viewportHovered || railHovered || dragging !== null, scrolling: active || dragging !== null, dragging, setDragging, setHovered };
}
