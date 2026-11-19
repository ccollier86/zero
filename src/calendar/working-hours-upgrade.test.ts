/** Populated 008 -> 009 through native in-memory SQLite. No files, backups, actors, caches or generated output. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarAppointmentView, CalendarCommandReceipt, CalendarHoldView } from './contracts';
// Preserve this recorded upgrade boundary through016; latest017 is qualified separately.
import { calendarRealm016 as calendarRealm } from './test-support/calendar-realm-016';
import { CALENDAR_PARTICIPANT_TABLES } from './realm-participant-bindings-migration';
import { CALENDAR_INTEGRATION_ADDITIONS } from './realm-integrations-migration';

// Captured from the actual clean HEAD 3dbb524 functions and complete 008
// declaration before the working-hours implementation began. These are not
// recomputed from replacement functions to grandfather historical drift.
const ORIGINAL_008_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
  'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
  'e77be92766070b2da02fb306de1f8694c5714b7ef173c995c198f336ca7c2a10',
  'a38cc0a9ee67b8dcba14583ed27df66fbd8c6b78010110daefac4042af53eca0',
  'e36da6d58e7345c042829228d96a50c7799c1f2b9a4c5135294718e5ff4c0681',
  '1dd8c3a24f0710f6e2e2f19304d9e0e318dd42bbb3230fa1107ee9cbe7f2eb94',
] as const;
const ORIGINAL_008_TABLES = '7ce743df06584e0c59f1da3f839796c000daf3fe29d3abc282e2ed3eaf7117dd';
const versions = ['001', '002', '003', '004', '005', '006', '007', '008'];
const actor: CalendarActor = { scopeId: 'tenant:synthetic-working-hours-upgrade', userId: 'owner', principal: 'upgrade-session', manageAll: true, createOwn: true };
const participants = [{ kind: 'guardian-user' as const, userId: 'canonical-participant' }];
const typeReference = { id: 'legacy-type', revision: 1 };
const visit = { mode: 'in-person' as const, location: { id: 'legacy-location', revision: 1 } };
const timed = (hour: number) => ({ startAt: `2030-01-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
  endAt: `2030-01-01T${String(hour + 1).padStart(2, '0')}:00:00.000Z`, timeZone: 'UTC' });

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(CALENDAR_PARTICIPANT_TABLES)) db.defineTable(name, schema);
    // Empty lookup supports today's disabled-integration handlers only. The
    // separate 009->010 fixture seeds actual historical storage without it.
    db.defineTable('_calendar_integration_policy_history', CALENDAR_INTEGRATION_ADDITIONS._calendar_integration_policy_history!);
    db.defineTable('_calendar_integration_policy_current', CALENDAR_INTEGRATION_ADDITIONS._calendar_integration_policy_current!);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 8), createBackups: false, log() {} });
    try { expect(historical.run()).toEqual(versions); } finally { historical.dispose(); }
    const accepted: { name: string; input: Record<string, unknown>; receipt: CalendarCommandReceipt }[] = [];
    const command = (name: string, input: Record<string, unknown>): CalendarCommandReceipt => {
      const result = runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      if (!result || typeof result !== 'object' || Array.isArray(result) || !('ok' in result) || result.ok !== true || !('value' in result))
        throw new Error('Expected accepted calendar command: ' + name + ' ' + JSON.stringify(result));
      return result.value as unknown as CalendarCommandReceipt;
    };
    const seed = (name: string, input: Record<string, unknown>) => {
      const complete = { actor, ...input }, receipt = command(name, complete); accepted.push({ name, input: complete, receipt }); return receipt;
    };
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-owner' });
    // Every retained 008 family is populated before any 009 table exists.
    seed('resource.create', { id: 'person', requestId: 'resource', label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    seed('resource.grant', { id: 'person', requestId: 'grant', expectedRevision: 1, userId: 'delegate', grants: ['book', 'details'] });
    seed('location.create', { id: visit.location.id, requestId: 'location', label: 'PRIVATE_ORIGINAL_LOCATION', region: 'US-IN' });
    seed('resource.locations', { id: 'person', requestId: 'resource-locations', expectedRevision: 2, locationIds: [visit.location.id] });
    seed('resource.availability', { id: 'person', requestId: 'availability', expectedRevision: 3, mode: 'windows',
      windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' }] });
    seed('type.create', { id: typeReference.id, requestId: 'type', label: 'PRIVATE_ORIGINAL_TYPE', durationMinutes: 60,
      bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'type.blue' });
    seed('resource.types', { id: 'person', requestId: 'resource-types', expectedRevision: 4, mode: 'optional', typeIds: [typeReference.id] });
    seed('appointment.create', { id: 'legacy-appointment', requestId: 'appointment', title: 'PRIVATE_ORIGINAL_APPOINTMENT', resourceIds: ['person'], ...timed(8) });
    seed('appointment.create', { id: 'legacy-typed-visit', requestId: 'typed-visit', title: 'PRIVATE_TYPED_VISIT', resourceIds: ['person'],
      ...timed(10), appointmentType: typeReference, visit, participants });
    seed('appointment.participants', { id: 'legacy-typed-visit', requestId: 'participants', expectedRevision: 1,
      references: [...participants, { kind: 'guardian-user', userId: 'second-participant' }] });
    seed('hold.acquire', { id: 'legacy-hold', requestId: 'hold', resourceIds: ['person'], ...timed(14), ttlSeconds: 300,
      appointmentType: typeReference, visit, participants });
    seed('block.create', { id: 'legacy-block', requestId: 'block', title: 'PRIVATE_ORIGINAL_BLOCK', resourceIds: ['person'], ...timed(18) });
    seed('lifecycle.replace', { requestId: 'lifecycle-policy', expectedRevision: 1, extended: true, cancellationReason: 'required', noShowReason: 'required' });
    seed('appointment.transition', { id: 'legacy-appointment', requestId: 'no-show', expectedRevision: 1, policyRevision: 2,
      status: 'no-show', reason: 'PRIVATE_ORIGINAL_REASON' });
    const query = <T = unknown>(name: string, input: Record<string, unknown>): T => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
          runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)) as T;
      } finally { copy.close(); }
    };
    const oldRows = () => Object.fromEntries(Object.keys(CALENDAR_PARTICIPANT_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const additions = Object.keys(calendarRealm.tables).filter(name => !(name in CALENDAR_PARTICIPANT_TABLES));
    const upgrade = () => {
      for (const name of additions) db.defineTable(name, calendarRealm.tables[name]!);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = current.run(); expect(current.status().every(entry => entry.checksumMatches)).toBe(true); return applied; }
      finally { current.dispose(); }
    };
    return { db, raw, accepted, command, query, oldRows, additions, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('009 is additive over the actual pinned eight migration functions, registered checksums and complete 008 schema', () => {
  expect(calendarRealm.migrations.map(migration => migration.version)).toEqual([...versions, '009', '010', '011', '012', '013', '014', '015', '016']);
  expect(calendarRealm.migrations.slice(0, 8).map(hashMigration)).toEqual([...ORIGINAL_008_CHECKSUMS]);
  expect(calendarRealm.migrationChecksums.slice(0, 8)).toEqual(ORIGINAL_008_CHECKSUMS.map((checksum, index) => ({ version: versions[index], checksum })));
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_PARTICIPANT_TABLES))).toBe(ORIGINAL_008_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_PARTICIPANT_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  expect(Object.keys(calendarRealm.tables).length).toBeGreaterThan(Object.keys(CALENDAR_PARTICIPANT_TABLES).length);
});

test('populated 008 upgrade retains all families, exact receipts, sequences, SQL guards and legacy UTC policies without backfill', () => {
  const f = fixture();
  try {
    const before = f.oldRows(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const definitions = f.raw.query<{ type: string; name: string; sql: string }, []>(
      "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const appointment = f.query<CalendarAppointmentView>('appointment', { actor, id: 'legacy-typed-visit' });
    const hold = f.query<CalendarHoldView>('hold', { actor, id: 'legacy-hold' });
    const availability = f.query('availability', { actor, id: 'person' });
    for (const [table, rows] of Object.entries(before)) expect(rows.length, 'Seed every 008 family: ' + table).toBeGreaterThan(0);
    expect(f.upgrade()).toEqual(['009', '010', '011', '012', '013', '014', '015', '016']); expect(f.oldRows()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version<='008' ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    for (const table of f.additions) {
      if (table === '_calendar_appointment_resource_state') expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([{ id: 'application', version: 16 }]);
      else if (table === '_calendar_appointment_resource_current') expect(f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(
        f.raw.query('SELECT r.id,r.scope_id,r.appointment_id,r.resource_id,a.revision AS binding_revision FROM _calendar_reservations r JOIN calendar_appointments a ON a.scope_id=r.scope_id AND a.id=r.appointment_id ORDER BY r.id').all());
      else expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
    expect(f.query<unknown>('availability', { actor, id: 'person' })).toEqual(availability);
    expect(f.query<CalendarAppointmentView>('appointment', { actor, id: 'legacy-typed-visit' })).toEqual(appointment);
    expect(f.query<CalendarHoldView>('hold', { actor, id: 'legacy-hold' })).toEqual(hold);
    expect(f.query('appointmentParticipants', { actor, id: 'legacy-typed-visit' })).toMatchObject({ revision: 2,
      references: [...participants, { kind: 'guardian-user', userId: 'second-participant' }] });
    expect(f.query('holdParticipants', { actor, id: 'legacy-hold' })).toMatchObject({ revision: 1, references: participants });
    for (const replay of f.accepted) {
      expect(f.query<CalendarCommandReceipt>('receipt', { actor, requestId: replay.receipt.requestId })).toEqual(replay.receipt);
      expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    }
    expect(f.oldRows()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    expect(() => f.raw.run('UPDATE _calendar_availability_history SET windows_json=windows_json')).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_receipts')).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_appointment_participant_bindings')).toThrow();
    expect(f.oldRows()).toEqual(before); expect(f.upgrade()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); expect(() => f.raw.query('SELECT 1').get()).toThrow(); }
}, 20_000);
