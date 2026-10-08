'use client';

/** Anchored date/time editor; composes existing Zero controls without resizing the grid cell. */

import type * as React from 'react';
import { DataStudioCellEditor } from './data-studio-cell-editor';
import { DataStudioTemporalInput } from './data-studio-temporal-input';

/** Calendar/time interaction is a draft until Apply; portal focus changes never save it. */
export function DataStudioTemporalCellEditor({
  children, open, type, label, required, value, disabled, pending, dirty, error,
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
  readonly dirty: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onValueChange: (value: string) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <DataStudioCellEditor open={open} label={label} disabled={disabled} pending={pending} dirty={dirty}
      description={type === 'datetime' ? 'Local date and time · stored as an exact timestamp' : undefined}
      error={error} onOpenChange={onOpenChange} onApply={onApply} onCancel={onCancel}
      content={<DataStudioTemporalInput type={type} value={value} onValueChange={onValueChange} size="sm"
          disabled={disabled || pending} required={required} invalid={!!error}
          aria-label={`Edit ${label}`} autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.defaultPrevented && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled && !pending) onApply();
            }
          }} />}>
      {children}
    </DataStudioCellEditor>
  );
}
