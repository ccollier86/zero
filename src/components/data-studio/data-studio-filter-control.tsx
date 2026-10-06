'use client';

import * as React from 'react';
import { Filter, Plus, Trash2 } from 'lucide-react';
import type {
  DataStudioColumn,
  DataStudioRowFilter,
  DataStudioRowFilterOperator,
  DataStudioRowFilterValue,
} from '../../frontend/client/data-studio-client';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../popover';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DataStudioTemporalInput } from './data-studio-temporal-input';
import { parseDataStudioTemporalDraft } from './data-studio-temporal-value';
import { dataStudioValueDraft } from './data-studio-value';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

const OPERATORS: readonly {
  value: DataStudioRowFilterOperator;
  label: string;
}[] = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'at most' },
];
const MAX_FILTERS = 8;

export interface DataStudioFilterControlProps {
  readonly columns: readonly DataStudioColumn[];
  readonly filters: readonly DataStudioRowFilter[];
  readonly onChange: (filters: readonly DataStudioRowFilter[]) => void;
  readonly disabled?: boolean;
}

/** Extensible scalar filter builder for the server-owned row query. */
export function DataStudioFilterControl({
  columns,
  filters,
  onChange,
  disabled = false,
}: DataStudioFilterControlProps) {
  const [open, setOpen] = React.useState(false);
  const [drafts, setDrafts] = React.useState<readonly DataStudioRowFilter[]>(filters);
  const filterableColumns = React.useMemo(
    () => columns.filter((column) => column.type !== 'json'),
    [columns],
  );
  const hasInvalidValue = drafts.some((filter) => {
    const column = filterableColumns.find((item) => item.key === filter.columnKey);
    return (filter.value === null && isRangeOperator(filter.operator))
      || (typeof filter.value === 'number' && !Number.isFinite(filter.value))
      || ((column?.type === 'date' || column?.type === 'datetime') && filter.value !== null
        && !validTemporalFilter(filter.value, column));
  });
  const filtersTooLarge = JSON.stringify(drafts).length > 8_192;

  React.useEffect(() => {
    if (!open) setDrafts(filters);
  }, [filters, open]);
  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const addFilter = () => {
    if (disabled || drafts.length >= MAX_FILTERS) return;
    const column = filterableColumns[0];
    if (!column) return;
    setDrafts((current) => [...current, {
      columnKey: column.key,
      operator: defaultOperator(column),
      value: defaultValue(column),
    }]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2"
          disabled={disabled || filterableColumns.length === 0}
          aria-label={`Record filters${filters.length ? `, ${filters.length} active` : ''}`}
        >
          <Filter className="size-3.5" aria-hidden="true" />
          Filters
          {filters.length > 0 && <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1">{filters.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(34rem,calc(100vw-1rem))] space-y-3 p-3">
        <div>
          <h3 className="text-sm font-medium">Record filters</h3>
          <p className="text-xs text-muted-foreground">Filters run against this organization’s logical rows.</p>
        </div>
        <div className="space-y-2">
          {drafts.map((filter, index) => {
            const column = filterableColumns.find((item) => item.key === filter.columnKey)
              ?? filterableColumns[0];
            if (!column) return null;
            const temporal = column.type === 'date' || column.type === 'datetime';
            return (
              <div key={`${index}:${filter.columnKey}`} className={`grid gap-2 rounded-lg border p-2 ${temporal
                ? 'sm:grid-cols-[1fr_1fr_auto]' : 'sm:grid-cols-[1fr_0.9fr_1fr_auto]'}`}>
                <Select
                  disabled={disabled}
                  value={filter.columnKey}
                  onValueChange={(columnKey) => {
                    const nextColumn = filterableColumns.find((item) => item.key === columnKey)!;
                    updateFilter(setDrafts, index, {
                      columnKey,
                      operator: defaultOperator(nextColumn),
                      value: defaultValue(nextColumn),
                    });
                  }}
                >
                  <SelectTrigger className="h-8" aria-label={`Filter ${index + 1} column`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterableColumns.map((item) => (
                      <SelectItem key={item.columnId} value={item.key}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  disabled={disabled}
                  value={filter.operator}
                  onValueChange={(operator) => updateFilter(setDrafts, index, {
                    operator: operator as DataStudioRowFilterOperator,
                  })}
                >
                  <SelectTrigger className="h-8" aria-label={`Filter ${index + 1} operator`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS.filter((operator) => supportsOperator(column, operator.value)).map((operator) => (
                      <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className={temporal ? 'min-w-0 sm:col-span-3 sm:row-start-2' : 'min-w-0'}>
                  <FilterValueInput column={column} value={filter.value} disabled={disabled}
                    onChange={(value) => updateFilter(setDrafts, index, { value })} />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={`size-8 ${temporal ? 'sm:col-start-3 sm:row-start-1' : ''}`}
                  disabled={disabled}
                  aria-label={`Remove filter ${index + 1}`}
                  onClick={() => setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            );
          })}
          {drafts.length === 0 && (
            <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">No record filters.</p>
          )}
          {(hasInvalidValue || filtersTooLarge) && (
            <p role="alert" className="text-xs text-destructive">
              {filtersTooLarge
                ? 'Filters are too large. Shorten one or more values.'
                : 'Range, date, and date-time filters require a value.'}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={addFilter}
            disabled={disabled || filterableColumns.length === 0 || drafts.length >= MAX_FILTERS}
          >
            <Plus className="size-3.5" aria-hidden="true" /> Add filter
          </Button>
          <div className="flex gap-2">
            {filters.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setDrafts([]);
                  onChange([]);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            )}
            <PopoverClose asChild>
              <Button
                type="button"
                size="sm"
                disabled={disabled || hasInvalidValue || filtersTooLarge || drafts.length > MAX_FILTERS}
                onClick={() => { if (!disabled && !hasInvalidValue && !filtersTooLarge) onChange(drafts); }}
              >
                Apply
              </Button>
            </PopoverClose>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterValueInput({
  column,
  value,
  onChange,
  disabled,
}: {
  column: DataStudioColumn;
  value: DataStudioRowFilterValue;
  onChange: (value: DataStudioRowFilterValue) => void;
  disabled: boolean;
}) {
  if (column.type === 'boolean') {
    return (
      <Select value={String(value === true)} disabled={disabled} onValueChange={(next) => onChange(next === 'true')}>
        <SelectTrigger className="h-8" aria-label={`${column.label} filter value`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (column.type === 'date' || column.type === 'datetime') {
    return <DataStudioTemporalInput type={column.type} value={filterInputValue(value, column)}
      aria-label={`${column.label} filter value`} size="sm" disabled={disabled}
      onValueChange={(next) => onChange(filterValue(next, column))} />;
  }
  return (
    <Input
      type={column.type === 'number' ? 'number' : 'text'}
      value={filterInputValue(value, column)}
      aria-label={`${column.label} filter value`}
      maxLength={4_096}
      disabled={disabled}
      className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
      onChange={(event) => onChange(filterValue(event.target.value, column))}
    />
  );
}

function updateFilter(
  setDrafts: React.Dispatch<React.SetStateAction<readonly DataStudioRowFilter[]>>,
  index: number,
  patch: Partial<DataStudioRowFilter>,
) {
  setDrafts((current) => current.map((filter, itemIndex) =>
    itemIndex === index ? { ...filter, ...patch } : filter));
}

function supportsOperator(column: DataStudioColumn, operator: DataStudioRowFilterOperator): boolean {
  if (operator === 'contains') return column.type === 'text';
  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    return column.type === 'number' || column.type === 'date' || column.type === 'datetime';
  }
  return column.type !== 'json';
}

function isRangeOperator(operator: DataStudioRowFilterOperator): boolean {
  return operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte';
}

function defaultOperator(column: DataStudioColumn): DataStudioRowFilterOperator {
  return column.type === 'text' ? 'contains' : 'eq';
}

function defaultValue(column: DataStudioColumn): DataStudioRowFilterValue {
  if (column.type === 'boolean') return false;
  if (column.type === 'number') return null;
  return '';
}

function filterInputValue(
  value: DataStudioRowFilterValue,
  column: DataStudioColumn,
): string {
  if (value == null) return '';
  if (column.type !== 'datetime' || typeof value !== 'string' || value === '') return String(value);
  // Incomplete local text stays visible; valid stored timestamps are displayed
  // with the same seconds/milliseconds-preserving binding as records/defaults.
  if (!/Z$|[+-]\d{2}:\d{2}$/.test(value)) return value;
  return dataStudioValueDraft(value, column);
}

function filterValue(value: string, column: DataStudioColumn): DataStudioRowFilterValue {
  if (column.type === 'number') return value === '' ? null : Number(value);
  if (column.type === 'datetime' && value !== '') {
    try { return parseDataStudioTemporalDraft(value, 'datetime'); }
    catch { return value; }
  }
  return value;
}

function validTemporalFilter(value: DataStudioRowFilterValue, column: DataStudioColumn): boolean {
  if (typeof value !== 'string' || value === '') return false;
  try { parseDataStudioTemporalDraft(filterInputValue(value, column), column.type as 'date' | 'datetime'); return true; }
  catch { return false; }
}
