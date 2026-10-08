/** Default DayPicker presentation: header navigation and focused day/month/year surfaces only. */
'use client';
import * as React from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDownIcon } from 'lucide-react';
import { MonthCaption, MonthGrid, useDayPicker, type MonthProps, type MonthCaptionProps, type MonthGridProps, type PreviousMonthButtonProps } from 'react-day-picker';
import { Button, buttonVariants } from './button';
import { cn } from '#zero/lib/utils';
import { CalendarMonthViewContext, CalendarPresentationContext, useCalendarMonthView, type CalendarView } from './calendar-view-context';
import { calendarDateLib, calendarMonthAllowed, calendarNavigationBounds, calendarYearMonth, calendarYearRange } from './calendar-view-model';
import { useCalendarViewMotion } from './calendar-view-motion';
import { PickerValueText } from './picker-value-text';

const controlMotion: React.CSSProperties = {
  transitionDuration: 'var(--zero-calendar-motion-fast)',
  transitionTimingFunction: 'var(--zero-calendar-ease-standard)',
};

/** Keep each displayed month independently inspectable without replacing DayPicker selection state. */
export function CalendarMonth({ calendarMonth, displayIndex, children, ...props }: MonthProps) {
  const options = React.useContext(CalendarPresentationContext);
  const [internalView, setInternalView] = React.useState<CalendarView>('days');
  const view = options.view ?? internalView;
  const requestDayFocus = React.useRef(false);
  const setView = React.useCallback((next: CalendarView) => {
    if (next === 'days') requestDayFocus.current = true;
    if (options.view === undefined) setInternalView(next);
    options.onViewChange?.(next);
  }, [options.view, options.onViewChange]);
  return <CalendarMonthViewContext.Provider value={{ calendarMonth, displayIndex, view, setView, requestDayFocus }}>
    <div {...props} data-calendar-view={view} onKeyDownCapture={event => {
      props.onKeyDownCapture?.(event);
      if (!event.defaultPrevented && event.key === 'Escape' && view !== 'days') {
        event.preventDefault(); event.stopPropagation(); setView('days');
      }
    }}>{children}</div>
  </CalendarMonthViewContext.Provider>;
}

