/** Current membership is a derived bounded projection, never all retained reservation rows. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarJson, calendarKey } from './validation';

export const CALENDAR_APPOINTMENT_RESOURCE_CURRENT = '_calendar_appointment_resource_current';
export const CALENDAR_APPOINTMENT_UPDATE_HISTORY = '_calendar_appointment_update_history';
export const CALENDAR_APPOINTMENT_RESOURCE_STATE = '_calendar_appointment_resource_state';
const tables = [CALENDAR_APPOINTMENT_RESOURCE_CURRENT, CALENDAR_APPOINTMENT_UPDATE_HISTORY, CALENDAR_APPOINTMENT_RESOURCE_STATE];

/** Exact pre-016 compatibility only. A partially installed/corrupt 016 never falls back to retained old resources. */
export function calendarCurrentResourceMembership(context: DatabaseWriteCommandContext): boolean {
  const present = tables.map(table => context.db.hasTable(table));
  if (present.every(value => !value)) return false;
  if (!present.every(Boolean) || context.db.get(CALENDAR_APPOINTMENT_RESOURCE_STATE, 'application')?.version !== 16) throw new CalendarError('CALENDAR_STATE_INVALID');
  return true;
}
export function readCalendarResourceMembershipTable(context: DatabaseReadQueryContext): typeof CALENDAR_APPOINTMENT_RESOURCE_CURRENT | '_calendar_reservations' {
  const present = context.database.query<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table' AND name IN (?,?,?) LIMIT 4").all(...tables);
  if (!present.length) {
    // A warm 016 file whose projection/state tables vanished is not an old file.
    // Read the existing durable ledger only: never construct/import/repair it.
    const ledger = context.database.query<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table' AND name='_zero_migrations' LIMIT 1").get();
    if (ledger) {
      try {
        const latest = context.database.query<{ status: string }>("SELECT status FROM _zero_migrations WHERE version='016' AND status IN ('applied','rolled_back') ORDER BY id DESC LIMIT 1").get();
        if (latest?.status === 'applied') throw new CalendarError('CALENDAR_STATE_INVALID');
      } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
    }
    return '_calendar_reservations';
  }
  if (present.length !== 3 || context.database.query<{ version: number }>(`SELECT version FROM ${CALENDAR_APPOINTMENT_RESOURCE_STATE} WHERE id='application'`).get()?.version !== 16) throw new CalendarError('CALENDAR_STATE_INVALID');
  return CALENDAR_APPOINTMENT_RESOURCE_CURRENT;
}
export function replaceCalendarAppointmentResourceCurrent(context: DatabaseWriteCommandContext, scopeId: string, appointmentId: string,
  revision: number, resourceIds: readonly string[]): void {
  if (!calendarCurrentResourceMembership(context)) return;
  if (!resourceIds.length || resourceIds.length > 16 || new Set(resourceIds).size !== resourceIds.length) throw new CalendarError('CALENDAR_STATE_INVALID');
  const previous = context.db.find(CALENDAR_APPOINTMENT_RESOURCE_CURRENT, { filters: [
    { type: 'field', field: 'scope_id', operator: 'eq', value: scopeId }, { type: 'field', field: 'appointment_id', operator: 'eq', value: appointmentId }], limit: 17 });
  if (previous.length > 16) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const row of previous) context.db.delete(CALENDAR_APPOINTMENT_RESOURCE_CURRENT, String(row.id));
  for (const resourceId of [...resourceIds].sort()) context.db.createStrict(CALENDAR_APPOINTMENT_RESOURCE_CURRENT, {
    id: calendarHash([scopeId, appointmentId, calendarKey(resourceId)]), scope_id: scopeId, appointment_id: appointmentId,
    resource_id: resourceId, binding_revision: calendarInteger(revision, 1),
  });
}
/** Private snapshots describe the before/after facts observed at one NEW accepted edit generation, not fake backfilled history. */
export function appendCalendarAppointmentUpdateHistory(context: DatabaseWriteCommandContext, scopeId: string, appointmentId: string,
  revision: number, before: unknown, after: unknown): void {
  if (!calendarCurrentResourceMembership(context)) throw new CalendarError('CALENDAR_NOT_READY');
  context.db.createStrict(CALENDAR_APPOINTMENT_UPDATE_HISTORY, {
    id: calendarHash(['appointment.update.history.v1', scopeId, appointmentId, revision]), scope_id: scopeId,
    appointment_id: appointmentId, appointment_revision: revision, prior_revision: revision - 1,
    before_json: calendarJson(before), after_json: calendarJson(after),
  });
}
