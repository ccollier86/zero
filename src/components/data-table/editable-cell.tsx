'use client';

import * as React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import * as v from 'valibot';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/animate-ui/components/radix/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldMeta } from '../../schema/field-types';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { TagInput } from '@/components/ui/tag-input';
import { Combobox } from '@/components/ui/combobox';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EditableCellProps {
  value: unknown;
  rowId: string;
  columnId: string;
  fieldMeta?: FieldMeta;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: (rowId: string, columnId: string, value: unknown) => void;
  onCancel: () => void;
  onTabNext?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditableCell({
  value,
  rowId,
  columnId,
  fieldMeta,
  isEditing,
  onStartEdit,
  onSave,
  onCancel,
  onTabNext,
}: EditableCellProps) {
  const type = fieldMeta?.type ?? 'text';

  // Boolean: immediate toggle, no edit mode
  if (type === 'boolean') {
    return (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={value as boolean}
          onCheckedChange={(checked) => {
            onSave(rowId, columnId, checked === true);
          }}
        />
      </div>
    );
  }

  if (isEditing) {
    return (
      <EditingInput
        value={value}
        columnId={columnId}
        rowId={rowId}
        fieldMeta={fieldMeta}
        onSave={onSave}
        onCancel={onCancel}
        onTabNext={onTabNext}
      />
    );
  }

  // Display mode
  return (
    <div
      className="cursor-pointer rounded px-1 py-0.5 hover:bg-accent/50 transition-colors min-h-[1.5rem]"
      onClick={onStartEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onStartEdit();
        }
      }}
    >
      {formatDisplayValue(value, fieldMeta)}
    </div>
  );
}

// ─── Editing Input ──────────────────────────────────────────────────────────

function EditingInput({
  value,
  columnId,
  rowId,
  fieldMeta,
  onSave,
  onCancel,
  onTabNext,
}: {
  value: unknown;
  columnId: string;
  rowId: string;
  fieldMeta?: FieldMeta;
  onSave: (rowId: string, columnId: string, value: unknown) => void;
  onCancel: () => void;
  onTabNext?: () => void;
}) {
  const [editValue, setEditValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const type = fieldMeta?.type ?? 'text';

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = useCallback(() => {
    // Validate if possible
    setError(null);
    onSave(rowId, columnId, editValue);
  }, [editValue, rowId, columnId, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleSave();
        onTabNext?.();
      }
    },
    [handleSave, onCancel, onTabNext],
  );

  if ((type === 'select' || type === 'enum') && fieldMeta?.options) {
    return (
      <Select
        value={(editValue as string) ?? ''}
        onValueChange={(v) => {
          onSave(rowId, columnId, v);
        }}
      >
        <SelectTrigger className="h-7 text-xs" autoFocus>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fieldMeta.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (type === 'number') {
    return (
      <Input
        ref={inputRef}
        type="number"
        value={editValue == null ? '' : String(editValue)}
        onChange={(e) => setEditValue(e.target.value === '' ? '' : Number(e.target.value))}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className="h-7 text-xs"
        min={fieldMeta?.min}
        max={fieldMeta?.max}
      />
    );
  }

  if (type === 'date' || type === 'datetime') {
    return (
      <DatePicker
        value={editValue ? new Date(editValue as string) : undefined}
        onChange={(date) => {
          const val = date
            ? type === 'datetime'
              ? date.toISOString()
              : date.toISOString().split('T')[0]
            : '';
          onSave(rowId, columnId, val);
        }}
      />
    );
  }

  if (type === 'dateRange') {
    const rangeVal = Array.isArray(editValue) ? editValue as string[] : ['', ''];
    const range: DateRange | undefined =
      rangeVal[0] && rangeVal[1]
        ? { from: new Date(rangeVal[0]), to: new Date(rangeVal[1]) }
        : undefined;
    return (
      <DateRangePicker
        value={range}
        onChange={(r) => {
          if (r?.from && r?.to) {
            onSave(rowId, columnId, [
              r.from.toISOString().split('T')[0],
              r.to.toISOString().split('T')[0],
            ]);
          } else if (!r?.from && !r?.to) {
            onSave(rowId, columnId, ['', '']);
          }
        }}
      />
    );
  }

  if (type === 'tags') {
    return (
      <div onKeyDown={handleKeyDown} onBlur={handleSave}>
        <TagInput
          value={Array.isArray(editValue) ? (editValue as string[]) : []}
          onChange={(tags) => setEditValue(tags)}
          placeholder="Add tag..."
        />
      </div>
    );
  }

  if (type === 'combobox' && fieldMeta?.options) {
    return (
      <Combobox
        value={editValue as string | string[]}
        onChange={(v) => {
          onSave(rowId, columnId, v);
        }}
        options={fieldMeta.options.map((o) => ({ value: o.value, label: o.label }))}
        multiple={fieldMeta.multiple}
        searchable={fieldMeta.searchable ?? true}
      />
    );
  }

  // Default: text input
  return (
    <Input
      ref={inputRef}
      type={type === 'email' ? 'email' : type === 'url' ? 'url' : 'text'}
      value={(editValue as string) ?? ''}
      onChange={(e) => setEditValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleSave}
      className="h-7 text-xs"
    />
  );
}

// ─── Display Formatting ─────────────────────────────────────────────────────

function formatDisplayValue(value: unknown, meta?: FieldMeta): string {
  if (value == null || value === '') return '\u00A0'; // non-breaking space for empty

  if (meta?.type === 'boolean') {
    return value ? '\u2713' : '\u2717';
  }

  if ((meta?.type === 'select' || meta?.type === 'enum') && meta.options) {
    const opt = meta.options.find((o) => o.value === value);
    return opt?.label ?? String(value);
  }

  if (meta?.type === 'multiSelect' && Array.isArray(value) && meta.options) {
    return value
      .map((v) => meta.options!.find((o) => o.value === v)?.label ?? v)
      .join(', ');
  }

  if (meta?.type === 'date' && typeof value === 'string' && value) {
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return value;
    }
  }

  if (meta?.type === 'datetime' && typeof value === 'string' && value) {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  if (meta?.type === 'dateRange' && Array.isArray(value)) {
    const [from, to] = value as string[];
    if (from && to) {
      try {
        return `${new Date(from).toLocaleDateString()} – ${new Date(to).toLocaleDateString()}`;
      } catch {
        return `${from} – ${to}`;
      }
    }
    return '\u00A0';
  }

  if (meta?.type === 'tags' && Array.isArray(value)) {
    return value.join(', ');
  }

  if (meta?.type === 'combobox' && meta.options) {
    if (Array.isArray(value)) {
      return value
        .map((v) => meta.options!.find((o) => o.value === v)?.label ?? v)
        .join(', ');
    }
    const opt = meta.options.find((o) => o.value === value);
    return opt?.label ?? String(value);
  }

  return String(value);
}
