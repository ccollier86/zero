/** Interruptible visual-only calendar transitions; cloned exits are inert and never handle selection. */
import * as React from 'react';
import { useMediaQuery } from '../../hooks/use-media-query';
import { resolveCalendarMotion } from './calendar-motion';
import type { CalendarView } from './calendar-view-context';

/** Animate an owned body swap without remounting DayPicker or queuing stale selectable panes. */
export function useCalendarViewMotion(key: string, view: CalendarView, monthIndex: number) {
  const contentRef = React.useRef<HTMLDivElement>(null), overlayRef = React.useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const previous = React.useRef<{ key: string; view: CalendarView; index: number; snapshot: HTMLElement } | undefined>(undefined);
  const animations = React.useRef<Animation[]>([]);
  React.useLayoutEffect(() => {
    const content = contentRef.current, overlay = overlayRef.current;
    if (!content || !overlay) return;
    const prior = previous.current;
    // Capture the currently displayed transform before cancelling so rapid input retargets its visual position.
    const style = getComputedStyle(content), transform = style.transform, opacity = style.opacity;
    animations.current.forEach(animation => animation.cancel()); animations.current = [];
    overlay.replaceChildren();
    const motion = resolveCalendarMotion(content);
    if (prior && prior.key !== key && motion.spring > 1 && typeof content.animate === 'function') {
      const clone = prior.snapshot.cloneNode(true) as HTMLElement;
      clone.inert = true; clone.setAttribute('aria-hidden', 'true');
      for (const node of [clone, ...clone.querySelectorAll('[id]')]) node.removeAttribute('id');
      Object.assign(clone.style, { position: 'absolute', inset: '0', pointerEvents: 'none', transform, opacity });
      overlay.append(clone);
      const rank = { days: 0, months: 1, years: 2 };
      const switched = prior.view !== view, up = rank[view] > rank[prior.view];
      const direction = Math.sign(monthIndex - prior.index) || 1;
      const from = switched ? `scale(${up ? 1.06 : .9})` : `translateX(calc(${direction * 100}% + ${direction * 16}px))`;
      const to = switched ? `scale(${up ? .9 : 1.06})` : `translateX(calc(${-direction * 100}% + ${-direction * 16}px))`;
      const anchor = (up ? content : clone).querySelector<HTMLElement>('[aria-selected="true"]');
      if (switched && anchor) {
        const box = content.getBoundingClientRect(), selection = anchor.getBoundingClientRect();
        const origin = `${selection.left - box.left + selection.width / 2}px ${selection.top - box.top + selection.height / 2}px`;
        content.style.transformOrigin = origin; clone.style.transformOrigin = origin;
      } else content.style.removeProperty('transform-origin');
      const exit = clone.animate([{ transform, opacity }, { transform: to, opacity: switched ? 0 : .4 }],
        { duration: switched ? motion.fast + 40 : motion.spring,
          easing: switched ? motion.easeStandard : motion.easeSpring, fill: 'forwards' });
      exit.onfinish = () => clone.remove();
      animations.current.push(exit,
        content.animate([{ transform: from }, { transform: 'none' }], { duration: motion.spring, easing: motion.easeSpring }),
        content.animate([{ opacity: switched ? 0 : .4 }, { opacity: 1 }], {
          duration: switched ? motion.fast + 80 : motion.spring, delay: switched ? 40 : 0,
          easing: switched ? motion.easeStandard : motion.easeSpring, fill: 'backwards' }));
      if (switched && view === 'months') {
        const cells = [...content.querySelectorAll<HTMLElement>('[data-choice]')];
        const selected = cells.findIndex(cell => cell.parentElement?.getAttribute('aria-selected') === 'true');
        const row = Math.floor(Math.max(0, selected) / 3), column = Math.max(0, selected) % 3;
        cells.forEach((cell, index) => {
          const distance = Math.abs(Math.floor(index / 3) - row) + Math.abs(index % 3 - column);
          animations.current.push(cell.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
            { duration: motion.fast * 2, delay: 40 + distance * 22, easing: motion.easeStandard, fill: 'backwards' }));
        });
      }
    }
    previous.current = { key, view, index: monthIndex, snapshot: content.cloneNode(true) as HTMLElement };
  }, [key, view, monthIndex, reduced]);
  React.useLayoutEffect(() => () => {
    animations.current.forEach(animation => animation.cancel()); overlayRef.current?.replaceChildren();
  }, []);
  return { contentRef, overlayRef };
}
