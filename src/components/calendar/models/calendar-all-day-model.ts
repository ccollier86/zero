/** Date-native projection, kept separate from minute-based ScheduleEvent geometry. */
import type { CalendarAppointmentView, CalendarDateRangeQuery } from '../../../calendar/contracts';
import { calendarAddDates, calendarDateOrdinal, calendarLocalDate } from './calendar-local-date';
export interface CalendarAllDayOccurrence {
  readonly id: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly resourceId: string;
  readonly date: string;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly timeZone: string;
  readonly status: string;
}
export function calendarWorkspaceDateQueries(days: readonly string[], resourceIds: readonly string[], maxRangeDays = 31): readonly CalendarDateRangeQuery[] {
  if (!days.length || !resourceIds.length) return [];
  if (days.length > 42 || resourceIds.length > 16 || !Number.isInteger(maxRangeDays) || maxRangeDays < 1 || maxRangeDays > 31
    || days.some((day, index) => !calendarLocalDate(day) || index > 0 && calendarDateOrdinal(day) !== calendarDateOrdinal(days[index - 1]!) + 1)) {
    throw new RangeError('Unsupported calendar date display range.');
  }
  const endDate = calendarAddDates(days.at(-1)!, 1), queries: CalendarDateRangeQuery[] = [];
  for (let index = 0; index < days.length; index += maxRangeDays) queries.push({ resourceIds: [...resourceIds], startDate: days[index]!,
    endDate: index + maxRangeDays < days.length ? days[index + maxRangeDays]! : endDate });
  return queries;
}
export function projectCalendarAllDayAppointments(records: readonly CalendarAppointmentView[], resourceIds: readonly string[], days: readonly string[]): {
  readonly occurrences: readonly CalendarAllDayOccurrence[]; readonly sourceByOccurrenceId: ReadonlyMap<string, CalendarAppointmentView>;
} {
  const occurrences: CalendarAllDayOccurrence[] = [], sourceByOccurrenceId = new Map<string, CalendarAppointmentView>();
  for (const source of records) {
    const interval = source.interval; if (!interval) continue;
    for (const day of days) {
      if (day < interval.startDate || day >= interval.endDate) continue;
      for (const resourceId of source.resourceIds.filter(id => resourceIds.includes(id))) {
        const id = JSON.stringify(['all-day', source.id, resourceId, day]); sourceByOccurrenceId.set(id, source);
        occurrences.push({ id, sourceId: source.id, revision: source.revision, resourceId, date: day, title: source.title,
          startDate: interval.startDate, endDate: interval.endDate, timeZone: interval.timeZone, status: source.lifecycle?.status ?? source.status });
      }
    }
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.startDate.localeCompare(b.startDate) || a.sourceId.localeCompare(b.sourceId) || a.resourceId.localeCompare(b.resourceId));
  return { occurrences, sourceByOccurrenceId };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}
/** Two native watch families may overlap; a logical revision is rendered once, including kind conversions. */
export function mergeCalendarAppointmentPages(pages: readonly (readonly CalendarAppointmentView[])[]): { readonly records: readonly CalendarAppointmentView[]; readonly inconsistent: boolean } {
  const byId = new Map<string, CalendarAppointmentView>();
  for (const page of pages) for (const record of page) {
    const prior = byId.get(record.id);
    if (!prior || record.revision > prior.revision) byId.set(record.id, record);
    else if (record.revision === prior.revision && canonical(record) !== canonical(prior)) return { records: [], inconsistent: true };
  }
  return { records: [...byId.values()], inconsistent: false };
}