/** Render anchored, accessible month/year drill-down controls and DayPicker-bound navigation. */
export function CalendarMonthCaption(props: MonthCaptionProps) {
  const scope = useCalendarMonthView(), options = React.useContext(CalendarPresentationContext);
  const picker = useDayPicker(), lib = calendarDateLib(picker.dayPickerProps);
  if (!scope) return <MonthCaption {...props} />;
  const { calendarMonth, displayIndex, className, children, ...attributes } = props;
  const month = calendarMonth.date, year = lib.getYear(month);
  const nativeCaption = picker.dayPickerProps.captionLayout?.startsWith('dropdown') || !options.enableViewPicker;
  const disabled = Boolean(picker.dayPickerProps.disableNavigation);
  const { from, to } = calendarNavigationBounds(picker.dayPickerProps, lib);
  const yearAllowed = (candidate: number) => !disabled && (!from || candidate >= lib.getYear(from)) && (!to || candidate <= lib.getYear(to));
  const previous = scope.view === 'months' ? calendarYearMonth(year - 1, month, picker.dayPickerProps, lib) : picker.previousMonth;
  const next = scope.view === 'months' ? calendarYearMonth(year + 1, month, picker.dayPickerProps, lib) : picker.nextMonth;
  const previousEnabled = scope.view === 'months' ? yearAllowed(year - 1) : Boolean(previous);
  const nextEnabled = scope.view === 'months' ? yearAllowed(year + 1) : Boolean(next);
  const today = picker.dayPickerProps.today ?? lib.today();
  const goToday = () => {
    if (!calendarMonthAllowed(today, picker.dayPickerProps, lib)) return;
    scope.setView('days'); picker.goToMonth(today);
  };
  const monthControl = <Button type="button" size="sm" variant="ghost" animateIcon={false}
    data-slot="calendar-month-heading" disabled={disabled} aria-label={`${lib.format(month, 'LLLL')}, choose month`}
    aria-expanded={scope.view === 'months'} onClick={() => scope.setView(scope.view === 'months' ? 'days' : 'months')}
    className="h-8 min-w-0 gap-1 px-2 font-medium" style={controlMotion}>
    <span className="truncate"><PickerValueText parts={[{ type: 'month', value: lib.format(month, 'LLLL') }]}
      identity={year * 12 + lib.getMonth(month)} /></span>
    <ChevronDownIcon className={cn('size-3 text-muted-foreground transition-transform', scope.view === 'months' && 'rotate-180')}
      style={{ transitionDuration: 'var(--zero-calendar-motion-spring)', transitionTimingFunction: 'var(--zero-calendar-ease-spring)' }} aria-hidden="true" />
  </Button>;
  const yearControl = <Button type="button" size="sm" variant="ghost" animateIcon={false}
    data-slot="calendar-year-heading" disabled={disabled} aria-label={`${lib.formatNumber(year)}, choose year`}
    aria-expanded={scope.view === 'years'} onClick={() => scope.setView(scope.view === 'years' ? 'days' : 'years')}
    className="h-8 gap-1 px-2 font-medium tabular-nums" style={controlMotion}>
    <PickerValueText parts={[{ type: 'year', value: lib.formatNumber(year) }]} identity={year} />
    <ChevronDownIcon className={cn('size-3 text-muted-foreground transition-transform', scope.view === 'years' && 'rotate-180')}
      style={{ transitionDuration: 'var(--zero-calendar-motion-spring)', transitionTimingFunction: 'var(--zero-calendar-ease-spring)' }} aria-hidden="true" />
  </Button>;
  // Explicit custom Nav/navLayout retains DayPicker's original extension-point semantics.
  const customNav = Boolean(picker.dayPickerProps.components?.Nav && picker.dayPickerProps.components.Nav !== CalendarEmptyNav)
    || Boolean(picker.dayPickerProps.navLayout);
  return <div {...attributes} className={cn('flex min-w-0 flex-wrap items-center justify-between gap-1', className)}>
    <div className="flex min-w-0 items-center" data-slot="calendar-heading">
      {nativeCaption ? children : lib.getMonthYearOrder() === 'year-first' ? <>{yearControl}{monthControl}</> : <>{monthControl}{yearControl}</>}
    </div>
    <div className="flex shrink-0 items-center gap-0.5" data-slot="calendar-navigation">
      {options.showToday && displayIndex === 0 && <Button type="button" size="sm" variant="ghost"
        animateIcon={false} className="h-8 px-2 text-xs text-muted-foreground" disabled={!calendarMonthAllowed(today, picker.dayPickerProps, lib)}
        aria-label={`Today, ${lib.format(today, 'PPPP')}`} style={controlMotion} onClick={goToday}>Today</Button>}
      {!picker.dayPickerProps.hideNavigation && !customNav && <span className={cn('inline-flex items-center gap-0.5', scope.view === 'years' && 'invisible pointer-events-none')}
        aria-hidden={scope.view === 'years' || undefined} inert={scope.view === 'years'}>
        <picker.components.PreviousMonthButton type="button" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), picker.classNames.button_previous)} disabled={!previousEnabled}
          aria-label={scope.view === 'months' ? 'Previous year' : picker.labels.labelPrevious(previous)}
          onClick={() => {
            if (previous && previousEnabled) { picker.goToMonth(previous); picker.dayPickerProps.onPrevClick?.(previous); }
          }}><picker.components.Chevron orientation={picker.dayPickerProps.dir === 'rtl' ? 'right' : 'left'} className="size-4" /></picker.components.PreviousMonthButton>
        <picker.components.NextMonthButton type="button" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), picker.classNames.button_next)} disabled={!nextEnabled}
          aria-label={scope.view === 'months' ? 'Next year' : picker.labels.labelNext(next)}
          onClick={() => {
            if (next && nextEnabled) { picker.goToMonth(next); picker.dayPickerProps.onNextClick?.(next); }
          }}><picker.components.Chevron orientation={picker.dayPickerProps.dir === 'rtl' ? 'left' : 'right'} className="size-4" /></picker.components.NextMonthButton>
      </span>}
    </div>
    {!nativeCaption && <span className="sr-only" role="status" aria-live="polite">{picker.formatters.formatCaption(month, lib.options, lib)}</span>}
  </div>;
}

/** The default navigation is rendered inside the caption; custom Nav components remain caller-owned. */
export function CalendarEmptyNav() { return <></>; }

