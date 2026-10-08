'use client';

/** Present caller-owned incoming counts as an eligible reveal action or a passive status; never infer navigation eligibility or fetch records. */
import * as React from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { Button, type ButtonProps } from '#zero/components/ui/button';
import { Badge } from '#zero/components/ui/badge';
import { cn } from '#zero/lib/utils';
import { DataTableRollingNumber } from './data-table-rolling-number';

export interface DataTableNewRecordsButtonProps extends Omit<ButtonProps, 'children' | 'onClick' | 'asChild'> {
  count: number;
  /** Supply only when returning to the first page will reveal leading arrivals. Omit for a passive count. */
  onReveal?: () => void;
  motionEnabled?: boolean;
}

/** Hide invalid/zero counts. The forwarded button ref belongs only to actionable mode; passive mode is never focusable. */
export const DataTableNewRecordsButton = React.forwardRef<HTMLButtonElement, DataTableNewRecordsButtonProps>(
  function DataTableNewRecordsButton({ count, onReveal, motionEnabled = true, className, 'aria-label': label,
    size = 'xs', ...props }, ref) {
    const reduced = useReducedMotion();
    const animate = motionEnabled && !reduced;
    if (!Number.isSafeInteger(count) || count <= 0) return null;
    if (!onReveal) {
      // Preserve caller-owned global/description metadata, not button-only
      // attributes or handlers that would pretend the passive count is an action.
      const metadata = Object.fromEntries(Object.entries(props).filter(([name]) =>
        name.startsWith('data-') || name.startsWith('aria-')
        || ['id', 'title', 'style', 'lang', 'dir', 'hidden'].includes(name)));
      return <Badge {...metadata} variant="secondary" role="status" aria-live="polite" aria-atomic="true"
        data-slot="data-table-new-records" data-actionable="false" data-motion={animate ? 'true' : 'false'}
        className={cn('h-6 rounded-full px-2 py-0 font-medium shadow-sm', className)}
        aria-label={label ?? `${count} new records`}>
        <span aria-hidden="true"><DataTableRollingNumber value={count} motionEnabled={animate} /> new</span>
      </Badge>;
    }
    return <Button {...props} ref={ref} type="button" size={size} data-slot="data-table-new-records"
      data-actionable="true" data-motion={animate ? 'true' : 'false'} animateIcon={false} className={cn('rounded-full shadow-sm', className)}
      aria-label={label ?? `Reveal ${count} new records`} onClick={onReveal}>
      <ArrowUp className="size-3" aria-hidden="true" /><span aria-hidden="true"><DataTableRollingNumber value={count} motionEnabled={animate} /> new</span>
    </Button>;
  },
);
