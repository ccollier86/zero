import * as React from 'react';
import type { FieldMeta } from '../../schema/field-types';
import { Badge } from '#zero/components/ui/badge';

export function formatEditableCellValue(
  value: unknown,
  meta?: FieldMeta,
): React.ReactNode {
  if (value == null || value === '') return '\u00A0';
  if (meta?.type === 'boolean') return value ? '\u2713' : '\u2717';

  if ((meta?.type === 'select' || meta?.type === 'enum') && meta.options) {
    return meta.options.find((option) => option.value === value)?.label ?? String(value);
  }

  if (meta?.type === 'multiSelect' && Array.isArray(value) && meta.options) {
    return value
      .map((candidate) => (
        meta.options!.find((option) => option.value === candidate)?.label ?? candidate
      ))
      .join(', ');
  }

  if (meta?.type === 'date' && typeof value === 'string') {
    return formatDate(value, false);
  }
  if (meta?.type === 'datetime' && typeof value === 'string') {
    return formatDate(value, true);
  }
  if (meta?.type === 'dateRange' && Array.isArray(value)) {
    const [from, to] = value as string[];
    return from && to ? `${formatDate(from, false)} – ${formatDate(to, false)}` : '\u00A0';
  }

  if (meta?.type === 'tags' && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((tag) => <Badge key={String(tag)} variant="secondary">{String(tag)}</Badge>)}
      </span>
    );
  }

  if (meta?.type === 'combobox' && meta.options) {
    if (Array.isArray(value)) {
      return value
        .map((candidate) => (
          meta.options!.find((option) => option.value === candidate)?.label ?? candidate
        ))
        .join(', ');
    }
    return meta.options.find((option) => option.value === value)?.label ?? String(value);
  }

  return String(value);
}

function formatDate(value: string, includeTime: boolean): string {
  try {
    const date = new Date(value);
    return includeTime ? date.toLocaleString() : date.toLocaleDateString();
  } catch {
    return value;
  }
}
