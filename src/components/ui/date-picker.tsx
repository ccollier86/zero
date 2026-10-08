/**
 * date-picker.tsx
 *
 * Composes Zero's typed date input, calendar popover, and controlled Date
 * contract. Calendar policy remains caller-owned through calendarProps.
 */

'use client';

import * as React from 'react';
import { CalendarIcon, ChevronDown } from 'lucide-react';
import type { Transition } from 'motion/react';
import { dateMatchModifiers } from 'react-day-picker';

import { cn } from '#zero/lib/utils';
import { useControlledState } from '#zero/hooks/use-controlled-state';
import { useStableCallback } from '../../hooks/use-stable-callback';
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
import { PickerValueText } from './picker-value-text';
import { usePickerPopoverMotion } from './picker-popover-motion';

type DatePickerCalendarProps = Omit<
  CalendarProps,
  'mode' | 'selected' | 'onSelect' | 'autoFocus' | 'view' | 'onViewChange'
>;

export interface DatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Read-only inputs remain inspectable; the calendar cannot mutate their value. */
  readOnly?: boolean;
  /** Retain typed input by default; button mode provides the animated date label. */
  appearance?: 'input' | 'button';
  /** Optional controlled popup state; dismissing never changes the selected date. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Allow deliberate removal of the selection from the calendar footer. */
  clearable?: boolean;
  /** Animate only changed display parts in button mode. */
  animateValue?: boolean;
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
  appearance = 'input',
  open: controlledOpen,
  onOpenChange,
  clearable = true,
  animateValue = true,
  inputValue: controlledInput,
  onInputValueChange,
  inputProps,
  triggerClassName,
  className,
  transition,
  calendarProps,
}: DatePickerProps) {
  const notifyOpenChange = useStableCallback((next: boolean) => onOpenChange?.(next));
  const [open, setOpen] = useControlledState({ value: controlledOpen, defaultValue: false, onChange: notifyOpenChange });
  const [calendarView, setCalendarView] = React.useState<'days' | 'months' | 'years'>('days');
  const [calendarViewport, setCalendarViewport] = React.useState<HTMLDivElement | null>(null);
  const [calendarViewportHeight, setCalendarViewportHeight] = React.useState(0);
  const popupMotion = usePickerPopoverMotion();
  const formattedValue = formatDatePickerValue(value);
  const buttonParts = value ? new Intl.DateTimeFormat(calendarProps?.locale?.code ?? 'en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: calendarProps?.timeZone,
  }).formatToParts(value) : [{ type: 'literal', value: placeholder }];
  const buttonLabel = buttonParts.map(part => part.value).join('');
  const [inputValue, setInputValue] = React.useState(formattedValue);
  const [inputInvalid, setInputInvalid] = React.useState(false);

  React.useLayoutEffect(() => {
    const viewport = calendarViewport;
    if (!open || !viewport) return;
    const update = () => setCalendarViewportHeight(viewport.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [open, calendarViewport]);

  React.useEffect(() => {
    setInputValue(formattedValue);
    setInputInvalid(false);
  }, [formattedValue]);

  React.useEffect(() => {
    // A caller may reset an invalid buffer without changing the selected Date.
    if (controlledInput !== undefined) setInputInvalid(false);
  }, [controlledInput]);

  React.useEffect(() => {
    if ((disabled || readOnly) && open) setOpen(false);
  }, [disabled, readOnly, open, setOpen]);

  const requestOpen = React.useCallback((next: boolean) => {
    if (next && (disabled || readOnly)) return;
    setCalendarView('days');
    setOpen(next);
  }, [disabled, readOnly, setOpen]);

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
    <Popover open={open && !disabled && !readOnly} onOpenChange={requestOpen}>
      <div
        data-slot="date-picker"
        className={cn('flex w-full min-w-0 items-center gap-0', className)}
      >
        {appearance === 'input' && <Input
          {...inputProps}
          type="text"
          autoComplete="off"
          disabled={disabled}
          readOnly={readOnly}
          value={controlledInput ?? inputValue}
          placeholder={placeholder}
          aria-invalid={inputInvalid || inputProps?.['aria-invalid'] || undefined}
          aria-label={inputProps?.['aria-label'] ?? placeholder}
          wrapperClassName={cn('min-w-0 rounded-r-none', inputProps?.wrapperClassName)}
          className={cn('rounded-r-none', inputProps?.className)}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={(event) => {
            commitInput(event.currentTarget.value);
            inputProps?.onBlur?.(event);
          }}
          onKeyDown={(event) => {
            inputProps?.onKeyDown?.(event);
            if (event.defaultPrevented || event.nativeEvent.isComposing || disabled || readOnly) return;
            if (event.key === 'ArrowDown' && event.altKey) {
              event.preventDefault(); event.stopPropagation(); requestOpen(true); return;
            }
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
        />}
        <PopoverTrigger asChild>
        <Button
          data-slot="date-picker-trigger"
          type="button"
          variant="outline"
          size={appearance === 'button' ? 'default' : 'icon'}
          className={cn(appearance === 'input' ? 'h-[2.5rem] shrink-0 rounded-l-none border-l-0' : 'w-full min-w-0 justify-start text-left font-normal', triggerClassName)}
          disabled={disabled || readOnly}
          aria-label={appearance === 'button' ? `${inputProps?.['aria-label'] ?? 'Date'}, ${buttonLabel}` : 'Open date picker'}
          id={appearance === 'button' ? inputProps?.id : undefined}
          aria-describedby={appearance === 'button' ? inputProps?.['aria-describedby'] : undefined}
          aria-invalid={inputInvalid || undefined}
          aria-haspopup="dialog"
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || disabled || readOnly) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); requestOpen(true); }
          }}
        >
          <CalendarIcon className="size-4 opacity-70" aria-hidden="true" />
          {appearance === 'button' && <>
            <span className="sr-only">{buttonLabel}</span>
            <span className={cn('min-w-0 flex-1 overflow-hidden', !value && 'text-muted-foreground')}>
              <PickerValueText identity={value?.getTime()} animate={animateValue}
                parts={buttonParts} />
            </span>
            <ChevronDown aria-hidden="true" className={cn('size-3.5 text-muted-foreground transition-transform duration-[var(--zero-calendar-motion-spring)] ease-[var(--zero-calendar-ease-spring)] motion-reduce:transition-none', open && 'rotate-180')} />
          </>}
        </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent data-slot="date-picker-popover" className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-0"
        align="start" collisionPadding={12} ref={transition ? undefined : popupMotion.ref}
        initial={transition && !popupMotion.reduced ? { opacity: 0, y: -6, scale: 0.97 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }} exit={popupMotion.exit}
        transition={popupMotion.reduced ? { duration: 0 } : transition ?? popupMotion.transition}
        aria-label={`${inputProps?.['aria-label'] ?? 'Date'} calendar`}
        onEscapeKeyDown={event => {
          if (calendarView !== 'days') { event.preventDefault(); setCalendarView('days'); }
        }}>
        <div ref={setCalendarViewport} data-slot="date-picker-calendar-viewport"
          className={cn('min-h-0 flex-1 overscroll-contain', calendarView === 'years' ? 'overflow-hidden' : 'overflow-y-auto')}>
        <Calendar
          {...calendarProps}
          className={cn(calendarView === 'years' && 'h-full min-h-0', calendarProps?.className)}
          style={{ ...calendarProps?.style, ...(calendarView === 'years' && calendarViewportHeight > 0
            ? { height: calendarViewportHeight } : {}) }}
          classNames={{
            ...calendarProps?.classNames,
            months: cn('relative flex w-full max-w-full flex-col items-start gap-4 sm:flex-row',
              calendarView === 'years' && 'h-full min-h-0', calendarProps?.classNames?.months),
            month: cn('relative flex w-full max-w-full min-w-0 flex-col gap-3',
              calendarView === 'years' && 'h-full min-h-0', calendarProps?.classNames?.month),
            month_caption: cn('flex w-full min-w-0 shrink-0 items-center justify-between',
              calendarProps?.navLayout === 'around' && 'px-9', calendarProps?.classNames?.month_caption),
          }}
          mode="single"
          defaultMonth={calendarProps?.month ? undefined : value ?? calendarProps?.defaultMonth}
          selected={value}
          view={calendarView}
          onViewChange={setCalendarView}
          onSelect={(date) => {
            if (disabled || readOnly) return;
            setInputValue(formatDatePickerValue(date));
            setInputInvalid(false);
            onChange?.(date);
            onInputValueChange?.(formatDatePickerValue(date));
            requestOpen(false);
          }}
          autoFocus
        />
        </div>
        <div data-slot="date-picker-footer" className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
          {clearable ? <Button type="button" variant="ghost" size="sm" disabled={!value && !(controlledInput ?? inputValue)}
            onClick={() => { if (disabled || readOnly) return; commitInput(''); requestOpen(false); }}>Clear</Button> : <span />}
          <Button type="button" variant="ghost" size="sm" onClick={() => requestOpen(false)} aria-label="Close date picker">Close</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
export type { DatePickerCalendarProps };
