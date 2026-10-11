'use client';

/** Ordinary picker popups inherit the shared anchored recipe; explicit caller Motion remains opt-in. */
import type { HTMLMotionProps, Transition } from 'motion/react';
import { useMediaQuery } from '../../../hooks/use-media-query';

/** Preserve DatePicker's public transition override without adding a second entrance owner. */
export function usePickerPopoverMotion(transition?: Transition): Pick<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'exit' | 'transition'> {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (transition === undefined) return {};
  return {
    initial: reduced ? false : { opacity: 0, y: -6, scale: .97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: .98 },
    transition: reduced ? { duration: 0 } : transition,
  };
}
