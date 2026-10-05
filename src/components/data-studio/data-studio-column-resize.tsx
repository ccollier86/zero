'use client';

/** Accessible sizing adapter over TanStack Table; drag/touch lifecycles belong to its resize handler. */
import type { Header } from '@tanstack/react-table';
import type { DataStudioRow } from '../../frontend/client/data-studio-client';

export const DATA_STUDIO_COLUMN_MIN_WIDTH = 128;
export const DATA_STUDIO_COLUMN_MAX_WIDTH = 640;
export const DATA_STUDIO_COLUMN_DEFAULT_WIDTH = 208;

export function clampDataStudioColumnWidth(width: number): number {
  return Math.max(DATA_STUDIO_COLUMN_MIN_WIDTH,
    Math.min(DATA_STUDIO_COLUMN_MAX_WIDTH, Number.isFinite(width) ? width : DATA_STUDIO_COLUMN_DEFAULT_WIDTH));
}

export function DataStudioColumnResize({ label, header, onChange }: {
  label: string; header: Header<DataStudioRow, unknown>; onChange: (width: number) => void;
}) {
  const width = header.getSize();
  return <div
    role="separator" tabIndex={0} aria-label={`Resize ${label}`}
    aria-orientation="vertical" aria-valuemin={DATA_STUDIO_COLUMN_MIN_WIDTH}
    aria-valuemax={DATA_STUDIO_COLUMN_MAX_WIDTH} aria-valuenow={Math.round(width)}
    data-resizing={header.column.getIsResizing() ? 'true' : undefined}
    className="absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-2 after:left-1 after:w-px after:bg-border hover:after:bg-primary focus-visible:after:bg-primary"
    onMouseDown={(event) => {
      if (event.button !== 0) return;
      event.stopPropagation(); header.getResizeHandler()(event);
    }}
    onTouchStart={(event) => {
      event.stopPropagation(); header.getResizeHandler()(event);
    }}
    onKeyDown={(event) => {
      let next: number | undefined;
      if (event.key === 'ArrowLeft') next = width - (event.shiftKey ? 40 : 8);
      if (event.key === 'ArrowRight') next = width + (event.shiftKey ? 40 : 8);
      if (event.key === 'Home') next = DATA_STUDIO_COLUMN_MIN_WIDTH;
      if (event.key === 'End') next = DATA_STUDIO_COLUMN_MAX_WIDTH;
      if (next === undefined) return;
      event.preventDefault(); event.stopPropagation(); onChange(clampDataStudioColumnWidth(next));
    }}
  />;
}
