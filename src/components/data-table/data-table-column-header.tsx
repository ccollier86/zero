'use client';

/** Existing TanStack sort cycle with table-scoped indicator motion; never changes schema, fetching, or menu policy. */
import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { ArrowDown } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTableColumnHeaderProps<TData, TValue>
  extends React.ComponentProps<"div"> {
  column: Column<TData, TValue>;
  title: string;
  motionEnabled?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  motionEnabled = true,
  ...props
}: DataTableColumnHeaderProps<TData, TValue>) {
  const reduced = useReducedMotion();
  if (!column.getCanSort()) {
    return <div {...props} className={cn(className)}>{title}</div>;
  }

  const sorted = column.getIsSorted();
  const next = column.getNextSortingOrder();

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      data-slot="data-table-sort-header"
      data-sorted={sorted ? 'true' : 'false'}
      data-motion={motionEnabled && !reduced ? 'true' : 'false'}
      aria-label={sorted ? `${title}, sorted ${sorted === 'asc' ? 'ascending' : 'descending'}` : title}
      aria-description={next ? `Activate to sort ${next === 'desc' ? 'descending' : 'ascending'}.` : 'Activate to clear sorting.'}
      className={cn('-ml-3 h-8 data-[state=open]:bg-accent', sorted ? 'text-foreground' : 'text-muted-foreground', className)}
      onClick={() => {
        column.toggleSorting();
      }}
    >
      <span>{title}</span>
      <ArrowDown data-slot="data-table-sort-indicator" aria-hidden="true" className="ml-1 size-3.5"
        style={{ transform: sorted === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
    </Button>
  );
}
