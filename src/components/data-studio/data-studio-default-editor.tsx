'use client';

/**
 * data-studio-default-editor.tsx
 *
 * Compact type-aware schema-default editor used by the table dialog.
 */

import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
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
      <div className="min-w-0 py-1 text-xs text-muted-foreground">
        {column.defaultMode === 'null' ? 'New records receive an explicit null.' : 'No value is added automatically.'}
      </div>
    );
  }
  if (column.type === 'json') {
    return <Textarea value={column.defaultDraft} disabled={disabled} rows={4}
      className="min-h-24 resize-y font-mono text-xs leading-5"
      aria-label={`${column.label} default value`} placeholder="{}"
      onChange={event => onChange(event.target.value)} />;
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
      type={column.type === 'date'
          ? 'date'
          : column.type === 'datetime'
            ? 'datetime-local'
            : 'text'}
      inputMode={column.type === 'number' ? 'decimal' : undefined}
      step={column.type === 'number'
        ? 'any'
        : column.type === 'datetime'
          ? '0.001'
          : undefined}
      value={column.defaultDraft}
      disabled={disabled}
      className="min-w-0 flex-1"
      aria-label={`${column.label} default value`}
      placeholder={column.type === 'number' ? '0' : 'Default value'}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
