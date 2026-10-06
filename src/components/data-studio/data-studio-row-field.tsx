'use client';

/** Typed create-record field presentation, consuming Zero's established controls and shared temporal editor. */
import { Braces, Calendar, CalendarClock, Hash, ToggleLeft, Type } from 'lucide-react';
import type { DataStudioColumn } from '../../frontend/client/data-studio-client';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DataStudioTemporalInput } from './data-studio-temporal-input';
import { formatDataStudioValue } from './data-studio-value';
import type { DataStudioRowDraftField } from './data-studio-row-draft';

const TYPE_INFO = {
  text: { label: 'Text', icon: Type }, number: { label: 'Number', icon: Hash },
  boolean: { label: 'True / false', icon: ToggleLeft }, date: { label: 'Date', icon: Calendar },
  datetime: { label: 'Date & time', icon: CalendarClock }, json: { label: 'JSON', icon: Braces },
} as const;

/** One stable-ID field with accessible validation, type context and default-omission feedback. */
export function DataStudioRowField({ column, draft, id, disabled, error, onChange }: {
  column: DataStudioColumn; draft: DataStudioRowDraftField; id: string; disabled: boolean;
  error?: string; onChange(raw: string): void;
}) {
  const type = TYPE_INFO[column.type], Icon = type.icon;
  const hasDefault = Object.hasOwn(column, 'defaultValue');
  const defaultText = hasDefault ? formatDataStudioValue(column.defaultValue, column) : '';
  const hintId = `${id}-hint`, errorId = `${id}-error`;
  const describedBy = [column.description || hasDefault || column.type === 'datetime' ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const common = { id, disabled, 'aria-required': column.required || undefined,
    'aria-invalid': Boolean(error) || undefined, 'aria-describedby': describedBy };
  return <div data-slot="data-studio-row-field" data-column-id={column.columnId}
    className={column.type === 'json' || column.type === 'datetime' ? 'min-w-0 space-y-2 sm:col-span-2' : 'min-w-0 space-y-2'}>
    <div className="flex min-w-0 items-center justify-between gap-2">
      <Label htmlFor={id} className="min-w-0 leading-snug"><Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="break-words">{column.label}</span>
        {column.required && <span className="text-primary" aria-label="required">*</span>}
      </Label>
      <span className="shrink-0 text-[11px] text-muted-foreground">{type.label}</span>
    </div>
    {column.type === 'boolean' ? <Select value={draft.raw} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger {...common}><SelectValue placeholder={column.required ? 'Choose True or False' : 'Not set'} /></SelectTrigger>
      <SelectContent><SelectItem value="true">True</SelectItem><SelectItem value="false">False</SelectItem>
        {!column.required && <SelectItem value="null">Empty (null)</SelectItem>}</SelectContent>
    </Select> : column.type === 'json' ? <Textarea {...common} value={draft.raw} rows={4}
      className="min-h-24 max-h-48 resize-y font-mono text-xs leading-relaxed" placeholder={column.required ? '{ "key": "value" }' : 'Optional JSON value'}
      onChange={event => onChange(event.target.value)} /> : column.type === 'date' || column.type === 'datetime'
      ? <DataStudioTemporalInput id={id} type={column.type} value={draft.raw} onValueChange={onChange} disabled={disabled}
        required={column.required} invalid={Boolean(error)} aria-label={column.label} aria-describedby={describedBy} />
      : <Input {...common} value={draft.raw} type="text" inputMode={column.type === 'number' ? 'decimal' : undefined}
        autoComplete="off" placeholder={column.type === 'number' ? 'Enter a number' : column.required ? `Enter ${column.label.toLowerCase()}` : 'Optional value'}
        onChange={event => onChange(event.target.value)} />}
    {(column.description || hasDefault || column.type === 'datetime') && <div id={hintId} className="space-y-1 text-xs leading-relaxed text-muted-foreground">
      {column.description && <p>{column.description}</p>}
      {hasDefault && <p className="truncate" title={`Default: ${defaultText}`}>
        <span className="font-medium">Default:</span> {defaultText || 'Empty text'}
        {!draft.touched && <span> · used automatically</span>}
      </p>}
      {column.type === 'datetime' && <p>Displayed in your local time zone; saved as an exact timestamp.</p>}
    </div>}
    {error && <p id={errorId} role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
  </div>;
}
