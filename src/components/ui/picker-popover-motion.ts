'use client';

/** Private token-resolved popup entrance and exit presentation for shared pickers. */
import * as React from 'react';
import type { Transition } from 'motion/react';
import { resolveCalendarMotion } from './calendar-motion';
import { useMediaQuery } from '../../hooks/use-media-query';

/** Use the supplied spring curve through WAAPI, including its linear() stops. */
export function usePickerPopoverMotion() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [transition, setTransition] = React.useState<Transition>({ duration: 0 });
  const active = React.useRef<Animation[]>([]);
  const ref = React.useCallback((element: HTMLDivElement | null) => {
    active.current.forEach(animation => animation.cancel()); active.current = [];
    if (!element) return;
    const motion = resolveCalendarMotion(element);
    const curve = motion.easeStandard.match(/^cubic-bezier\(([^)]+)\)$/)?.[1]?.split(',').map(Number);
    const named: Record<string, Transition['ease']> = {
      linear: 'linear', ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1],
      'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
    };
    const ease: Transition['ease'] = curve?.length === 4 && curve.every(Number.isFinite)
      ? curve as [number, number, number, number] : named[motion.easeStandard] ?? [0.22, 1, 0.36, 1];
    setTransition({ duration: reduced ? 0 : motion.fast / 1000, ease });
    if (reduced || motion.spring <= 1 || typeof element.animate !== 'function') return;
    active.current = [
      element.animate([{ transform: 'translateY(-6px) scale(.97)' }, { transform: 'none' }], {
        duration: motion.spring, easing: motion.easeSpring,
      }),
      element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motion.fast, easing: motion.easeStandard }),
    ];
  }, [reduced]);
  React.useEffect(() => () => { active.current.forEach(animation => animation.cancel()); }, []);
  return { ref, transition, reduced: Boolean(reduced), exit: reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 } };
}
