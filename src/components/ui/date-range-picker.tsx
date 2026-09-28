'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import type { Transition } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#zero/components/animate-ui/components/radix/popover';
import { Calendar } from '#zero/components/ui/calendar';

export interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  transition?: Transition;
}

function DateRangePicker({
  value,
  onChange,
  placeholder = 'Pick a date range',
  disabled = false,
  className,
  transition,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const displayText = React.useMemo(() => {
    if (!value?.from) return null;
    if (!value.to) return format(value.from, 'LLL dd, y');
    return `${format(value.from, 'LLL dd, y')} – ${format(value.to, 'LLL dd, y')}`;
  }, [value?.from?.getTime(), value?.to?.getTime()]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-slot="date-range-picker-trigger"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value?.from && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="size-4 opacity-50" />
          {displayText ?? <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" transition={transition}>
        <Calendar
          mode="range"
          defaultMonth={value?.from}
          selected={value}
          onSelect={(range) => {
            onChange?.(range);
            if (range?.from && range?.to) setOpen(false);
          }}
          numberOfMonths={2}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export { DateRangePicker };
