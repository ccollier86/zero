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

import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#zero/components/animate-ui/components/radix/popover';
import { Calendar } from '#zero/components/ui/calendar';
import type { CalendarProps } from '#zero/components/ui/calendar';
import {
  formatDatePickerValue,
  parseDatePickerInput,
} from '#zero/components/ui/date-picker-value';

type DatePickerCalendarProps = Omit<
  CalendarProps,
  'mode' | 'selected' | 'onSelect' | 'autoFocus'
>;

export interface DatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Read-only inputs remain inspectable; the calendar cannot mutate their value. */
  readOnly?: boolean;
  /** Optional controlled text buffer; retains invalid/incomplete parent-owned drafts. */
  inputValue?: string;
  /** Called for user text edits before the valid Date selection callback. */
  onInputValueChange?: (value: string) => void;
  /** Native field attributes and handlers without replacing picker-owned value handling. */
  inputProps?: Omit<React.ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'disabled' | 'readOnly' | 'placeholder'>;
  triggerClassName?: string;
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
  readOnly = false,
  inputValue: controlledInput,
  onInputValueChange,
  inputProps,
  triggerClassName,
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

  React.useEffect(() => {
    // A caller may reset an invalid buffer without changing the selected Date.
    if (controlledInput !== undefined) setInputInvalid(false);
  }, [controlledInput]);

  React.useEffect(() => {
    if (disabled || readOnly) setOpen(false);
  }, [disabled, readOnly]);

  const commitInput = React.useCallback((candidate: string) => {
    if (disabled || readOnly) return false;
    const trimmed = candidate.trim();
    if (!trimmed) {
      setInputValue('');
      setInputInvalid(false);
      onChange?.(undefined);
      onInputValueChange?.('');
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
    onInputValueChange?.(formatDatePickerValue(parsed));
    return true;
  }, [calendarProps?.disabled, formattedValue, onChange, onInputValueChange, disabled, readOnly]);

  const handleInputChange = React.useCallback(
    (nextValue: string) => {
      if (disabled || readOnly) return;
      setInputValue(nextValue);
      setInputInvalid(false);
      onInputValueChange?.(nextValue);
      if (parseDatePickerInput(nextValue)) commitInput(nextValue);
    },
    [commitInput, disabled, readOnly, onInputValueChange],
  );

  return (
    <Popover open={open} onOpenChange={(next) => { if (!next || (!disabled && !readOnly)) setOpen(next); }}>
      <div
        data-slot="date-picker"
        className={cn('flex w-full min-w-0 items-center gap-2', className)}
      >
        <Input
          {...inputProps}
          type="text"
          autoComplete="off"
          disabled={disabled}
          readOnly={readOnly}
          value={controlledInput ?? inputValue}
          placeholder={placeholder}
          aria-invalid={inputInvalid || inputProps?.['aria-invalid'] || undefined}
          aria-label={inputProps?.['aria-label'] ?? placeholder}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={(event) => {
            commitInput(event.currentTarget.value);
            inputProps?.onBlur?.(event);
          }}
          onKeyDown={(event) => {
            inputProps?.onKeyDown?.(event);
            if (event.defaultPrevented || disabled || readOnly) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              commitInput(event.currentTarget.value);
            }
            if (event.key === 'Escape') {
              setInputValue(formattedValue);
              setInputInvalid(false);
              if ((controlledInput ?? inputValue) !== formattedValue) onInputValueChange?.(formattedValue);
            }
          }}
        />
        <PopoverTrigger asChild>
        <Button
          data-slot="date-picker-trigger"
          type="button"
          variant="outline"
          size="icon"
          className={triggerClassName}
          disabled={disabled || readOnly}
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
            if (disabled || readOnly) return;
            setInputValue(formatDatePickerValue(date));
            setInputInvalid(false);
            onChange?.(date);
            onInputValueChange?.(formatDatePickerValue(date));
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
