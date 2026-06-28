import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/animate-ui/components/radix/dropdown-menu';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RowAction<T> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: (row: T) => void;
  variant?: 'default' | 'destructive';
  visible?: (row: T) => boolean;
}

export interface DataTableRowActionsProps<T> {
  row: T;
  actions: RowAction<T>[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTableRowActions<T>({
  row,
  actions,
}: DataTableRowActionsProps<T>) {
  const visibleActions = actions.filter((a) => !a.visible || a.visible(row));
  if (visibleActions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="data-[state=open]:bg-muted">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        {visibleActions.map((action, i) => (
          <React.Fragment key={action.label}>
            {i > 0 && action.variant === 'destructive' && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => action.onClick(row)}
              className={cn(
                action.variant === 'destructive' && 'text-destructive focus:text-destructive',
              )}
            >
              {action.icon && <action.icon className="mr-2 size-4" />}
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
