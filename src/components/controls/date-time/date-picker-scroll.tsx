'use client';

/**
 * Additive DatePicker presentation facade. The original picker owns values,
 * drafts, calendar views, focus and morph presence; this wrapper decorates its
 * exact days/months viewport through DayPicker's stable Root/ref extension.
 */
import * as React from 'react';
import { Root, type RootProps } from 'react-day-picker';
import { DatePicker as NativeDatePicker, type DatePickerProps as NativeDatePickerProps,
  type DatePickerCalendarProps } from './date-picker';
import { CalendarPresentationContext } from './calendar-view-context';
import { composeOverlayRefs } from '../../_internal/overlay-scope/overlay-scope';
import { ScrollViewportAttachment } from '../../_internal/scroll-viewport/scroll-viewport-attachment';

export type { DatePickerCalendarProps } from './date-picker';

/** The original input/calendar contract, with a reversible scroll-presentation choice. */
export interface DatePickerProps extends NativeDatePickerProps {
  /** Arc edge fades/overlay rails by default; native keeps the unchanged original picker recipe. */
  scrollTreatment?: 'arc' | 'native';
}

const ScrollRootContext = React.createContext<NonNullable<DatePickerCalendarProps['components']>['Root'] | undefined>(undefined);

/** Forward the actual calendar Root/ref; an opaque custom Root that omits rootRef retains its own ownership. */
function DatePickerScrollRoot({ rootRef, ...props }: RootProps) {
  const ConsumerRoot = React.useContext(ScrollRootContext) ?? Root;
  const presentation = React.useContext(CalendarPresentationContext);
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  const ref = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(rootRef, setElement), [rootRef]);
  const viewport = element?.closest<HTMLDivElement>('[data-slot="date-picker-calendar-viewport"]') ?? null;
  return <><ConsumerRoot {...props} rootRef={ref} />
    <ScrollViewportAttachment viewport={viewport} enabled={presentation.view !== 'years'} orientation="both" />
  </>;
}

/** Preserve one original picker engine; the native branch forwards its props without another host or calendar. */
export function DatePicker({ scrollTreatment = 'arc', calendarProps, ...props }: DatePickerProps) {
  return <ScrollRootContext.Provider value={calendarProps?.components?.Root}>
    <NativeDatePicker {...props} calendarProps={scrollTreatment === 'native' ? calendarProps : { ...calendarProps,
      components: { ...calendarProps?.components, Root: DatePickerScrollRoot } }} />
  </ScrollRootContext.Provider>;
}
