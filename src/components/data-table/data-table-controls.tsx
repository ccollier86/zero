'use client';

/** Shared responsive control layout for client tables and server-backed directories. */

import * as React from 'react';
import { cn } from '#zero/lib/utils';

export interface DataTableControlsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Search is always the first control, before filters and selectors. */
  search?: React.ReactNode;
  /** Optional filters, selectors, popovers, or other list controls. */
  controls?: React.ReactNode;
  /** Optional refresh, pagination, export, or other toolbar actions. */
  actions?: React.ReactNode;
  /** Optional full-width content, such as active filters or loading feedback. */
  supplemental?: React.ReactNode;
}

/** Compose table controls without requiring a TanStack instance or owning query state. */
export function DataTableControls({
  search,
  controls,
  actions,
  supplemental,
  className,
  ...attributes
}: DataTableControlsProps) {
  return (
    <div
      role="group"
      aria-label="Table controls"
      data-slot="data-table-controls"
      {...attributes}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          data-slot="data-table-toolbar-left"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        >
          {search}
          {controls}
        </div>
        {actions != null && (
          <div
            data-slot="data-table-toolbar-right"
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end"
          >
            {actions}
          </div>
        )}
      </div>
      {supplemental != null && (
        <div
          data-slot="data-table-toolbar-below"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {supplemental}
        </div>
      )}
    </div>
  );
}
