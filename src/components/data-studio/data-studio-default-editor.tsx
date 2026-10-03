'use client';

/**
 * data-studio-default-editor.tsx
 *
 * Compact type-aware schema-default editor used by the table dialog.
 */

import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import type { DataStudioEditableColumn } from './data-studio-schema-draft';

export function DataStudioDefaultEditor({
  column,
  disabled,
  onChange,
}: {
  column: DataStudioEditableColumn;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (column.defaultMode !== 'value') {
    return (
      <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
        {column.defaultMode === 'null' ? 'Stored null' : 'Applied only when provided'}
      </div>
    );
  }
  if (column.type === 'boolean') {
    return (
      <Select value={column.defaultDraft} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="min-w-0 flex-1" aria-label={`${column.label} default value`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      type={column.type === 'number'
        ? 'number'
        : column.type === 'date'
          ? 'date'
          : column.type === 'datetime'
            ? 'datetime-local'
            : 'text'}
      step={column.type === 'number'
        ? 'any'
        : column.type === 'datetime'
          ? '0.001'
          : undefined}
      value={column.defaultDraft}
      disabled={disabled}
      className={column.type === 'json' ? 'min-w-0 flex-1 font-mono text-xs' : 'min-w-0 flex-1'}
      aria-label={`${column.label} default value`}
      placeholder={column.type === 'json' ? '{}' : 'Default value'}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
