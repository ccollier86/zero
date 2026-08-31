/**
 * time-picker.tsx
 *
 * Renders Zero's accessible hour, minute, and period picker as canonical HH:mm.
 */

'use client';

import * as React from 'react';
import { Clock3 } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatTimeValue,
  normalizeMinute,
  parseTimeValue,
  type TimeParts,
} from '@/components/ui/time-picker-value';

export interface TimePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  minuteStep?: number;
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);

/** Render a controlled time picker while emitting only valid 24-hour values. */
export function TimePicker({
  value,
  onChange,
  disabled = false,
  minuteStep = 1,
  className,
  id,
  name,
  'aria-label': ariaLabel = 'Time',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: TimePickerProps) {
  const parsed = parseTimeValue(value);
  const minutes = React.useMemo(() => {
    const step = Number.isInteger(minuteStep) && minuteStep >= 1 && minuteStep <= 30
      ? minuteStep
      : 1;
    return Array.from({ length: Math.ceil(60 / step) }, (_, index) => index * step)
      .filter((minute) => minute < 60);
  }, [minuteStep]);

  const update = React.useCallback((change: Partial<TimeParts>) => {
    const now = new Date();
    const fallback: TimeParts = {
      hour: now.getHours() % 12 || 12,
      minute: normalizeMinute(now.getMinutes(), minuteStep),
      period: now.getHours() >= 12 ? 'PM' : 'AM',
    };
    onChange?.(formatTimeValue({ ...(parsed ?? fallback), ...change }));
  }, [minuteStep, onChange, parsed]);

  return (
    <div
      id={id}
      data-slot="time-picker"
      role="group"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-lg border border-transparent',
        ariaInvalid && 'border-destructive/40',
        className,
      )}
    >
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      <Clock3 className="ml-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Select
        value={parsed ? String(parsed.hour) : undefined}
        onValueChange={(next) => update({ hour: Number(next) })}
        disabled={disabled}
      >
        <SelectTrigger className="min-w-[4.5rem]" aria-label={`${ariaLabel} hour`}>
          <SelectValue placeholder="Hour" />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((hour) => <SelectItem key={hour} value={String(hour)}>{hour}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="text-sm font-semibold text-muted-foreground" aria-hidden="true">:</span>
      <Select
        value={parsed ? String(parsed.minute).padStart(2, '0') : undefined}
        onValueChange={(next) => update({ minute: Number(next) })}
        disabled={disabled}
      >
        <SelectTrigger className="min-w-[5rem]" aria-label={`${ariaLabel} minute`}>
          <SelectValue placeholder="Minute" />
        </SelectTrigger>
        <SelectContent>
          {minutes.map((minute) => {
            const label = String(minute).padStart(2, '0');
            return <SelectItem key={minute} value={label}>{label}</SelectItem>;
          })}
        </SelectContent>
      </Select>
      <Select
        value={parsed?.period}
        onValueChange={(next) => update({ period: next as TimeParts['period'] })}
        disabled={disabled}
      >
        <SelectTrigger className="min-w-[4.75rem]" aria-label={`${ariaLabel} period`}>
          <SelectValue placeholder="AM/PM" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
