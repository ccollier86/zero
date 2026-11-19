/** Native Calendar opt-in. No historical migration handlers are replaced.
 * Preserve every original handler/declaration; prepare each original boundary,
 * never predefine the latest schema.016 and future migrations own their DDL.
 */
import type { DatabaseRealmMigrationTableStage } from '../databases/database-realm-migration-tables';
import { CALENDAR_TABLES, CALENDAR_SCHEDULING_TABLES, CALENDAR_HOLD_TABLES, CALENDAR_LOCATION_TABLES, CALENDAR_TYPE_TABLES } from './realm-schema';
import { CALENDAR_LIFECYCLE_TABLES } from './realm-lifecycle-migration';
import { CALENDAR_VISIT_TABLES } from './realm-visit-bindings-migration';
import { CALENDAR_PARTICIPANT_TABLES } from './realm-participant-bindings-migration';
import { CALENDAR_AVAILABILITY_POLICY_TABLES } from './realm-working-hours-migration';
import { CALENDAR_INTEGRATION_TABLES } from './realm-integrations-migration';
import { CALENDAR_INTEGRATION_OWNERSHIP_TABLES } from './realm-integration-ownership-migration';
import { CALENDAR_INTEGRATION_CONTROL_TABLES } from './realm-integration-controls-migration';
import { CALENDAR_INTEGRATION_QUEUE_TABLES } from './realm-integration-queue-migration';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { CALENDAR_INTEGRATION_OPERATOR_TABLES } from './realm-integration-operator-migration';
import { CALENDAR_APPOINTMENT_UPDATE_TABLES } from './realm-appointment-update-migration';
import { calendarAppointmentAllDayTables } from './realm-appointment-all-day-migration';
const checkpoints = [CALENDAR_TABLES, CALENDAR_SCHEDULING_TABLES, CALENDAR_HOLD_TABLES, CALENDAR_LOCATION_TABLES, CALENDAR_TYPE_TABLES,
  CALENDAR_LIFECYCLE_TABLES, CALENDAR_VISIT_TABLES, CALENDAR_PARTICIPANT_TABLES, CALENDAR_AVAILABILITY_POLICY_TABLES, CALENDAR_INTEGRATION_TABLES,
  CALENDAR_INTEGRATION_OWNERSHIP_TABLES, CALENDAR_INTEGRATION_CONTROL_TABLES, CALENDAR_INTEGRATION_QUEUE_TABLES,
  CALENDAR_INTEGRATION_INSPECTION_TABLES, CALENDAR_INTEGRATION_OPERATOR_TABLES, CALENDAR_APPOINTMENT_UPDATE_TABLES, calendarAppointmentAllDayTables()];
export const CALENDAR_MIGRATION_TABLE_STAGES: readonly DatabaseRealmMigrationTableStage[] = Object.freeze(checkpoints.map((tables, index) => Object.freeze({
  version: String(index + 1).padStart(3, '0'),
  tables: Object.freeze(Object.fromEntries(Object.entries(tables).map(([name, definition]) => [name, Object.freeze({ ...definition,
    ...(definition._identity ? { _identity: Object.freeze([...definition._identity]) as unknown as string[] } : {}) })]))),
  ...(index < 15 ? { prepare: 'create-added-tables' as const } : {}),
})));
