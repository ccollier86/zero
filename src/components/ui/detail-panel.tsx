'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DetailPanelProps {
  /** Header content (avatar, title, subtitle, badges) */
  header?: React.ReactNode;
  /** Main scrollable content */
  children: React.ReactNode;
  /** Footer content (actions, save button) */
  footer?: React.ReactNode;
  /** Empty state when nothing selected */
  emptyState?: React.ReactNode;
  /** Whether to show empty state */
  isEmpty?: boolean;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

function DetailPanel({
  header,
  children,
  footer,
  emptyState,
  isEmpty = false,
  className,
}: DetailPanelProps) {
  if (isEmpty) {
    return (
      <div
        data-slot="detail-panel"
        className={cn(
          'flex h-full items-center justify-center text-muted-foreground',
          className,
        )}
      >
        {emptyState ?? (
          <p className="text-sm">Select a record to view details</p>
        )}
      </div>
    );
  }

  return (
    <div
      data-slot="detail-panel"
      className={cn('flex h-full flex-col', className)}
    >
      {/* Sticky header */}
      {header && (
        <div className="shrink-0 border-b border-border p-4">{header}</div>
      )}

      {/* Scrollable body */}
      <ScrollArea className="flex-1">
        <div className="p-4">{children}</div>
      </ScrollArea>

      {/* Sticky footer */}
      {footer && (
        <div className="shrink-0 border-t border-border p-4">{footer}</div>
      )}
    </div>
  );
}

export { DetailPanel };
