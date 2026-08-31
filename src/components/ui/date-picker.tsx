/**
 * date-picker.tsx
 *
 * Composes Zero's typed date input, calendar popover, and controlled Date
 * contract. Calendar policy remains caller-owned through calendarProps.
 */

'use client';

import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import type { Transition } from 'motion/react';
import { dateMatchModifiers } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/animate-ui/components/radix/popover';
import { Calendar } from '@/components/ui/calendar';
import type { CalendarProps } from '@/components/ui/calendar';
import {
  formatDatePickerValue,
  parseDatePickerInput,
} from '@/components/ui/date-picker-value';

type DatePickerCalendarProps = Omit<
  CalendarProps,
  'mode' | 'selected' | 'onSelect' | 'autoFocus'
>;

export interface DatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  transition?: Transition;
  calendarProps?: DatePickerCalendarProps;
}

/** Render a controlled date field with typed and calendar selection paths. */
function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled = false,
  className,
  transition,
  calendarProps,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const formattedValue = formatDatePickerValue(value);
  const [inputValue, setInputValue] = React.useState(formattedValue);
  const [inputInvalid, setInputInvalid] = React.useState(false);

  React.useEffect(() => {
    setInputValue(formattedValue);
    setInputInvalid(false);
  }, [formattedValue]);

  const commitInput = React.useCallback((candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) {
      setInputValue('');
      setInputInvalid(false);
      onChange?.(undefined);
      return true;
    }
    if (trimmed === formattedValue) {
      setInputInvalid(false);
      return true;
    }

    const parsed = parseDatePickerInput(trimmed);
    const blocked = Boolean(
      parsed
      && calendarProps?.disabled
      && dateMatchModifiers(parsed, calendarProps.disabled),
    );
    if (!parsed || blocked) {
      setInputInvalid(true);
      return false;
    }

    setInputValue(formatDatePickerValue(parsed));
    setInputInvalid(false);
    onChange?.(parsed);
    return true;
  }, [calendarProps?.disabled, formattedValue, onChange]);

  const handleInputChange = React.useCallback(
    (nextValue: string) => {
      setInputValue(nextValue);
      setInputInvalid(false);
      if (parseDatePickerInput(nextValue)) commitInput(nextValue);
    },
    [commitInput],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        data-slot="date-picker"
        className={cn('flex w-full min-w-0 items-center gap-2', className)}
      >
        <Input
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={inputValue}
          placeholder={placeholder}
          aria-invalid={inputInvalid || undefined}
          aria-label={placeholder}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={(event) => commitInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitInput(event.currentTarget.value);
            }
            if (event.key === 'Escape') {
              setInputValue(formattedValue);
              setInputInvalid(false);
            }
          }}
        />
        <PopoverTrigger asChild>
        <Button
          data-slot="date-picker-trigger"
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label="Open date picker"
          aria-invalid={inputInvalid || undefined}
        >
          <CalendarIcon className="size-4 opacity-70" aria-hidden="true" />
        </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" align="start" transition={transition}>
        <Calendar
          {...calendarProps}
          mode="single"
          defaultMonth={calendarProps?.month ? undefined : value ?? calendarProps?.defaultMonth}
          selected={value}
          onSelect={(date) => {
            setInputValue(formatDatePickerValue(date));
            setInputInvalid(false);
            onChange?.(date);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
export type { DatePickerCalendarProps };
