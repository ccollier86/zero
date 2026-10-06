'use client';

/** Anchored date/time editor; composes existing Zero controls without resizing the grid cell. */

import type * as React from 'react';
import { LoaderCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../animate-ui/components/radix/popover';
import { Button } from '../ui/button';
import { DataStudioTemporalInput } from './data-studio-temporal-input';

/** Calendar/time interaction is a draft until Apply; portal focus changes never save it. */
export function DataStudioTemporalCellEditor({
  children, open, type, label, required, value, disabled, pending, error,
  onOpenChange, onValueChange, onApply, onCancel,
}: {
  readonly children: React.ReactElement;
  readonly open: boolean;
  readonly type: 'date' | 'datetime';
  readonly label: string;
  readonly required?: boolean;
  readonly value: string;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onValueChange: (value: string) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <Popover open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12}
        className="w-[min(22rem,calc(100vw-1.5rem))] space-y-3 p-3"
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}
        onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          {type === 'datetime' && <p className="mt-0.5 text-xs text-muted-foreground">Local date and time · stored as an exact timestamp</p>}
        </div>
        <DataStudioTemporalInput type={type} value={value} onValueChange={onValueChange}
          disabled={disabled || pending} required={required} invalid={!!error}
          aria-label={`Edit ${label}`} autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.defaultPrevented && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled && !pending) onApply();
            }
          }} />
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-2.5">
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
          <Button type="button" size="sm" disabled={disabled || pending} onClick={onApply}>
            {pending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
            {pending ? 'Saving…' : 'Apply'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
