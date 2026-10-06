'use client';

/** Compact, accessible mutation status shared with the grid's in-place editor. */

import { AlertCircle, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DataStudioCellSaveState } from './data-studio-inline-cell';

/** Announce pending, accepted, rejected and conflicted writes without resizing cells. */
export function DataStudioCellStateIndicator({ state, message }: {
  readonly state: DataStudioCellSaveState;
  readonly message: string | null;
}) {
  if (state === 'idle') return null;
  const Icon = state === 'pending' ? LoaderCircle : state === 'saved' ? Check
    : state === 'conflict' ? RefreshCw : AlertCircle;
  const label = state === 'pending' ? 'Saving' : state === 'saved' ? 'Saved'
    : state === 'conflict' ? 'Conflict; latest value restored'
      : message ?? 'Save failed; previous value restored';
  return (
    <span role={state === 'error' || state === 'conflict' ? 'alert' : 'status'}
      className={cn('pointer-events-none absolute right-0.5 top-0.5 z-10 rounded-full bg-background/90 p-0.5 shadow-sm',
        state === 'saved' && 'text-success', state === 'pending' && 'text-muted-foreground',
        state === 'error' && 'text-destructive', state === 'conflict' && 'text-warning')}>
      <Icon className={cn('size-3', state === 'pending' && 'animate-spin')} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
