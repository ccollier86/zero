/** Fixed private realm, imported independently by the managed parent and dedicated calendar actors. */
import { defineDatabaseRealm, type DatabaseReadQueryHandler } from '../databases/database-realm';
import { CALENDAR_TABLES } from './realm-schema';
import { migrateCalendarLifecycle } from './realm-lifecycle-migration';
import { migrateCalendarVisitBindings } from './realm-visit-bindings-migration';
import { migrateCalendarParticipantBindings } from './realm-participant-bindings-migration';
import { CALENDAR_AVAILABILITY_POLICY_TABLES, migrateCalendarWorkingHours } from './realm-working-hours-migration';
import { readCalendarAvailabilityPolicyView, replaceCalendarAvailabilityPolicy } from './working-hours';
import { migrateCalendarScheduling } from './realm-scheduling-migration';
import { migrateCalendarHolds } from './realm-holds-migration';
import { migrateCalendarLocations } from './realm-locations-migration';
import { migrateCalendarTypes } from './realm-types-migration';
import { bindCalendarOwner, cancelCalendarAppointment, changeCalendarGrant, createCalendarAppointment, createCalendarResource, rescheduleCalendarAppointment } from './realm-commands';
import { listCalendarResources, queryCalendarAppointments, queryCalendarBusy, readCalendarAppointment, readCalendarReceipt } from './realm-queries';
import { calendarRead } from './error';
import { readCalendarAvailability, replaceCalendarAvailability } from './availability';
import { queryCalendarBlocks, readCalendarBlock, createCalendarBlock, rescheduleCalendarBlock, cancelCalendarBlock } from './blocks';
import { acquireCalendarHold, releaseCalendarHold, confirmCalendarHold, readCalendarHold, queryCalendarHolds } from './holds';
import { createCalendarLocation, replaceCalendarLocation, replaceCalendarResourceLocations, listCalendarLocations, readCalendarLocation, readCalendarResourceLocations, queryCalendarLocationAssignmentWitnesses } from './locations';
import { createCalendarType, replaceCalendarType, replaceCalendarResourceTypes, listCalendarTypes, readCalendarType, readCalendarResourceTypes } from './appointment-types';
import { readCalendarLifecyclePolicy, replaceCalendarLifecyclePolicy, readCalendarAppointmentTransitions, transitionCalendarAppointment } from './lifecycle';
import { queryCalendarVisitLocations } from './visit-locations';
import { readCalendarAppointmentParticipants, readCalendarHoldParticipants, readCalendarHoldParticipantAdmission, replaceCalendarAppointmentParticipants } from './participant-bindings';
import { CALENDAR_INTEGRATION_TABLES, migrateCalendarIntegrations } from './realm-integrations-migration';
import { CALENDAR_INTEGRATION_OWNERSHIP_TABLES, migrateCalendarIntegrationOwnership } from './realm-integration-ownership-migration';
import { installCalendarIntegrationPolicy, activateCalendarIntegrationPolicy, retireCalendarIntegrationPolicy, claimCalendarIntegrations, acknowledgeCalendarIntegration,
  deferCalendarIntegration, suppressCalendarIntegration, admitCalendarIntegrationEffect, settleCalendarIntegrationEffect } from './integration-commands';
import { readCalendarIntegrationPolicy, listCalendarIntegrationPolicies, readCalendarIntegrationIntent, listPendingCalendarIntegrations, readCalendarIntegrationEffect } from './integration-queries';

function query(handler: (context: Parameters<DatabaseReadQueryHandler>[0], input: unknown) => unknown): DatabaseReadQueryHandler {
  // Native runDatabaseRealmQuery validates/clones the returned value at its boundary.
  return (context, input) => calendarRead(() => handler(context, input)) as never;
}

