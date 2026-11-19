/** Browser-safe Gregorian labels. Dates are not instants and never inherit the host timezone. */
export interface CalendarLocalDate { readonly year: number; readonly month: number; readonly day: number }
const cumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;
export function calendarLeapYear(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
export function calendarMonthLength(year: number, month: number): number {
  return month === 2 ? calendarLeapYear(year) ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
}
export function calendarLocalDate(value: unknown): CalendarLocalDate | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8));
  return year >= 0 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= calendarMonthLength(year, month)
    ? { year, month, day } : null;
}
function daysBeforeYear(year: number): number {
  return 365 * year + Math.floor((year + 3) / 4) - Math.floor((year + 99) / 100) + Math.floor((year + 399) / 400);
}
export function calendarDateOrdinal(value: string): number {
  const date = calendarLocalDate(value); if (!date) throw new RangeError('Choose a valid Gregorian date.');
  return daysBeforeYear(date.year) + cumulative[date.month - 1]! + (date.month > 2 && calendarLeapYear(date.year) ? 1 : 0) + date.day - 1;
}
export function calendarDateFromOrdinal(ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= daysBeforeYear(10000)) throw new RangeError('The calendar date exceeds four-digit Gregorian bounds.');
  let low = 0, high = 10000;
  while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (daysBeforeYear(middle) <= ordinal) low = middle; else high = middle; }
  let rest = ordinal - daysBeforeYear(low), month = 1;
  while (rest >= calendarMonthLength(low, month)) { rest -= calendarMonthLength(low, month); month++; }
  return `${String(low).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(rest + 1).padStart(2, '0')}`;
}
export function calendarLocalDateKey({ year, month, day }: CalendarLocalDate): string {
  const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!calendarLocalDate(key)) throw new RangeError('Choose a Gregorian date between 0000 and 9999.');
  return key;
}
export function calendarAddDates(value: string, amount: number): string { return calendarDateFromOrdinal(calendarDateOrdinal(value) + amount); }
export function calendarCivilDays(value: string, view: 'day' | 'week' | 'month' | 'agenda'): readonly string[] {
  const date = calendarLocalDate(value); if (!date) throw new RangeError('Choose a valid Gregorian date.');
  if (view === 'day' || view === 'agenda') return [value];
  const first = view === 'month' ? calendarLocalDateKey({ ...date, day: 1 }) : value;
  const ordinal = calendarDateOrdinal(first), monday = ordinal - (ordinal + 5) % 7; // 0000-01-01 was Saturday.
  return Array.from({ length: view === 'month' ? 42 : 7 }, (_, index) => calendarDateFromOrdinal(monday + index));
}
export function calendarShiftCivilDate(value: string, view: 'day' | 'week' | 'month' | 'agenda', direction: number): string {
  if (!Number.isSafeInteger(direction)) throw new RangeError('Choose a valid calendar step.');
  if (view !== 'month') return calendarAddDates(value, direction * (view === 'week' ? 7 : 1));
  const date = calendarLocalDate(value); if (!date) throw new RangeError('Choose a valid Gregorian date.');
  const monthIndex = date.year * 12 + date.month - 1 + direction, year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
  return calendarLocalDateKey({ year, month, day: Math.min(date.day, calendarMonthLength(year, month)) });
}
/** UTC is a display adapter only; the returned Date is never scheduling authority. */
export function calendarCivilDisplayDate(value: string): Date {
  if (!calendarLocalDate(value)) throw new RangeError('Choose a valid Gregorian date.');
  return new Date(`${value}T12:00:00.000Z`);
}
export function calendarFormatCivilDate(value: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' }): string {
  const date = calendarLocalDate(value); if (!date) throw new RangeError('Choose a valid Gregorian date.');
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC', calendar: 'gregory' }).formatToParts(calendarCivilDisplayDate(value))
    .filter(part => part.type !== 'era').map(part => part.type === 'year' ? String(date.year).padStart(4, '0') : part.value).join('');
}
export function calendarCivilTitle(value: string, view: 'day' | 'week' | 'month' | 'agenda'): string {
  if (view === 'week') {
    const days = calendarCivilDays(value, view), formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', calendar: 'gregory' });
    if (days[0]!.startsWith('0000-') || days.at(-1)!.startsWith('0000-')) return `${calendarFormatCivilDate(days[0]!, { month: 'short', day: 'numeric', year: 'numeric' })} – ${calendarFormatCivilDate(days.at(-1)!, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    return formatter.formatRange(calendarCivilDisplayDate(days[0]!), calendarCivilDisplayDate(days.at(-1)!));
  }
  return calendarFormatCivilDate(value, view === 'month' ? { month: 'long', year: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
/** Human labels are inclusive; storage, input and DATE queries retain their exclusive end boundary. */
export function calendarFormatAllDayDates(startDate: string, endDate: string): string {
  const lastDate = calendarAddDates(endDate, -1);
  const options = { year: 'numeric', month: 'short', day: 'numeric' } as const;
  return startDate === lastDate ? calendarFormatCivilDate(startDate, options)
    : `${calendarFormatCivilDate(startDate, options)} through ${calendarFormatCivilDate(lastDate, options)}`;
}
/** ISO or explicit U.S. numeric input, without host-Date parsing or year-0..99 remapping. */
export function calendarParseCivilInput(value: string): string | null {
  const text = value.trim(); if (calendarLocalDate(text)) return text;
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text); if (!match) return null;
  const key = `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`; return calendarLocalDate(key) ? key : null;
}
