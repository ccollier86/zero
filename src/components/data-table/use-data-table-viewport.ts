'use client';

/** Tracks actual table reading position across the grid and surrounding master/detail scroll owners. */
import * as React from 'react';
import { useReducedMotion } from 'motion/react';

/** Observe scroll owners, never a global keyboard/navigation handler or an app-owned page controller. */
export function useDataTableViewport(boundary: string, onScrolledAway: (away: boolean) => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  const owners = React.useRef<HTMLElement[]>([]);
  const reduced = useReducedMotion();
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const elements = [root, ...root.querySelectorAll<HTMLElement>('[data-radix-scroll-area-viewport], [data-slot="table-container"]')];
    let parent = root.parentElement;
    while (parent) { if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)) elements.push(parent); parent = parent.parentElement; }
    if (document.scrollingElement instanceof HTMLElement) elements.push(document.scrollingElement);
    owners.current = [...new Set(elements)];
    const update = () => onScrolledAway(owners.current.some(element => {
      if (element.scrollHeight <= element.clientHeight + 1) return false;
      if (root.contains(element)) return element.scrollTop > 1;
      const top = element === document.scrollingElement ? 0 : element.getBoundingClientRect().top;
      return root.getBoundingClientRect().top < top - 1;
    }));
    for (const element of owners.current) element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => { for (const element of owners.current) element.removeEventListener('scroll', update); window.removeEventListener('scroll', update); owners.current = []; };
  }, [boundary, onScrolledAway]);
  const scrollToTop = React.useCallback(() => {
    const root = ref.current;
    if (!root) return;
    for (const element of owners.current) {
      if (element.scrollHeight <= element.clientHeight + 1) continue;
      const viewportTop = element === document.scrollingElement ? 0 : element.getBoundingClientRect().top;
      const top = root.contains(element) ? 0 : Math.max(0, element.scrollTop + root.getBoundingClientRect().top - viewportTop);
      element.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' });
    }
    onScrolledAway(false);
  }, [onScrolledAway, reduced]);
  return { ref, scrollToTop };
}
