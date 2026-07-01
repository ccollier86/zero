'use client';

/**
 * flip-words.tsx
 *
 * Renders a rotating inline word slot with stable layout. This file owns word
 * rotation and motion only; callers own surrounding sentence structure.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/lib/utils';

export interface FlipWordsProps extends React.ComponentProps<'span'> {
  words: readonly string[];
  duration?: number;
  wordClassName?: string;
}

/** Render a stable-width inline slot that flips through the provided words. */
export function FlipWords({
  words,
  duration = 2200,
  className,
  wordClassName,
  ...props
}: FlipWordsProps) {
  const safeWords = React.useMemo(
    () => words.map((word) => word.trim()).filter(Boolean),
    [words],
  );
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (safeWords.length <= 1) return;

    const timeout = window.setTimeout(() => {
      setIndex((current) => (current + 1) % safeWords.length);
    }, duration);

    return () => window.clearTimeout(timeout);
  }, [duration, safeWords.length, index]);

  React.useEffect(() => {
    setIndex(0);
  }, [safeWords.length]);

  if (safeWords.length === 0) return null;

  const activeWord = safeWords[index] ?? safeWords[0];

  return (
    <span
      className={cn('relative inline-grid overflow-hidden align-baseline', className)}
      {...props}
    >
      {safeWords.map((word) => (
        <span
          key={`measure-${word}`}
          aria-hidden="true"
          className={cn('invisible col-start-1 row-start-1 whitespace-nowrap', wordClassName)}
        >
          {word}
        </span>
      ))}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={activeWord}
          className={cn('col-start-1 row-start-1 whitespace-nowrap', wordClassName)}
          initial={{ opacity: 0, y: '0.75em', rotateX: -45, filter: 'blur(0.18em)' }}
          animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0em)' }}
          exit={{ opacity: 0, y: '-0.75em', rotateX: 45, filter: 'blur(0.18em)' }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {activeWord}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