/** Shared button primitive is the default; caller DayPicker button components remain replaceable. */
export function CalendarNavigationButton(props: PreviousMonthButtonProps) {
  return <Button {...props} style={{ ...controlMotion, ...props.style }} variant="ghost" size="icon-sm" animateIcon={false} />;
}

function PickerGrid() {
  const scope = useCalendarMonthView()!, options = React.useContext(CalendarPresentationContext);
  const picker = useDayPicker(), lib = calendarDateLib(picker.dayPickerProps);
  const date = scope.calendarMonth.date, year = lib.getYear(date), month = lib.getMonth(date);
  const years = scope.view === 'years', [from, to] = calendarYearRange(date, picker.dayPickerProps, lib, options.yearRange);
  const count = years ? to - from + 1 : 12;
  const selected = years ? year : month;
  const [focus, setFocus] = React.useState(years ? Math.max(from, Math.min(to, selected)) : selected);
  const root = React.useRef<HTMLDivElement>(null);
  const virtual = years && count > 60;
  const rows = useVirtualizer({ count: Math.ceil(count / 3), getScrollElement: () => root.current,
    estimateSize: () => 46, overscan: 3, enabled: virtual, useFlushSync: false, initialRect: { width: 288, height: 256 },
    rangeExtractor(range) {
      const indices = new Set(defaultRangeExtractor(range));
      indices.add(Math.max(0, Math.min(Math.ceil(count / 3) - 1, Math.floor((focus - from) / 3))));
      return [...indices].sort((a, b) => a - b);
    } });
  const visibleRows = rows.getVirtualItems();
  const allowed = (value: number) => years
    ? value >= from && value <= to && !picker.dayPickerProps.disableNavigation
    : calendarMonthAllowed(lib.newDate(year, value, 1), picker.dayPickerProps, lib);
  React.useLayoutEffect(() => {
    if (virtual) rows.scrollToIndex(Math.floor((focus - from) / 3), { align: 'center' });
  }, [focus, from, virtual]);
  React.useLayoutEffect(() => {
    const cell = root.current?.querySelector<HTMLButtonElement>(`[data-choice="${focus}"]`);
    if (cell && !cell.disabled) {
      cell.focus({ preventScroll: true });
      if (years && !virtual && root.current) root.current.scrollTop = cell.offsetTop - (root.current.clientHeight - cell.offsetHeight) / 2;
    }
  }, [focus, years, virtual, visibleRows[0]?.index, visibleRows.at(-1)?.index]);
  const pick = (value: number) => {
    if (!allowed(value)) return;
    const candidate = years ? calendarYearMonth(value, date, picker.dayPickerProps, lib) : lib.newDate(year, value, 1);
    picker.goToMonth(candidate); scope.setView('days');
  };
  const move = (event: React.KeyboardEvent, value: number) => {
    const rtl = picker.dayPickerProps.dir === 'rtl';
    const offsets: Record<string, number> = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -3, ArrowDown: 3,
      PageUp: years ? -12 : 0, PageDown: years ? 12 : 0 };
    let target = event.key === 'Home' ? (years ? from : 0) : event.key === 'End' ? (years ? to : 11) : offsets[event.key] !== undefined ? value + offsets[event.key]! : undefined;
    if (target === undefined) return;
    event.preventDefault();
    if (!years && (event.key === 'PageUp' || event.key === 'PageDown')) {
      const next = calendarYearMonth(year + (event.key === 'PageUp' ? -1 : 1), date, picker.dayPickerProps, lib);
      if (lib.getYear(next) !== year && calendarMonthAllowed(next, picker.dayPickerProps, lib)) picker.goToMonth(next);
      return;
    }
    target = Math.max(years ? from : 0, Math.min(years ? to : 11, target));
    const direction = target >= value ? 1 : -1;
    while (!allowed(target) && target >= (years ? from : 0) && target <= (years ? to : 11)) target += direction;
    if (allowed(target)) setFocus(target);
  };
  const today = picker.dayPickerProps.today ?? lib.today();
  const renderChoice = (value: number) => {
      const selectedCell = value === selected;
      const current = years ? value === lib.getYear(today) : year === lib.getYear(today) && value === lib.getMonth(today);
      return <div key={value} role="gridcell" aria-selected={selectedCell} className="min-w-0">
        <button type="button" data-choice={value} disabled={!allowed(value)} tabIndex={value === focus ? 0 : -1}
          aria-label={years ? lib.formatNumber(value) : `${lib.format(lib.newDate(year, value, 1), 'LLLL')} ${lib.formatNumber(year)}`}
          className={cn(buttonVariants({ variant: 'ghost' }), 'h-full min-h-9 w-full px-1 text-sm font-normal tabular-nums',
            selectedCell && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground', current && 'font-medium')}
          style={controlMotion} onFocus={() => setFocus(value)} onKeyDown={event => move(event, value)} onClick={() => pick(value)}>
          {years ? lib.formatNumber(value) : lib.format(lib.newDate(year, value, 1), 'LLL')}
        </button>
      </div>;
  };
  const renderRow = (row: number) => Array.from({ length: Math.min(3, count - row * 3) }, (_, column) =>
    renderChoice((years ? from : 0) + row * 3 + column));
  return <div ref={root} data-slot={years ? 'calendar-year-grid' : 'calendar-month-grid'}
    className={cn('relative h-full min-h-0', years ? 'overflow-y-auto overscroll-contain px-1 py-2' : 'py-1',
      !virtual && 'grid grid-cols-3 gap-1.5', !years && 'grid-rows-4', years && !virtual && 'auto-rows-10')}
    role="grid" aria-rowcount={Math.ceil(count / 3)} aria-label={years ? 'Years' : `Months in ${lib.formatNumber(year)}`}>
    {virtual ? <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
      {visibleRows.map(row => <div key={row.key} role="row" aria-rowindex={row.index + 1}
        className="absolute left-0 top-0 grid h-10 w-full grid-cols-3 gap-1.5" style={{ transform: `translateY(${row.start}px)` }}>
        {renderRow(row.index)}
      </div>)}
    </div> : Array.from({ length: Math.ceil(count / 3) }, (_, row) => <div key={row} className="contents" role="row" aria-rowindex={row + 1}>
      {renderRow(row)}
    </div>)}
  </div>;
}

/** Swap presentation bodies while all day behavior stays owned by the real DayPicker MonthGrid. */
export function CalendarMonthGrid(props: MonthGridProps) {
  const scope = useCalendarMonthView();
  if (!scope) return <MonthGrid {...props} />;
  return <CalendarMonthBody scope={scope} props={props} />;
}
function CalendarMonthBody({ scope, props }: { scope: NonNullable<ReturnType<typeof useCalendarMonthView>>; props: MonthGridProps }) {
  const picker = useDayPicker(), lib = calendarDateLib(picker.dayPickerProps), date = scope.calendarMonth.date;
  const index = lib.getYear(date) * 12 + lib.getMonth(date), key = `${scope.view}:${index}`;
  const { contentRef, overlayRef } = useCalendarViewMotion(key, scope.view, index);
  const height = React.useRef<number | undefined>(undefined);
  const stage = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (scope.view === 'days' && contentRef.current) height.current = contentRef.current.getBoundingClientRect().height;
    if (scope.view !== 'days' && height.current && stage.current) stage.current.style.height = `${height.current}px`;
    else stage.current?.style.removeProperty('height');
    if (scope.view !== 'days' || !scope.requestDayFocus.current) return;
    scope.requestDayFocus.current = false;
    const frame = requestAnimationFrame(() => {
      const selected = contentRef.current?.querySelector<HTMLButtonElement>('[data-selected] button:not(:disabled)');
      const tabbable = contentRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]:not(:disabled)');
      (selected ?? tabbable ?? contentRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [scope.view, key, contentRef]);
  return <div ref={stage} data-slot="calendar-stage" data-calendar-view={scope.view}
    className={cn('relative min-h-0 min-w-0 overflow-hidden', scope.view !== 'days' && 'h-64')}>
    <div ref={contentRef} className={scope.view === 'days' ? 'min-w-0' : 'h-full min-h-0 min-w-0'}>
      {scope.view === 'days' ? <MonthGrid {...props} /> : <PickerGrid key={scope.view} />}
    </div>
    <div ref={overlayRef} className="pointer-events-none absolute inset-0" aria-hidden="true" inert />
  </div>;
}
