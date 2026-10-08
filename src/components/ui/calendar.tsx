/** Tokenized DayPicker facade; shared drill-down presentation never replaces date selection policy. */
'use client';

import * as React from 'react';
import { DayPicker, Nav, type DayPickerProps } from 'react-day-picker';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon } from 'lucide-react';

import { cn } from '#zero/lib/utils';
import { buttonVariants } from '#zero/components/ui/button';
import { CalendarEmptyNav, CalendarMonth, CalendarMonthCaption, CalendarMonthGrid, CalendarNavigationButton } from './calendar-month-presentation';
import { CalendarPresentationContext, type CalendarView } from './calendar-view-context';

type CalendarProps = DayPickerProps & {
  className?: string;
  /** Show a Today navigation action. Does not select a date or commit a form. */
  showToday?: boolean;
  /** Default month/year headings drill down into focused picker grids. */
  enableViewPicker?: boolean;
  /** Presentation window for the year list; navigation bounds take precedence. */
  yearRange?: readonly [number, number];
  /** Optional controlled drill-down view, useful for layered-popover dismissal. */
  view?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
};

/** Render an accessible calendar supporting all existing DayPicker modes and extension points. */
function Calendar({ className, classNames, showOutsideDays = true, showToday = true,
  enableViewPicker = true, yearRange, view, onViewChange, components, fixedWeeks = true, ...props }: CalendarProps) {
  return (
    <CalendarPresentationContext.Provider value={{ showToday, enableViewPicker: enableViewPicker && !components?.Month && !components?.MonthGrid
      && !components?.CaptionLabel && !components?.MonthCaption,
      yearRange, view, onViewChange }}>
    <DayPicker
      {...props}
      showOutsideDays={showOutsideDays}
      fixedWeeks={fixedWeeks}
      className={cn('relative min-w-0 max-w-full p-3', className)}
      data-slot="calendar"
      classNames={{
        months: 'relative flex max-w-full flex-col items-start gap-4 sm:flex-row',
        month: 'relative flex w-72 max-w-full min-w-0 flex-col gap-3',
        month_caption: cn('flex w-full min-w-0 items-center justify-between', props.navLayout === 'around' && 'px-9'),
        caption_label: 'text-sm font-medium',
        dropdowns: 'flex h-8 items-center justify-center gap-1',
        dropdown_root:
          'relative inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-sm font-medium shadow-xs transition-colors hover:border-border-strong focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-bg-inset/45',
        dropdown:
          'absolute inset-0 z-10 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed',
        nav: 'flex items-center gap-1',
        button_previous: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-8 bg-transparent p-0 opacity-70 hover:opacity-100',
          props.navLayout === 'around' && 'absolute start-0 top-0',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-8 bg-transparent p-0 opacity-70 hover:opacity-100',
          props.navLayout === 'around' && 'absolute end-0 top-0',
        ),
        month_grid: 'w-full table-fixed border-collapse',
        weekdays: 'flex w-full',
        weekday:
          'flex-1 text-muted-foreground rounded-md w-8 font-normal text-xs',
        week: 'flex w-full mt-2',
        day: cn(
          'group/day relative flex-1 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50',
          props.mode === 'range'
            ? '[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md'
            : '[&:has([aria-selected])]:rounded-md',
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-8 w-full min-w-8 p-0 font-normal aria-selected:opacity-100 duration-(--zero-calendar-motion-fast) ease-(--zero-calendar-ease-standard) motion-reduce:transition-none',
          'group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:text-primary-foreground group-data-[selected=true]/day:hover:bg-primary group-data-[selected=true]/day:hover:text-primary-foreground',
        ),
        range_start: 'day-range-start rounded-l-md',
        range_end: 'day-range-end rounded-r-md',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'bg-primary/15 text-primary font-medium',
        outside:
          'day-outside text-muted-foreground aria-selected:text-muted-foreground opacity-60 aria-selected:opacity-40',
        disabled: 'text-muted-foreground opacity-60',
        range_middle:
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Month: CalendarMonth,
        MonthCaption: CalendarMonthCaption,
        MonthGrid: CalendarMonthGrid,
        Nav: components?.Month || components?.MonthCaption || props.navLayout === 'after' ? Nav : CalendarEmptyNav,
        NextMonthButton: CalendarNavigationButton,
        PreviousMonthButton: CalendarNavigationButton,
        Chevron: ({ orientation }) => {
          const Icon = orientation === 'left' ? ChevronLeftIcon
            : orientation === 'right' ? ChevronRightIcon
              : orientation === 'up' ? ChevronUpIcon : ChevronDownIcon;
          return <Icon className="size-4" />;
        },
        ...components,
      }}
    />
    </CalendarPresentationContext.Provider>
  );
}

export { Calendar, type CalendarProps, type CalendarView };
