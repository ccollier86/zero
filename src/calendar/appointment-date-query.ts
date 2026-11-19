/** Engine-free LocalDate range selection. UTC occupancy is not date authority. */
import { calendarInteger } from './validation';
import { calendarWorkingHoursDateOrdinal } from './working-hours-model';

export const CALENDAR_APPOINTMENT_DATE_RANGE_DAYS = 31;
const DAY_MS = 86_400_000;
const MIN_DATE = calendarWorkingHoursDateOrdinal('0000-01-01');

export function calendarAppointmentDateWindow(startDate: unknown, endDate: unknown): Readonly<{
  startDate: string; endDate: string; lookbackStartDate: string;
}> {
  const start = calendarWorkingHoursDateOrdinal(startDate), end = calendarWorkingHoursDateOrdinal(endDate);
  calendarInteger(end - start, 1, CALENDAR_APPOINTMENT_DATE_RANGE_DAYS);
  // Every admitted all-day interval spans at most31 nominal days. Clip only the
  // search envelope at the Gregorian domain edge, never the authored interval.
  const lower = Math.max(MIN_DATE, start - CALENDAR_APPOINTMENT_DATE_RANGE_DAYS);
  return Object.freeze({ startDate: startDate as string, endDate: endDate as string,
    lookbackStartDate: new Date(lower * DAY_MS).toISOString().slice(0, 10) });
}
