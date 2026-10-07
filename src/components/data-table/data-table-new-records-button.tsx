'use client';

/** Reusable presentation of caller-owned held records, independent of pagination or data fetching. */
import * as React from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { Button, type ButtonProps } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import { DataTableRollingNumber } from './data-table-rolling-number';

export interface DataTableNewRecordsButtonProps extends Omit<ButtonProps, 'children' | 'onClick' | 'asChild'> {
  count: number;
  onReveal: () => void;
  motionEnabled?: boolean;
}

/** Return no action for zero/invalid counts; caller owns revealing rows and all authority checks. */
export const DataTableNewRecordsButton = React.forwardRef<HTMLButtonElement, DataTableNewRecordsButtonProps>(
  function DataTableNewRecordsButton({ count, onReveal, motionEnabled = true, className, 'aria-label': label,
    size = 'xs', ...props }, ref) {
    const reduced = useReducedMotion();
    const animate = motionEnabled && !reduced;
    if (!Number.isSafeInteger(count) || count <= 0) return null;
    return <Button {...props} ref={ref} type="button" size={size} data-slot="data-table-new-records"
      data-motion={animate ? 'true' : 'false'} animateIcon={false} className={cn('rounded-full shadow-sm', className)}
      aria-label={label ?? `Reveal ${count} new records`} onClick={onReveal}>
      <ArrowUp className="size-3" aria-hidden="true" /><span aria-hidden="true"><DataTableRollingNumber value={count} motionEnabled={animate} /> new</span>
    </Button>;
  },
);
