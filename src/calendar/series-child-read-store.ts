/** Fixed private022 review adapter. Default019 retains its original read
 * adapter and does not import/open022 tables. No caller selects an occupancy
 * strategy, SQL, table identifier or callback through authored input. */
import type { DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import { createCalendarReadContext, type CalendarReadContext } from './calendar-read-store';
import { readCalendarSelectedSeriesOccupancy } from './series-children-occupancy';
import { reviewCalendarAppointmentCreateWithStore, reviewCalendarAppointmentUpdateWithStore } from './override-review';
import type { CalendarSeriesOccupancyInput } from './series-occupancy';

export function createCalendarSelectedReadContext(context: DatabaseReadQueryContext): CalendarReadContext {
  const ordinary = createCalendarReadContext(context);
  return Object.freeze({ db: ordinary.db,
    seriesOccupancy: (input: CalendarSeriesOccupancyInput) => readCalendarSelectedSeriesOccupancy(context, input),
  });
}
export function reviewCalendarSelectedAppointmentCreate(context: DatabaseReadQueryContext, input: unknown) {
  return reviewCalendarAppointmentCreateWithStore(createCalendarSelectedReadContext(context), input);
}
export function reviewCalendarSelectedAppointmentUpdate(context: DatabaseReadQueryContext, input: unknown) {
  return reviewCalendarAppointmentUpdateWithStore(createCalendarSelectedReadContext(context), input);
}
