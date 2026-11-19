/** Exact genuine017 schema/registry provenance; later policies cannot relabel its accepted evidence. */
import { defineDatabaseRealm } from '../../databases/database-realm';
import { calendarRealm } from '../realm';
import { calendarAppointmentAllDayTables } from '../realm-appointment-all-day-migration';

export const calendarRealm017 = defineDatabaseRealm({
  name: calendarRealm.name, version: '17', tables: calendarAppointmentAllDayTables(),
  migrations: calendarRealm.migrations.slice(0, 17),
  migrationTableStages: calendarRealm.migrationTableStages!.slice(0, 17),
  commands: Object.fromEntries(Object.entries(calendarRealm.commands).filter(([name]) => !['calendar.resource.location-policy', 'calendar.resource.override-grant'].includes(name))),
  queries: Object.fromEntries(Object.entries(calendarRealm.queries).filter(([name]) => !['calendar.resourceLocationPolicy', 'calendar.overrideGrant', 'calendar.appointmentReviewCreate', 'calendar.appointmentReviewUpdate'].includes(name))),
});
