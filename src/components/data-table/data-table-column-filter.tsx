/**
 * data-table-column-filter.tsx
 *
 * Maps Zero schema field metadata to one compact TanStack column-filter
 * control. This file owns generated filter presentation only; the toolbar owns
 * placement and TanStack owns filter state.
 */

'use client';

import type { Column } from '@tanstack/react-table';

import { Input } from '#zero/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import type { FieldMeta } from '../../schema/field-types';
import { DatePicker } from '../ui/date-picker';
import { parseDatePickerCalendarValue, formatDatePickerCalendarValue } from '../ui/date-picker-value';

export interface DataTableColumnFilterProps<TData> {
  column: Column<TData, unknown>;
}

/** Render a schema-aware filter control for one table column. */
export function DataTableColumnFilter<TData>({
  column,
}: DataTableColumnFilterProps<TData>) {
  const meta = (column.columnDef.meta as { fieldMeta?: FieldMeta } | undefined)?.fieldMeta;
  const label = getDataTableColumnLabel(column, column.id);
  const value = column.getFilterValue();
  const ariaLabel = `Filter by ${label}`;

  if (meta?.type === 'boolean') {
    return (
      <Select
        value={value === undefined ? '__all' : String(value)}
        onValueChange={(next) => {
          column.setFilterValue(next === '__all' ? undefined : next === 'true');
        }}
      >
        <SelectTrigger aria-label={ariaLabel} className="h-8 w-[9rem]">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{label}: All</SelectItem>
          <SelectItem value="true">{label}: Yes</SelectItem>
          <SelectItem value="false">{label}: No</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (
    (meta?.type === 'select' || meta?.type === 'enum' || meta?.type === 'combobox')
    && meta.options
  ) {
    return (
      <Select
        value={typeof value === 'string' ? value : '__all'}
        onValueChange={(next) => {
          column.setFilterValue(next === '__all' ? undefined : next);
        }}
      >
        <SelectTrigger aria-label={ariaLabel} className="h-8 w-[12rem]">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{label}: All</SelectItem>
          {meta.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (meta?.type === 'number') {
    return (
      <div className="w-[10rem] shrink-0">
        <Input
          aria-label={ariaLabel}
          type="number"
          value={value == null ? '' : String(value)}
          placeholder={label}
          onChange={(event) => {
            const next = event.target.value;
            column.setFilterValue(next === '' ? undefined : Number(next));
          }}
          className="h-8"
        />
      </div>
    );
  }

  if (meta?.type === 'date' || meta?.type === 'datetime') {
    return (
      <div className="w-[14rem] shrink-0">
        <DatePicker
          value={typeof value === 'string' ? parseDatePickerCalendarValue(value) : undefined}
          onChange={(next) => column.setFilterValue(next ? formatDatePickerCalendarValue(next) : undefined)}
          inputProps={{ 'aria-label': ariaLabel, className: 'h-8 text-sm' }}
          triggerClassName="size-8"
        />
      </div>
    );
  }

  return (
    <div className="w-[12rem] shrink-0">
      <Input
        aria-label={ariaLabel}
        value={value == null ? '' : String(value)}
        placeholder={label}
        onChange={(event) => {
          column.setFilterValue(event.target.value || undefined);
        }}
        className="h-8"
      />
    </div>
  );
}

/** Resolve the display label shared by generated filters and active badges. */
export function getDataTableColumnLabel<TData>(
  column: Column<TData, unknown> | undefined,
  fallback: string,
): string {
  if (!column) return fallback;
  return typeof column.columnDef.header === 'string'
    ? column.columnDef.header
    : fallback;
}
