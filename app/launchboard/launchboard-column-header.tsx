'use client';

/**
 * launchboard-column-header.tsx
 *
 * Header renderer for LaunchBoard Kanban columns. This file owns lane header
 * controls only; board data and modal workflows stay in their own modules.
 */

import { Button } from '@zero/framework/react';
import { Settings, Trash } from '@zero/framework/icons';

import type { LaunchColumn } from './types';

export interface LaunchBoardColumnHeaderProps {
  column: LaunchColumn;
  itemCount: number;
  canDelete: boolean;
  onEdit: (column: LaunchColumn) => void;
  onDelete: (column: LaunchColumn) => void;
}

/** Render a Kanban lane title row with platform animated action buttons. */
export function LaunchBoardColumnHeader({
  column,
  itemCount,
  canDelete,
  onEdit,
  onDelete,
}: LaunchBoardColumnHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
      <span className={`size-2.5 shrink-0 rounded-full ${column.accent}`} aria-hidden="true" />
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {column.title}
      </h3>
      <span className="rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
        {itemCount}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Edit ${column.title}`}
        onClick={() => onEdit(column)}
      >
        <Settings className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete ${column.title}`}
        disabled={!canDelete}
        onClick={() => onDelete(column)}
      >
        <Trash className="size-3.5" />
      </Button>
    </div>
  );
}
