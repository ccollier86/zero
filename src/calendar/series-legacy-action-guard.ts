/** Private022 legacy-write fence. A recurring child is not an ordinary row;
 * object management permission is proved before revealing that distinction. */
import type { DatabaseWriteCommandContext, DatabaseReadQueryContext } from '../databases/database-realm';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { calendarActor } from './realm-model';
import { calendarKey, calendarRecord } from './validation';
import { CalendarError, calendarCommand } from './error';
import { CALENDAR_SERIES_CHILD_MANAGE_TARGET_QUERY, readCalendarSeriesChildManageTarget } from './series-child-reader';

export function assertCalendarLegacySeriesReviewAction(context: DatabaseReadQueryContext, input: unknown): void {
  const r = calendarRecord(input), actor = calendarActor(r.actor), id = calendarKey(r.id);
  if (context.database.query('SELECT id FROM calendar_appointments WHERE scope_id=? AND id=? LIMIT 1').get(actor.scopeId, id)) return;
  readCalendarSeriesChildManageTarget(context, { actor, id });
  throw new CalendarError('CALENDAR_SERIES_ACTION_REQUIRED');
}

export function guardCalendarLegacySeriesAction<T>(handler: (context: DatabaseWriteCommandContext, input: unknown) => T):
  (context: DatabaseWriteCommandContext, input: unknown) => T {
  return (context, input) => {
    calendarCommand(() => {
      const r = calendarRecord(input), actor = calendarActor(r.actor), id = calendarKey(r.id);
      const ordinary = context.db.get('calendar_appointments', id);
      if (ordinary?.scope_id === actor.scopeId) return;
      // Fixed registered query, with no caller-selectable right or leaked full
      // child facts. Missing/hidden/staged targets retain their native rejection.
      const target = calendarRecord(context.query(CALENDAR_SERIES_CHILD_MANAGE_TARGET_QUERY, cloneDatabaseSerializableValue({ actor, id })), ['kind', 'id', 'revision']);
      if (target.kind !== 'series-child' || target.id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
      throw new CalendarError('CALENDAR_SERIES_ACTION_REQUIRED');
    });
    return handler(context, input);
  };
}
