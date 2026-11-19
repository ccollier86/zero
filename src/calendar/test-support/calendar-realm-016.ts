/** Exact genuine016 registries/maps, with and without its native boundary manifest.
 * Test provenance only: never infer an old realm from the current latest schema.
 */
import { defineDatabaseRealm } from '../../databases/database-realm';
import { calendarRealm } from '../realm';
import { CALENDAR_APPOINTMENT_UPDATE_TABLES } from '../realm-appointment-update-migration';

const retained = {
  name: calendarRealm.name, version: '16', tables: CALENDAR_APPOINTMENT_UPDATE_TABLES,
  migrations: calendarRealm.migrations.slice(0, 16),
  commands: Object.fromEntries(Object.entries(calendarRealm.commands).filter(([name]) => !['calendar.resource.location-policy', 'calendar.resource.override-grant'].includes(name))),
  queries: Object.fromEntries(Object.entries(calendarRealm.queries).filter(([name]) => !['calendar.appointmentsByDate', 'calendar.resourceLocationPolicy', 'calendar.overrideGrant', 'calendar.appointmentReviewCreate', 'calendar.appointmentReviewUpdate'].includes(name))),
};
export const calendarRealmPreManifest016 = defineDatabaseRealm(retained);
export const calendarRealm016 = defineDatabaseRealm({ ...retained, migrationTableStages: calendarRealm.migrationTableStages!.slice(0, 16) });
