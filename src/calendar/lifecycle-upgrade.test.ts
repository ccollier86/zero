/** Populated 005 -> 006 through the real native memory migrator; no files, backups, actors or output. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { blockReservationId } from './blocks-model';
import { holdReservationId } from './holds-model';
import { calendarLocationCurrentId } from './locations-model';
// Preserve this recorded upgrade boundary through016; latest017 is qualified separately.
import { calendarRealm016 as calendarRealm } from './test-support/calendar-realm-016';
import { CALENDAR_APPOINTMENT_UPDATE_TABLES } from './realm-appointment-update-migration';
import { grantId, reservationId } from './realm-model';
import { CALENDAR_LIFECYCLE_TABLES } from './realm-lifecycle-migration';
import { CALENDAR_INTEGRATION_ADDITIONS } from './realm-integrations-migration';
import { CALENDAR_INTEGRATION_OPERATOR_TABLES } from './realm-integration-operator-migration';
import { CALENDAR_TYPE_TABLES } from './realm-schema';
import { normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarHash, calendarJson } from './validation';

// Independently recorded before lifecycle existed. Neither declarations nor migration
// functions may be changed or grandfathered by supplying replacement checksums.
const ORIGINAL_005_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
  'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
  'e77be92766070b2da02fb306de1f8694c5714b7ef173c995c198f336ca7c2a10',
];
const ORIGINAL_005_TABLES = 'b3fd9e5100781d0b29fac7d800c169e8be26cc395994ebebdb7627a9a214dd28';
const actor: CalendarActor = { scopeId: 'tenant:synthetic-lifecycle-upgrade', userId: 'owner', principal: 'upgrade-session', manageAll: true, createOwn: true };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const typeReference = { id: 'legacy-type', revision: 1 };
const typeFields = { label: 'PRIVATE_ORIGINAL_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'type.blue', active: true };
const typeSnapshot = { ...typeReference, label: typeFields.label, durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'type.blue' };
const availabilityPolicy = { mode: 'windows', windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' }] };
const receiptStores = ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts', '_calendar_type_receipts'] as const;
const virtualPolicy = { revision: 1, extended: false, cancellationReason: 'optional', noShowReason: 'optional' };

function intervalFields(value: CalendarTimedInterval) {
  return { start_at: value.startAt, end_at: value.endAt, start_ms: value.startMs, end_ms: value.endMs, time_zone: value.timeZone,
    buffer_before: value.bufferBeforeMinutes, buffer_after: value.bufferAfterMinutes, occupied_start_ms: value.occupiedStartMs, occupied_end_ms: value.occupiedEndMs };
}
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(CALENDAR_TYPE_TABLES)) db.defineTable(name, schema);
    // Current handlers need the explicitly empty/disabled integration lookup.
    // This is test support, not evidence that 010 existed in historical 005.
    db.defineTable('_calendar_integration_policy_history', CALENDAR_INTEGRATION_ADDITIONS._calendar_integration_policy_history!);
    db.defineTable('_calendar_integration_policy_current', CALENDAR_INTEGRATION_ADDITIONS._calendar_integration_policy_current!);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 5), createBackups: false, log() {} });
    try { expect(historical.run()).toEqual(['001', '002', '003', '004', '005']); } finally { historical.dispose(); }

    // Current handlers necessarily consult the sixth receipt family. Populate the
    // exact accepted 005 records under all original SQL constraints, before that
    // family exists, and retain each corresponding historical replay intent.
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-owner' });
    db.createStrict('calendar_resources', { id: 'person', scope_id: actor.scopeId, label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', owner_id: actor.userId,
      time_zone: 'UTC', revision: 1, active: 1 });
    const saved = new Map<string, CalendarCommandReceipt>();
    const replays: { name: string; input: Record<string, unknown>; receipt: CalendarCommandReceipt }[] = [];
    const save = (kind: 'resource' | 'appointment' | 'block' | 'hold' | 'location' | 'type', requestId: string, targetId: string,
      operation: CalendarCommandReceipt['operation'], revision: number, intent: unknown, name: string, input: Record<string, unknown>) => {
      const id = calendarHash([actor.scopeId, actor.principal, requestId]), result: CalendarCommandReceipt = { requestId, operation, id: targetId, revision, changed: true };
      const prefix = ['block', 'hold', 'location', 'type'].includes(kind) ? '_calendar_' + kind : '_calendar';
      db.createStrict(prefix + '_receipts', { id, scope_id: actor.scopeId, principal: actor.principal, request_id: requestId, digest: calendarHash(intent), result_json: calendarJson(result),
        target_kind: kind, target_id: targetId, required_right: kind === 'hold' || kind === 'appointment' ? 'book' : 'manage' });
      db.createStrict(prefix + '_effect_intents', { id, scope_id: actor.scopeId, receipt_id: id, operation, target_kind: kind, target_id: targetId, revision });
      saved.set(requestId, result); replays.push({ name, input: { actor, id: targetId, requestId, ...input }, receipt: result });
    };
    save('resource', 'resource', 'person', 'resource.created', 1, ['resource.create', 'person', 'PRIVATE_ORIGINAL_RESOURCE', 'person', actor.userId, 'UTC'],
      'resource.create', { label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    db.createStrict('_calendar_grants', { id: grantId(actor.scopeId, 'person', 'delegate'), scope_id: actor.scopeId, resource_id: 'person', user_id: 'delegate', busy: 1, details: 1, book: 0, manage: 0 });
    db.update('calendar_resources', 'person', { revision: 2 });
    save('resource', 'grant', 'person', 'resource.grant-changed', 2, ['resource.grant', 'person', 1, 'delegate', ['busy', 'details']],
      'resource.grant', { expectedRevision: 1, userId: 'delegate', grants: ['details', 'busy'] });

    db.createStrict('_calendar_location_history', { id: calendarHash([actor.scopeId, 'location', 1]), scope_id: actor.scopeId, location_id: 'location', location_revision: 1,
      label: 'PRIVATE_ORIGINAL_LOCATION', region: 'US-IN', active: 1 });
    db.createStrict('calendar_locations', { id: 'location', scope_id: actor.scopeId, revision: 1 });
    save('location', 'location', 'location', 'location.created', 1, ['location.create', 'location', 'PRIVATE_ORIGINAL_LOCATION', 'US-IN', true],
      'location.create', { label: 'PRIVATE_ORIGINAL_LOCATION', region: 'US-IN' });
    db.update('calendar_resources', 'person', { revision: 3 });
    db.createStrict('_calendar_resource_location_history', { id: calendarHash([actor.scopeId, 'person', 3]), scope_id: actor.scopeId, resource_id: 'person', resource_revision: 3, location_ids_json: '["location"]' });
    db.createStrict('_calendar_resource_location_members', { id: calendarHash([actor.scopeId, 'person', 3, 'location']), scope_id: actor.scopeId, resource_id: 'person', resource_revision: 3, location_id: 'location' });
    db.createStrict('_calendar_resource_locations', { id: 'person', scope_id: actor.scopeId, resource_id: 'person', resource_revision: 3 });
    db.createStrict('_calendar_resource_location_current', { id: calendarLocationCurrentId(actor.scopeId, 'person', 'location'), scope_id: actor.scopeId, resource_id: 'person', resource_revision: 3, location_id: 'location' });
    save('resource', 'resource-locations', 'person', 'resource.locations-changed', 3, ['resource.locations', 'person', 2, ['location']],
      'resource.locations', { expectedRevision: 2, locationIds: ['location'] });
    db.update('calendar_resources', 'person', { revision: 4 });
    db.createStrict('_calendar_availability_history', { id: calendarHash([actor.scopeId, 'person', 4]), scope_id: actor.scopeId, resource_id: 'person', policy_revision: 4,
      mode: availabilityPolicy.mode, windows_json: calendarJson(availabilityPolicy.windows) });
    db.createStrict('_calendar_availability', { id: 'person', scope_id: actor.scopeId, resource_id: 'person', policy_revision: 4 });
    save('resource', 'availability', 'person', 'resource.availability-changed', 4, ['resource.availability', 'person', 3, availabilityPolicy],
      'resource.availability', { expectedRevision: 3, ...availabilityPolicy });

    db.createStrict('_calendar_type_history', { id: calendarHash([actor.scopeId, typeReference.id, 1]), scope_id: actor.scopeId, type_id: typeReference.id, type_revision: 1,
      label: typeFields.label, duration_minutes: 60, buffer_before: 5, buffer_after: 10, color_key: typeFields.colorKey, active: 1 });
    db.createStrict('calendar_types', { id: typeReference.id, scope_id: actor.scopeId, revision: 1 });
    save('type', 'type', typeReference.id, 'type.created', 1, ['type.create', typeReference.id, typeFields], 'type.create', typeFields);
    db.update('calendar_resources', 'person', { revision: 5 });
    db.createStrict('_calendar_resource_type_history', { id: calendarHash([actor.scopeId, 'person', 5]), scope_id: actor.scopeId, resource_id: 'person', resource_revision: 5,
      mode: 'optional', type_ids_json: calendarJson([typeReference.id]) });
    db.createStrict('_calendar_resource_type_members', { id: calendarHash([actor.scopeId, 'person', 5, typeReference.id]), scope_id: actor.scopeId,
      resource_id: 'person', resource_revision: 5, type_id: typeReference.id });
    db.createStrict('_calendar_resource_types', { id: 'person', scope_id: actor.scopeId, resource_id: 'person', resource_revision: 5 });
    save('resource', 'resource-types', 'person', 'resource.types-changed', 5, ['resource.types', 'person', 4, { mode: 'optional', typeIds: [typeReference.id] }],
      'resource.types', { expectedRevision: 4, mode: 'optional', typeIds: [typeReference.id] });

    for (const typed of [false, true]) {
      const id = typed ? 'legacy-typed-appointment' : 'legacy-appointment';
      const title = typed ? 'PRIVATE_TYPED_APPOINTMENT' : 'PRIVATE_ORIGINAL_APPOINTMENT';
      const wire = { ...timed, ...(typed ? { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', bufferBeforeMinutes: 5, bufferAfterMinutes: 10 } : {}) };
      const interval = normalizeCalendarTimedInterval(wire);
      db.createStrict('calendar_appointments', { id, scope_id: actor.scopeId, title, ...intervalFields(interval), status: 'confirmed', revision: 1, created_by: actor.userId });
      db.createStrict('_calendar_reservations', { id: reservationId(actor.scopeId, id, 'person'), scope_id: actor.scopeId, appointment_id: id, resource_id: 'person',
        occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, active: 1 });
      if (typed) {
        const bindingId = calendarHash(['appointment.type', actor.scopeId, id, 1]);
        db.createStrict('_calendar_appointment_type_bindings', { id: bindingId, scope_id: actor.scopeId, appointment_id: id, appointment_revision: 1, type_id: typeReference.id, type_revision: 1 });
        db.createStrict('_calendar_appointment_type_current', { id: calendarHash(['appointment.type', actor.scopeId, id]), scope_id: actor.scopeId, appointment_id: id, binding_id: bindingId });
      }
      const intent = typed ? ['appointment.create.typed.v1', id, ['person'], title, wire, typeReference] : ['appointment.create', id, ['person'], title, interval];
      save('appointment', id, id, 'appointment.created', 1, intent, 'appointment.create', { resourceIds: ['person'], title, ...wire, ...(typed ? { appointmentType: typeReference } : {}) });
    }
    const heldWire = { ...timed, startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z', bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
    const held = normalizeCalendarTimedInterval(heldWire), createdMs = Date.parse('2030-01-01T09:00:00.000Z'), expiresMs = createdMs + 300_000;
    db.createStrict('calendar_holds', { id: 'legacy-hold', scope_id: actor.scopeId, principal: actor.principal, created_by: actor.userId, created_ms: createdMs, revision: 1,
      ...intervalFields(held), status: 'held', expires_ms: expiresMs, appointment_id: null });
    db.createStrict('_calendar_hold_type_bindings', { id: calendarHash(['hold.type', actor.scopeId, 'legacy-hold']), scope_id: actor.scopeId, hold_id: 'legacy-hold', type_id: typeReference.id, type_revision: 1 });
    db.createStrict('_calendar_hold_reservations', { id: holdReservationId(actor.scopeId, 'legacy-hold', 'person'), scope_id: actor.scopeId, hold_id: 'legacy-hold', resource_id: 'person', resource_revision: 5,
      occupied_start_ms: held.occupiedStartMs, occupied_end_ms: held.occupiedEndMs, expires_ms: expiresMs, active: 1 });
    save('hold', 'hold', 'legacy-hold', 'hold.acquired', 1, ['hold.acquire.typed.v1', 'legacy-hold', ['person'], heldWire, 300, typeReference],
      'hold.acquire', { resourceIds: ['person'], ...heldWire, ttlSeconds: 300, appointmentType: typeReference });
    const blocked = normalizeCalendarTimedInterval({ ...timed, startAt: '2030-01-01T16:00:00.000Z', endAt: '2030-01-01T17:00:00.000Z' });
    db.createStrict('calendar_blocks', { id: 'legacy-block', scope_id: actor.scopeId, title: 'PRIVATE_ORIGINAL_BLOCK', start_at: blocked.startAt, end_at: blocked.endAt,
      start_ms: blocked.startMs, end_ms: blocked.endMs, time_zone: blocked.timeZone, status: 'active', revision: 1, created_by: actor.userId });
    db.createStrict('_calendar_block_reservations', { id: blockReservationId(actor.scopeId, 'legacy-block', 'person'), scope_id: actor.scopeId, block_id: 'legacy-block', resource_id: 'person',
      occupied_start_ms: blocked.startMs, occupied_end_ms: blocked.endMs, active: 1 });
    save('block', 'block', 'legacy-block', 'block.created', 1, ['block.create', 'legacy-block', ['person'], 'PRIVATE_ORIGINAL_BLOCK', blocked],
      'block.create', { resourceIds: ['person'], title: 'PRIVATE_ORIGINAL_BLOCK', startAt: blocked.startAt, endAt: blocked.endAt, timeZone: 'UTC' });
    for (const [id, count] of [['resources', 1], ['appointments', 2], ['blocks', 1], ['holds', 1], ['locations', 1], ['locationHistory', 1], ['resourceLocationHistory', 1],
      ['types', 1], ['typeHistory', 1], ['resourceTypeHistory', 1], ['appointmentTypeHistory', 1], ['receipts', saved.size]] as const) db.createStrict('_calendar_usage', { id, count });

    const command = (name: string, input: unknown): CalendarCommandReceipt => {
      const result = runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      if (result === null || typeof result !== 'object' || Array.isArray(result) || !('ok' in result) || result.ok !== true || !('value' in result)) throw new Error('Expected accepted calendar command');
      return result.value as unknown as CalendarCommandReceipt;
    };
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { copy.close(); }
    };
    const legacy = () => Object.fromEntries(Object.keys(CALENDAR_TYPE_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const upgrade = () => {
      for (const [name, schema] of Object.entries(calendarRealm.tables)) if (!(name in CALENDAR_TYPE_TABLES)) db.defineTable(name, schema);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = current.run(); expect(current.status().every(entry => entry.checksumMatches)).toBe(true); return applied; } finally { current.dispose(); }
    };
    return { db, raw, command, query, saved, replays, legacy, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('006 is additive and preserves all five historical function, declaration and registered-checksum identities', () => {
  expect(calendarRealm.migrations.map(migration => migration.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016']);
  expect(calendarRealm.migrations.slice(0, 5).map(hashMigration)).toEqual(ORIGINAL_005_CHECKSUMS);
  expect(calendarRealm.migrationChecksums.slice(0, 5)).toEqual(ORIGINAL_005_CHECKSUMS.map((checksum, index) => ({ version: String(index + 1).padStart(3, '0'), checksum })));
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_TYPE_TABLES))).toBe(ORIGINAL_005_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_TYPE_TABLES)) expect(CALENDAR_LIFECYCLE_TABLES[name]).toEqual(schema);
  expect(Object.keys(CALENDAR_LIFECYCLE_TABLES).filter(table => !(table in CALENDAR_TYPE_TABLES))).toEqual([
    '_calendar_lifecycle_policy_history', '_calendar_lifecycle_policy', '_calendar_appointment_lifecycle_history', '_calendar_appointment_lifecycle_current',
    '_calendar_lifecycle_receipts', '_calendar_lifecycle_effect_intents',
  ]);
  expect(calendarRealm.tables).toEqual(CALENDAR_APPOINTMENT_UPDATE_TABLES);
});

test('real populated 005 upgrade preserves every old row, trigger, ledger, sequence and accepted replay without lifecycle backfill', () => {
  const f = fixture();
  try {
    const before = f.legacy(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const definitions = f.raw.query<{ type: string; name: string; sql: string }, []>("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    for (const table of Object.keys(CALENDAR_TYPE_TABLES)) expect(before[table]!.length).toBeGreaterThan(0);
    expect(f.upgrade()).toEqual(['006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016']); expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version IN ('001','002','003','004','005') ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.query('lifecycle', { actor })).toEqual(virtualPolicy);
    for (const id of ['legacy-appointment', 'legacy-typed-appointment']) {
      expect(f.query('appointment', { actor, id })).toMatchObject({ id, revision: 1, status: 'confirmed' });
      expect(f.query('appointment', { actor, id })).not.toHaveProperty('lifecycle');
    }
    expect(f.query('appointment', { actor, id: 'legacy-appointment' })).not.toHaveProperty('appointmentType');
    expect(f.query('appointment', { actor, id: 'legacy-typed-appointment' }).appointmentType).toEqual(typeSnapshot);
    expect(f.query('hold', { actor, id: 'legacy-hold' }).appointmentType).toMatchObject(typeReference);
    for (const [requestId, receipt] of f.saved) expect(f.query('receipt', { actor, requestId })).toEqual(receipt);
    for (const replay of f.replays) expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    for (const table of Object.keys(CALENDAR_LIFECYCLE_TABLES).filter(table => !(table in CALENDAR_TYPE_TABLES))) expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.upgrade()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('006 admits a true lifecycle policy target and retains terminal facts as additive sidecars without changing old occupancy or type evidence', () => {
  const f = fixture();
  try {
    f.upgrade();
    const before = f.legacy(), legacyAppointment = f.db.get('calendar_appointments', 'legacy-typed-appointment');
    const legacyUntypedAppointment = f.db.get('calendar_appointments', 'legacy-appointment');
    const policyInput = { actor, requestId: 'lifecycle-policy', expectedRevision: 1, extended: true, cancellationReason: 'optional', noShowReason: 'required' };
    const policy = f.command('lifecycle.replace', policyInput);
    expect(policy).toEqual({ requestId: 'lifecycle-policy', operation: 'lifecycle.policy-changed', id: 'policy', revision: 2, changed: true });
    expect(f.query('lifecycle', { actor })).toEqual({ revision: 2, extended: true, cancellationReason: 'optional', noShowReason: 'required' });
    expect(f.raw.query('SELECT target_kind,target_id,required_right FROM _calendar_lifecycle_receipts').all()).toEqual([{ target_kind: 'lifecycle', target_id: 'policy', required_right: 'manage' }]);
    expect(f.raw.query('SELECT operation,target_kind,target_id,revision FROM _calendar_lifecycle_effect_intents').all()).toEqual([
      { operation: 'lifecycle.policy-changed', target_kind: 'lifecycle', target_id: 'policy', revision: 2 },
    ]);
    for (const store of receiptStores) expect(f.raw.query(`SELECT * FROM ${store} ORDER BY id`).all()).toEqual(before[store]);
    const transitions = f.query('appointmentTransitions', { actor, id: 'legacy-typed-appointment' });
    expect(transitions).toMatchObject({ id: 'legacy-typed-appointment', revision: 1, policyRevision: 2, status: 'confirmed' });
    expect(transitions.allowed).toContainEqual({ status: 'completed', requiresReason: false });
    const input = { actor, requestId: 'complete', id: 'legacy-typed-appointment', expectedRevision: 1, policyRevision: 2, status: 'completed' };
    const completed = f.command('appointment.transition', input), seq = f.db.currentSeq;
    expect(completed).toEqual({ requestId: 'complete', operation: 'appointment.transitioned', id: 'legacy-typed-appointment', revision: 2, changed: true });
    expect(f.db.get('calendar_appointments', input.id)).toEqual({ ...legacyAppointment, revision: 2 });
    expect(f.query('appointment', { actor, id: input.id })).toMatchObject({ revision: 2, status: 'confirmed', appointmentType: typeSnapshot,
      lifecycle: { status: 'completed', revision: 2, policyRevision: 2, reason: null } });
    expect(f.query('appointmentTransitions', { actor, id: input.id }).allowed).toEqual([]);
    expect(f.db.list('_calendar_appointment_lifecycle_history')).toHaveLength(1);
    expect(f.db.list('_calendar_appointment_lifecycle_current')).toHaveLength(1);
    const after = f.legacy();
    for (const [table, rows] of Object.entries(before)) {
      if (['_calendar_usage', '_calendar_receipts', '_calendar_effect_intents', 'calendar_appointments'].includes(table)) continue;
      expect(after[table]).toEqual(rows);
    }
    expect(f.db.get('calendar_appointments', 'legacy-appointment')).toEqual(legacyUntypedAppointment);
    for (const table of ['_calendar_receipts', '_calendar_effect_intents']) {
      for (const row of before[table]! as { id: string }[]) expect(f.raw.query(`SELECT * FROM ${table} WHERE id=?`).get(row.id)).toEqual(row);
    }
    expect(f.command('lifecycle.replace', policyInput)).toEqual(policy);
    expect(f.command('appointment.transition', input)).toEqual(completed);
    expect(f.query('receipt', { actor, requestId: input.requestId })).toEqual(completed);
    for (const replay of f.replays) expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('the sixth receipt family rejects both global ID and scoped request collisions with each historical family in both directions', () => {
  const f = fixture();
  try {
    f.upgrade();
    f.command('lifecycle.replace', { actor, requestId: 'lifecycle-policy', expectedRevision: 1, extended: true, cancellationReason: 'optional', noShowReason: 'optional' });
    f.raw.run('PRAGMA recursive_triggers=OFF');
    const lifecycle = '_calendar_lifecycle_receipts', columns = ['id', 'scope_id', 'principal', 'request_id', 'digest', 'result_json', 'target_kind', 'target_id', 'required_right'];
    for (const historical of receiptStores) for (const [target, source] of [[lifecycle, historical], [historical, lifecycle]]) {
      const template = f.raw.query<Record<string, string>, []>(`SELECT * FROM ${target} ORDER BY id LIMIT 1`).get()!;
      const identity = f.raw.query<Record<string, string>, []>(`SELECT * FROM ${source} ORDER BY id LIMIT 1`).get()!;
      for (const [id, principal, requestId] of [
        [identity.id, 'synthetic-distinct-principal', 'synthetic-distinct-request'],
        ['synthetic-distinct-' + target + '-' + source, identity.principal, identity.request_id],
      ]) {
        const before = f.raw.query(`SELECT * FROM ${target} ORDER BY id`).all();
        const result = { ...JSON.parse(template.result_json!), requestId };
        const values: Record<string, string> = { ...template, id: id!, principal: principal!, request_id: requestId!, result_json: calendarJson(result) };
        expect(() => f.raw.query(`INSERT OR REPLACE INTO ${target} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
          .run(...columns.map(column => values[column]!))).toThrow();
        expect(f.raw.query(`SELECT * FROM ${target} ORDER BY id`).all()).toEqual(before);
      }
    }
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