export const calendarRealm = defineDatabaseRealm({
  name: 'zero.calendar.internal', version: '11', tables: CALENDAR_INTEGRATION_OWNERSHIP_TABLES,
  // Preserve the inline historical expression layout: Bun's method reprinting
  // participates in the pinned 001 checksum. New entries must not reformat it.
  migrations: [{ version: '001', description: 'Private one-off calendar conflict domain', up(database) {
    for (const sql of [
      'CREATE INDEX calendar_resource_catalog ON calendar_resources(scope_id,id)',
      'CREATE INDEX calendar_resource_owner ON calendar_resources(scope_id,owner_id,id)',
      'CREATE UNIQUE INDEX calendar_grant_identity ON _calendar_grants(scope_id,resource_id,user_id)',
      'CREATE INDEX calendar_grant_user ON _calendar_grants(scope_id,user_id,resource_id)',
      'CREATE INDEX calendar_appointment_range ON calendar_appointments(scope_id,status,occupied_start_ms,id)',
      'CREATE UNIQUE INDEX calendar_reservation_identity ON _calendar_reservations(scope_id,appointment_id,resource_id)',
      'CREATE INDEX calendar_reservation_overlap ON _calendar_reservations(scope_id,resource_id,active,occupied_start_ms,occupied_end_ms,appointment_id)',
      'CREATE UNIQUE INDEX calendar_receipt_identity ON _calendar_receipts(scope_id,principal,request_id)',
      'CREATE INDEX calendar_effect_source ON _calendar_effect_intents(scope_id,target_kind,target_id,revision)',
    ]) database.run(sql);
    const immutable = ['_calendar_owner', '_calendar_receipts', '_calendar_effect_intents'];
    for (const table of immutable) for (const operation of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER ${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
    for (const table of Object.keys(CALENDAR_TABLES).filter(table => table !== '_calendar_usage')) {
      // Guard INSERT OR REPLACE independently of recursive_triggers connection settings.
      const duplicate = 'id=NEW.id' + (table === '_calendar_receipts' ? ' OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)'
        : table === '_calendar_grants' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND user_id=NEW.user_id)'
        : table === '_calendar_reservations' ? ' OR (scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND resource_id=NEW.resource_id)' : '');
      database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
      if (table === '_calendar_owner') continue;
      database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
      database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
      if (!immutable.includes(table)) database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    }
    for (const table of ['_calendar_grants', '_calendar_reservations']) database.run(`CREATE TRIGGER ${table}_resource BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar resource is inconsistent'); END`);
    database.run(`CREATE TRIGGER calendar_reservation_parent BEFORE INSERT ON _calendar_reservations WHEN NOT EXISTS(SELECT 1 FROM calendar_appointments WHERE id=NEW.appointment_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar appointment is inconsistent'); END`);
    database.run(`CREATE TRIGGER calendar_effect_parent BEFORE INSERT ON _calendar_effect_intents WHEN NOT EXISTS(SELECT 1 FROM _calendar_receipts WHERE id=NEW.receipt_id AND scope_id=NEW.scope_id AND target_kind=NEW.target_kind AND target_id=NEW.target_id) BEGIN SELECT RAISE(ABORT,'Private calendar receipt is inconsistent'); END`);
    database.run(`CREATE TRIGGER calendar_grant_identity BEFORE UPDATE OF resource_id,user_id ON _calendar_grants WHEN OLD.resource_id IS NOT NEW.resource_id OR OLD.user_id IS NOT NEW.user_id BEGIN SELECT RAISE(ABORT,'Private grant identity is immutable'); END`);
    database.run(`CREATE TRIGGER calendar_reservation_identity BEFORE UPDATE OF appointment_id,resource_id ON _calendar_reservations WHEN OLD.appointment_id IS NOT NEW.appointment_id OR OLD.resource_id IS NOT NEW.resource_id BEGIN SELECT RAISE(ABORT,'Private reservation identity is immutable'); END`);
    database.run(`CREATE TRIGGER calendar_resource_revision BEFORE UPDATE ON calendar_resources WHEN NEW.revision<>OLD.revision+1 OR OLD.owner_id IS NOT NEW.owner_id OR OLD.kind IS NOT NEW.kind BEGIN SELECT RAISE(ABORT,'Private resource revision is inconsistent'); END`);
    database.run(`CREATE TRIGGER calendar_appointment_revision BEFORE UPDATE ON calendar_appointments WHEN NEW.revision<>OLD.revision+1 OR OLD.created_by IS NOT NEW.created_by OR OLD.status='cancelled' BEGIN SELECT RAISE(ABORT,'Private appointment revision is inconsistent'); END`);
  } }, { version: '002', description: 'Versioned availability and one-off resource blocks', up: migrateCalendarScheduling }, { version: '003', description: 'Authenticated expiring calendar booking holds', up: migrateCalendarHolds }, { version: '004', description: 'Versioned calendar locations and resource assignments', up: migrateCalendarLocations }, { version: '005', description: 'Versioned appointment types and resource admission policies', up: migrateCalendarTypes }, { version: '006', description: 'Versioned lifecycle policy and private appointment outcomes', up: migrateCalendarLifecycle }, { version: '007', description: 'Private versioned visit and location bindings', up: migrateCalendarVisitBindings }, { version: '008', description: 'Private versioned canonical participant references', up: migrateCalendarParticipantBindings }, { version: '009', description: 'Versioned availability sources and frozen weekly working hours', up: migrateCalendarWorkingHours }, { version: '010', description: 'Private bounded source-owned observation integration protocol', up: migrateCalendarIntegrations }, { version: '011', description: 'Permanent one-to-one calendar rule and Jobs source ownership', up: migrateCalendarIntegrationOwnership }],
  commands: { 'calendar.owner.bind': bindCalendarOwner, 'calendar.resource.create': createCalendarResource, 'calendar.resource.grant': changeCalendarGrant,
    'calendar.appointment.create': createCalendarAppointment, 'calendar.appointment.reschedule': rescheduleCalendarAppointment, 'calendar.appointment.cancel': cancelCalendarAppointment,
    'calendar.resource.availability': replaceCalendarAvailability, 'calendar.resource.availability-policy': replaceCalendarAvailabilityPolicy, 'calendar.block.create': createCalendarBlock,
    'calendar.block.reschedule': rescheduleCalendarBlock, 'calendar.block.cancel': cancelCalendarBlock,
    'calendar.hold.acquire': acquireCalendarHold, 'calendar.hold.release': releaseCalendarHold, 'calendar.hold.confirm': confirmCalendarHold,
    'calendar.location.create': createCalendarLocation, 'calendar.location.replace': replaceCalendarLocation, 'calendar.resource.locations': replaceCalendarResourceLocations,
    'calendar.type.create': createCalendarType, 'calendar.type.replace': replaceCalendarType, 'calendar.resource.types': replaceCalendarResourceTypes,
    'calendar.lifecycle.replace': replaceCalendarLifecyclePolicy, 'calendar.appointment.transition': transitionCalendarAppointment,
    'calendar.appointment.participants': replaceCalendarAppointmentParticipants,
    'calendar.integration.policy.install': installCalendarIntegrationPolicy, 'calendar.integration.policy.activate': activateCalendarIntegrationPolicy,
    'calendar.integration.policy.retire': retireCalendarIntegrationPolicy, 'calendar.integration.claim': claimCalendarIntegrations,
    'calendar.integration.ack': acknowledgeCalendarIntegration, 'calendar.integration.defer': deferCalendarIntegration, 'calendar.integration.suppress': suppressCalendarIntegration,
    'calendar.integration.effect.admit': admitCalendarIntegrationEffect, 'calendar.integration.effect.settle': settleCalendarIntegrationEffect },
  queries: { 'calendar.resources': query(listCalendarResources), 'calendar.busy': query(queryCalendarBusy), 'calendar.appointments': query(queryCalendarAppointments),
    'calendar.appointment': query(readCalendarAppointment), 'calendar.receipt': query(readCalendarReceipt),
    'calendar.availability': query(readCalendarAvailability), 'calendar.availabilityPolicy': query(readCalendarAvailabilityPolicyView), 'calendar.blocks': query(queryCalendarBlocks), 'calendar.block': query(readCalendarBlock),
    'calendar.holds': query(queryCalendarHolds), 'calendar.hold': query(readCalendarHold),
    'calendar.locations': query(listCalendarLocations), 'calendar.location': query(readCalendarLocation), 'calendar.resourceLocations': query(readCalendarResourceLocations),
    'calendar.locationAssignmentWitnesses': query(queryCalendarLocationAssignmentWitnesses),
    'calendar.visitLocations': query(queryCalendarVisitLocations),
    'calendar.types': query(listCalendarTypes), 'calendar.type': query(readCalendarType), 'calendar.resourceTypes': query(readCalendarResourceTypes),
    'calendar.lifecycle': query(readCalendarLifecyclePolicy), 'calendar.appointmentTransitions': query(readCalendarAppointmentTransitions),
    'calendar.appointmentParticipants': query(readCalendarAppointmentParticipants), 'calendar.holdParticipants': query(readCalendarHoldParticipants),
    'calendar.holdParticipantAdmission': query(readCalendarHoldParticipantAdmission),
    'calendar.integration.policy': query(readCalendarIntegrationPolicy), 'calendar.integration.policies': query(listCalendarIntegrationPolicies),
    'calendar.integration.intent': query(readCalendarIntegrationIntent), 'calendar.integration.pending': query(listPendingCalendarIntegrations), 'calendar.integration.effect': query(readCalendarIntegrationEffect) },
});
