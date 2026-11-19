/** Genuine018 declaration and registry, never a later schema relabelled as historical. */
import { defineDatabaseRealm } from '../../databases/database-realm';
import { calendarRealm } from '../realm';
import { calendarResourceLocationPolicyTables } from '../realm-location-policy-migration';

export const calendarRealm018 = defineDatabaseRealm({
  name: calendarRealm.name, version: '18', tables: calendarResourceLocationPolicyTables(),
  migrations: calendarRealm.migrations.slice(0, 18),
  migrationTableStages: calendarRealm.migrationTableStages!.slice(0, 18),
  commands: Object.fromEntries(Object.entries(calendarRealm.commands).filter(([name]) => name !== 'calendar.resource.override-grant')),
  queries: Object.fromEntries(Object.entries(calendarRealm.queries).filter(([name]) => !['calendar.overrideGrant', 'calendar.appointmentReviewCreate', 'calendar.appointmentReviewUpdate'].includes(name))),
});
