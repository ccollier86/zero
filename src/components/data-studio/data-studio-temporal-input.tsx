'use client';

/**
 * data-studio-temporal-input.tsx
 *
 * Binds local temporal drafts to Zero's existing DatePicker and TimePicker.
 * It owns presentation and typed buffers only, never persistence or transport.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import { Button } from '../ui/button';
import { DatePicker } from '../ui/date-picker';
import { formatDatePickerValue } from '../ui/date-picker-value';
import { Input } from '../ui/input';
import { TimePicker } from '../ui/time-picker';
import {
  dataStudioTemporalParts, updateDataStudioTemporalDate, updateDataStudioTemporalDateText,
  updateDataStudioTemporalSeconds, updateDataStudioTemporalTime, type DataStudioTemporalType,
} from './data-studio-temporal-value';

/** Raw date/local-datetime binding; callers retain touched/default/null policy. */
export interface DataStudioTemporalInputProps {
  readonly type: DataStudioTemporalType;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly 'aria-label'?: string;
  readonly 'aria-describedby'?: string;
  readonly onBlur?: React.FocusEventHandler<HTMLDivElement>;
  readonly onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  readonly autoFocus?: boolean;
  readonly size?: 'default' | 'sm';
  readonly className?: string;
}

/** Preserve precision and invalid text while offering the platform's existing pickers. */
export function DataStudioTemporalInput({
  type, value, onValueChange, id, disabled = false, readOnly = false, required = false,
  invalid = false, 'aria-label': label = type === 'date' ? 'Date' : 'Date and time',
  'aria-describedby': describedBy, onBlur, onKeyDown, autoFocus, size = 'default', className,
}: DataStudioTemporalInputProps) {
  const parts = dataStudioTemporalParts(value, type);
  const current = React.useRef(value);
  current.current = value;
  // Only a text draft created by this field may retain its previous calendar
  // selection. An external reset/field change never inherits another buffer.
  const textFallback = React.useRef<{ value: string; field: string; date: Date | undefined } | null>(null);
  const field = id ?? label;
  if (textFallback.current && (textFallback.current.value !== value || textFallback.current.field !== field)) {
    textFallback.current = null;
  }
  const fallback = textFallback.current?.value === value && textFallback.current.field === field
    ? textFallback.current.date : undefined;
  const selectedDate = parts.date ?? fallback;
  const inputInvalid = invalid || !parts.valid;

  function change(next: string, explicitClear = false) {
    if (disabled || readOnly || (!explicitClear && next === current.current)) return;
    try {
      const result = onValueChange(next) as unknown;
      current.current = next;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => emitFrontendCode(
          OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, { metadata: { operation: 'temporal-change' } },
        ));
      }
    } catch {
      emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, { metadata: { operation: 'temporal-change' } });
    }
  }

  return <div data-slot="data-studio-temporal-input" data-type={type} data-size={size}
    className={cn('min-w-0', type === 'datetime'
      ? 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] items-start gap-x-3 gap-y-2'
      : 'space-y-2', className)} onBlur={onBlur} onKeyDown={onKeyDown}>
    <div className="flex min-w-0 items-center gap-1.5">
      <DatePicker value={selectedDate} inputValue={parts.date ? formatDatePickerValue(parts.date) : parts.dateDraft}
        disabled={disabled} readOnly={readOnly} className="min-w-0 flex-1"
        triggerClassName={size === 'sm' ? 'size-8 shrink-0' : 'shrink-0'}
        inputProps={{ id, required, autoFocus, 'aria-label': label, 'aria-describedby': describedBy,
          'aria-invalid': inputInvalid || undefined, maxLength: 64, className: size === 'sm' ? 'h-8 text-sm' : undefined }}
        onInputValueChange={(text) => {
          const active = dataStudioTemporalParts(current.current, type);
          const prior = textFallback.current?.value === current.current && textFallback.current.field === field
            ? textFallback.current.date : undefined;
          const calendar = active.date ?? prior;
          const next = calendar && text === formatDatePickerValue(calendar)
            ? updateDataStudioTemporalDate(current.current, calendar, type)
            : updateDataStudioTemporalDateText(current.current, text, type);
          textFallback.current = next !== '' && !dataStudioTemporalParts(next, type).date
            ? { value: next, field, date: calendar } : null;
          change(next);
        }}
        onChange={(date) => {
          const next = updateDataStudioTemporalDate(current.current, date, type);
          textFallback.current = null;
          change(next);
        }} />
      <Button type="button" variant="ghost" size="icon" className={cn('shrink-0 text-muted-foreground', size === 'sm' && 'size-8')}
        disabled={disabled || readOnly} aria-label={`Clear ${label}`} title={`Clear ${label}`}
        onClick={() => change('', true)}><X className="size-3.5" aria-hidden="true" /></Button>
    </div>
    {type === 'datetime' && <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <TimePicker value={parts.time} onChange={(time) => change(updateDataStudioTemporalTime(current.current, time))}
          disabled={disabled || readOnly} aria-label={`${label} time`} aria-describedby={describedBy}
          aria-invalid={inputInvalid || undefined}
          className="min-w-0 flex-1" triggerClassName={size === 'sm' ? 'h-8' : undefined} />
        <div className="w-[6.5rem] min-w-0 shrink-0">
          <Input type="text" inputMode="decimal" value={parts.seconds} maxLength={6}
            disabled={disabled} readOnly={readOnly} aria-label={`${label} seconds`}
            aria-describedby={describedBy} aria-invalid={inputInvalid || undefined}
            placeholder="00.000" className={cn('font-mono tabular-nums', size === 'sm' && 'h-8 text-sm')}
            onChange={(event) => change(updateDataStudioTemporalSeconds(current.current, event.target.value))} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Local time · seconds and milliseconds retained</p>
    </div>}
  </div>;
}
