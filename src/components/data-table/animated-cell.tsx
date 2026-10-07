'use client';

/** Token-colored compositor-only acknowledgement of an existing value changing. */
import * as React from 'react';
import { cn } from '#zero/lib/utils';
import { DATA_TABLE_MOTION } from './data-table-motion-tokens';

export interface AnimatedCellProps {
  value: unknown; children: React.ReactNode; className?: string; motionEnabled?: boolean;
}
export function AnimatedCell({ value, children, className, motionEnabled = true }: AnimatedCellProps) {
  const previous = React.useRef(value), [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    if (motionEnabled) setRevision(current => current + 1);
  }, [value, motionEnabled]);
  React.useEffect(() => {
    if (!revision) return;
    const timer = setTimeout(() => setRevision(0), DATA_TABLE_MOTION.highlight);
    return () => clearTimeout(timer);
  }, [revision]);
  return <div className={cn('relative isolate', className)}>{children}
    {revision > 0 && motionEnabled && <span key={revision} aria-hidden="true" data-slot="data-table-cell-flash" />}
  </div>;
}
