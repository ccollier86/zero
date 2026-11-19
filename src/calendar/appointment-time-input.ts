/** Private authored intent only. No timezone/catalog resolution and no booking authority.
 * New explicit branches never change the historical flat timed digest families.
 */
import type { CalendarAllDayIntervalInput } from './all-day-time';
import { CalendarError } from './error';
import { normalizeCalendarInstant } from './time';
import { calendarInteger, calendarRecord, calendarText } from './validation';
import { calendarWorkingHoursDateOrdinal } from './working-hours-model';

export interface CalendarExplicitTimedIntervalInput {
  readonly kind: 'timed-v1';
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}
export type CalendarAppointmentTimeIntent = CalendarAllDayIntervalInput | CalendarExplicitTimedIntervalInput;

export function normalizeCalendarAppointmentTimeIntent(input: unknown): CalendarAppointmentTimeIntent {
  const record = calendarRecord(input);
  // Deliberately retain the authored token. Intl alias resolution belongs after
  // original-receipt lookup and cannot change an accepted intent's identity.
  const timeZone = calendarText(record.timeZone, 128);
  if (timeZone.trim() !== timeZone || /^[+-]/.test(timeZone)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  if (record.kind === 'all-day-local-v1') {
    calendarRecord(record, ['kind', 'startDate', 'endDate', 'timeZone']);
    calendarInteger(calendarWorkingHoursDateOrdinal(record.endDate) - calendarWorkingHoursDateOrdinal(record.startDate), 1, 31);
    return Object.freeze({ kind: 'all-day-local-v1', startDate: record.startDate as string, endDate: record.endDate as string, timeZone });
  }
  if (record.kind !== 'timed-v1') throw new CalendarError('CALENDAR_INPUT_INVALID');
  calendarRecord(record, ['kind', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes']);
  const startAt = normalizeCalendarInstant(record.startAt), endAt = normalizeCalendarInstant(record.endAt);
  calendarInteger(Date.parse(endAt) - Date.parse(startAt), 1, 31 * 86_400_000);
  return Object.freeze({ kind: 'timed-v1', startAt, endAt, timeZone,
    bufferBeforeMinutes: calendarInteger(record.bufferBeforeMinutes, 0, 1440),
    bufferAfterMinutes: calendarInteger(record.bufferAfterMinutes, 0, 1440) });
}
