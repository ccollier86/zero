/** Per-month presentation state shared by DayPicker's header and body custom components. */
import * as React from 'react';
import type { CalendarMonth } from 'react-day-picker';

/** Calendar presentation layer; selections are not changed by switching these views. */
export type CalendarView = 'days' | 'months' | 'years';

export interface CalendarPresentationOptions {
  showToday: boolean;
  enableViewPicker: boolean;
  yearRange?: readonly [number, number];
  view?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
}
interface CalendarMonthView {
  calendarMonth: CalendarMonth;
  displayIndex: number;
  view: CalendarView;
  setView(view: CalendarView): void;
  requestDayFocus: React.MutableRefObject<boolean>;
}
export const CalendarPresentationContext = React.createContext<CalendarPresentationOptions>({ showToday: true, enableViewPicker: true });
export const CalendarMonthViewContext = React.createContext<CalendarMonthView | null>(null);

/** Read an optional presentation context; absent means a caller replaced the default Month wrapper. */
export function useCalendarMonthView() { return React.useContext(CalendarMonthViewContext); }
