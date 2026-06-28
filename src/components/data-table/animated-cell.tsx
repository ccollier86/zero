'use client';

import * as React from 'react';
import { useRef, useEffect } from 'react';
import { useAnimate } from 'motion/react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AnimatedCellProps {
  value: unknown;
  children: React.ReactNode;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Wraps cell content and flashes a highlight animation when the value changes.
 * Skips animation on initial render — only fires on subsequent value changes.
 */
export function AnimatedCell({ value, children, className }: AnimatedCellProps) {
  const [scope, animate] = useAnimate();
  const prevValue = useRef(value);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevValue.current = value;
      return;
    }

    if (prevValue.current !== value) {
      prevValue.current = value;
      animate(scope.current, {
        backgroundColor: ['rgba(74, 124, 255, 0.15)', 'rgba(74, 124, 255, 0)'],
      }, {
        duration: 0.8,
        ease: 'easeOut',
      });
    }
  }, [value, animate, scope]);

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}
