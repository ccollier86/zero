/** Calendar presentation bounds and focus math; DayPicker remains the selection/policy engine. */
import { DateLib, defaultLocale, type DayPickerProps } from 'react-day-picker';

/** Return the same date library configuration used by DayPicker's public props. */
export function calendarDateLib(props: DayPickerProps) {
  return new DateLib({ locale: { ...defaultLocale, ...props.locale }, timeZone: props.timeZone, numerals: props.numerals,
    weekStartsOn: props.weekStartsOn, firstWeekContainsDate: props.firstWeekContainsDate }, props.dateLib);
}

/** Match explicit/deprecated DayPicker navigation bounds without broadening selectable dates. */
export function calendarNavigationBounds(props: DayPickerProps, lib: DateLib) {
  const from = props.startMonth ?? props.fromMonth ?? (props.fromYear !== undefined ? lib.newDate(props.fromYear, 0, 1) : undefined);
  const to = props.endMonth ?? props.toMonth ?? (props.toYear !== undefined ? lib.newDate(props.toYear, 11, 1) : undefined);
  return { from: from ? lib.startOfMonth(from) : undefined, to: to ? lib.startOfMonth(to) : undefined };
}

/** Test month navigation only; disabled and hidden day matchers still belong to DayPicker. */
export function calendarMonthAllowed(date: Date, props: DayPickerProps, lib: DateLib) {
  const { from, to } = calendarNavigationBounds(props, lib);
  const month = lib.startOfMonth(date);
  return !props.disableNavigation && (!from || month >= from) && (!to || month <= to);
}

/** Clamp a year pick to a valid month, preserving the visible month wherever possible. */
export function calendarYearMonth(year: number, current: Date, props: DayPickerProps, lib: DateLib) {
  const { from, to } = calendarNavigationBounds(props, lib);
  const candidate = lib.newDate(year, lib.getMonth(current), 1);
  return from && candidate < from ? from : to && candidate > to ? to : candidate;
}

/** Build the finite year-picker window, using explicit limits before the default century lookback. */
export function calendarYearRange(current: Date, props: DayPickerProps, lib: DateLib, range?: readonly [number, number]) {
  const { from, to } = calendarNavigationBounds(props, lib);
  const currentYear = lib.getYear(current), todayYear = lib.getYear(props.today ?? lib.today());
  const lower = from ? lib.getYear(from) : range?.[0] ?? Math.min(todayYear - 100, currentYear);
  const upper = to ? lib.getYear(to) : range?.[1] ?? Math.max(todayYear + 30, currentYear);
  // Date's supported years are finite. Ignore malformed presentation props rather than creating an unbounded list.
  const start = Number.isInteger(lower) ? Math.max(-271820, lower) : todayYear - 100;
  const end = Number.isInteger(upper) ? Math.min(275759, upper) : todayYear + 30;
  return start <= end ? [start, end] as const : [currentYear, currentYear] as const;
}
