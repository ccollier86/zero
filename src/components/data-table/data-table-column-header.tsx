import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTableColumnHeaderProps<TData, TValue>
  extends React.ComponentProps<"div"> {
  column: Column<TData, TValue>;
  title: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }

  const sorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ml-3 h-8 data-[state=open]:bg-accent', className)}
      onClick={() => {
        if (sorted === 'asc') {
          column.toggleSorting(true);
        } else if (sorted === 'desc') {
          column.clearSorting();
        } else {
          column.toggleSorting(false);
        }
      }}
    >
      <span>{title}</span>
      {sorted === 'asc' ? (
        <ArrowUp className="ml-1 size-3.5" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="ml-1 size-3.5" />
      ) : (
        <ArrowUpDown className="ml-1 size-3.5 opacity-40" />
      )}
    </Button>
  );
}
