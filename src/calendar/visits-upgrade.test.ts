/** Populated 006 -> 007 through the real memory migrator. No files, backups, actors, caches or output. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarAppointmentView, CalendarCommandReceipt, CalendarHoldView, CalendarLocationPage, CalendarLifecyclePolicy } from './contracts';
import { calendarRealm } from './realm';
import { CALENDAR_LIFECYCLE_TABLES } from './realm-lifecycle-migration';
import { CALENDAR_PARTICIPANT_TABLES } from './realm-participant-bindings-migration';
import { CALENDAR_VISIT_ADDITIONS, CALENDAR_VISIT_TABLES } from './realm-visit-bindings-migration';

// Recorded before 007 was introduced. Never derive replacement historical
// checksums from the current functions in order to grandfather a source change.
const ORIGINAL_006_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
  'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
  'e77be92766070b2da02fb306de1f8694c5714b7ef173c995c198f336ca7c2a10',
  'a38cc0a9ee67b8dcba14583ed27df66fbd8c6b78010110daefac4042af53eca0',
] as const;
const ORIGINAL_006_TABLES = '0a2cd10272f0f865fbdca930f5df7195aa526d1fcc5f88754e176251b75fb990';
const actor: CalendarActor = { scopeId: 'tenant:synthetic-visits-upgrade', userId: 'owner', principal: 'upgrade-session', manageAll: true, createOwn: true };
const typeReference = { id: 'legacy-type', revision: 1 };
const typeSnapshot = { ...typeReference, label: 'PRIVATE_ORIGINAL_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'type.blue' };
const locationSnapshot = { id: 'legacy-location', revision: 1, label: 'PRIVATE_ORIGINAL_LOCATION', region: 'US-IN' };
const timed = (hour: number) => ({ startAt: `2030-01-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
  endAt: `2030-01-01T${String(hour + 1).padStart(2, '0')}:00:00.000Z`, timeZone: 'UTC' });
const resourceIds = ['person'];
const lifecycleReason = 'PRIVATE_ORIGINAL_NO_SHOW_REASON';

function fixture() {
  // No temporary paths exist: every SQLite handle, including query snapshots,
  // is in memory and closes in finally or setup compensation.
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(CALENDAR_LIFECYCLE_TABLES)) db.defineTable(name, schema);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 6), createBackups: false, log() {} });
    try { expect(historical.run()).toEqual(['001', '002', '003', '004', '005', '006']); } finally { historical.dispose(); }
    expect(raw.query("SELECT name FROM sqlite_master WHERE name IN ('_calendar_appointment_visit_bindings','_calendar_appointment_visit_current','_calendar_hold_visit_bindings')").all()).toEqual([]);

    const accepted: { name: string; input: Record<string, unknown>; receipt: CalendarCommandReceipt }[] = [];
    const command = (name: string, input: Record<string, unknown>): CalendarCommandReceipt => {
      const result = runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      if (result === null || typeof result !== 'object' || Array.isArray(result) || !('ok' in result) || result.ok !== true || !('value' in result)) throw new Error('Expected accepted calendar command');
      return result.value as unknown as CalendarCommandReceipt;
    };
    const seed = (name: string, input: Record<string, unknown>) => {
      const complete = { actor, ...input }, receipt = command(name, complete);
      accepted.push({ name, input: complete, receipt }); return receipt;
    };
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-owner' });
    // All accepted facts below are written before any 007 table exists. Current
    // no-visit creation/status handlers still implement these exact 006 intents;
    // if they begin depending on new tables this fixture must fail, not preinstall
    // 007 or fabricate replacement historical evidence to make setup pass.
    seed('resource.create', { id: 'person', requestId: 'resource', label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    seed('resource.grant', { id: 'person', requestId: 'grant', expectedRevision: 1, userId: 'delegate', grants: ['busy', 'details'] });
    seed('location.create', { id: locationSnapshot.id, requestId: 'location', label: locationSnapshot.label, region: locationSnapshot.region });
    seed('resource.locations', { id: 'person', requestId: 'resource-locations', expectedRevision: 2, locationIds: [locationSnapshot.id] });
    seed('resource.availability', { id: 'person', requestId: 'availability', expectedRevision: 3, mode: 'windows',
      windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' }] });
    seed('type.create', { id: typeReference.id, requestId: 'type', label: typeSnapshot.label, durationMinutes: 60,
      bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: typeSnapshot.colorKey });
    seed('resource.types', { id: 'person', requestId: 'resource-types', expectedRevision: 4, mode: 'optional', typeIds: [typeReference.id] });
    seed('appointment.create', { id: 'legacy-appointment', requestId: 'appointment', title: 'PRIVATE_ORIGINAL_APPOINTMENT', resourceIds, ...timed(10) });
    seed('appointment.create', { id: 'legacy-typed-appointment', requestId: 'typed-appointment', title: 'PRIVATE_TYPED_APPOINTMENT', resourceIds,
      ...timed(12), appointmentType: typeReference });
    seed('hold.acquire', { id: 'legacy-hold', requestId: 'hold', resourceIds, ...timed(14), ttlSeconds: 300 });
    seed('hold.acquire', { id: 'legacy-typed-hold', requestId: 'typed-hold', resourceIds, ...timed(16), ttlSeconds: 300, appointmentType: typeReference });
    seed('block.create', { id: 'legacy-block', requestId: 'block', title: 'PRIVATE_ORIGINAL_BLOCK', resourceIds, ...timed(18) });
    seed('lifecycle.replace', { requestId: 'lifecycle-policy', expectedRevision: 1, extended: true, cancellationReason: 'required', noShowReason: 'required' });
    seed('appointment.transition', { id: 'legacy-typed-appointment', requestId: 'no-show', expectedRevision: 1, policyRevision: 2, status: 'no-show', reason: lifecycleReason });

    const query = <T>(name: string, input: Record<string, unknown>): T => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
          runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)) as T;
      } finally { copy.close(); }
    };
    const legacy = () => Object.fromEntries(Object.keys(CALENDAR_LIFECYCLE_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const upgrade = () => {
      for (const [name, schema] of Object.entries(calendarRealm.tables)) if (!(name in CALENDAR_LIFECYCLE_TABLES)) db.defineTable(name, schema);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = current.run(); expect(current.status().every(entry => entry.checksumMatches)).toBe(true); return applied; } finally { current.dispose(); }
    };
    return { db, raw, accepted, command, query, legacy, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('007 is additive over the pinned six migration functions, registered checksums and complete 006 declaration', () => {
  expect(calendarRealm.migrations.map(migration => migration.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008']);
  expect(calendarRealm.migrations.slice(0, 6).map(hashMigration)).toEqual([...ORIGINAL_006_CHECKSUMS]);
  expect(calendarRealm.migrationChecksums.slice(0, 6)).toEqual(ORIGINAL_006_CHECKSUMS.map((checksum, index) => ({ version: String(index + 1).padStart(3, '0'), checksum })));
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_LIFECYCLE_TABLES))).toBe(ORIGINAL_006_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_LIFECYCLE_TABLES)) expect(CALENDAR_VISIT_TABLES[name]).toEqual(schema);
  expect(Object.keys(CALENDAR_VISIT_TABLES).filter(name => !(name in CALENDAR_LIFECYCLE_TABLES))).toEqual([
    '_calendar_appointment_visit_bindings', '_calendar_appointment_visit_current', '_calendar_hold_visit_bindings',
  ]);
  expect(calendarRealm.tables).toEqual(CALENDAR_PARTICIPANT_TABLES);
});

test('real populated 006 upgrade preserves all rows, ledgers, definitions, sequence and typed/untyped receipts without visit backfill', () => {
  const f = fixture();
  try {
    const before = f.legacy(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const definitions = f.raw.query<{ type: string; name: string; sql: string }, []>("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    for (const table of Object.keys(CALENDAR_LIFECYCLE_TABLES)) expect(before[table]!.length).toBeGreaterThan(0);
    expect(f.upgrade()).toEqual(['007', '008']); expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version IN ('001','002','003','004','005','006') ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.query<CalendarLifecyclePolicy>('lifecycle', { actor })).toEqual({ revision: 2, extended: true, cancellationReason: 'required', noShowReason: 'required' });
    const appointment = f.query<CalendarAppointmentView>('appointment', { actor, id: 'legacy-appointment' });
    expect(appointment).toMatchObject({ id: 'legacy-appointment', revision: 1, status: 'confirmed' });
    expect(appointment).not.toHaveProperty('visit'); expect(appointment).not.toHaveProperty('appointmentType');
    const typed = f.query<CalendarAppointmentView>('appointment', { actor, id: 'legacy-typed-appointment' });
    expect(typed).toMatchObject({ id: 'legacy-typed-appointment', revision: 2, status: 'confirmed', appointmentType: typeSnapshot,
      lifecycle: { revision: 2, policyRevision: 2, status: 'no-show', reason: lifecycleReason } });
    expect(typed).not.toHaveProperty('visit');
    for (const id of ['legacy-hold', 'legacy-typed-hold']) {
      const hold = f.query<CalendarHoldView>('hold', { actor, id });
      expect(hold).toMatchObject({ id, revision: 1, status: 'held' }); expect(hold).not.toHaveProperty('visit');
      if (id === 'legacy-typed-hold') expect(hold.appointmentType).toEqual(typeSnapshot);
      else expect(hold).not.toHaveProperty('appointmentType');
    }
    expect(f.query<CalendarLocationPage>('visitLocations', { actor, resourceIds })).toEqual({ items: [{ ...locationSnapshot, active: true }], truncated: false, nextAfter: null });
    for (const replay of f.accepted) {
      expect(f.query<CalendarCommandReceipt>('receipt', { actor, requestId: replay.receipt.requestId })).toEqual(replay.receipt);
      expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    }
    for (const table of Object.keys(CALENDAR_VISIT_ADDITIONS)) expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.db.get('_calendar_usage', 'appointmentVisitHistory')).toBeNull();
    expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.upgrade()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); expect(() => f.raw.query('SELECT 1').get()).toThrow(); }
}, 20_000);

test('upgraded legacy appointments acquire a visit only through an explicit new revision, while old accepted intents remain replayable', () => {
  const f = fixture();
  try {
    f.upgrade();
    const input = { actor, id: 'legacy-appointment', requestId: 'attach-visit', expectedRevision: 1, ...timed(10),
      bufferBeforeMinutes: 0, bufferAfterMinutes: 0, visit: { mode: 'in-person', location: { id: locationSnapshot.id, revision: 1 } } };
    const receipt = f.command('appointment.reschedule', input), seq = f.db.currentSeq;
    expect(receipt).toEqual({ requestId: 'attach-visit', operation: 'appointment.rescheduled', id: 'legacy-appointment', revision: 2, changed: true });
    expect(f.query<CalendarAppointmentView>('appointment', { actor, id: input.id })).toMatchObject({ revision: 2, visit: { mode: 'in-person', location: locationSnapshot } });
    expect(f.raw.query('SELECT appointment_id,appointment_revision,visit_mode,location_id,location_revision FROM _calendar_appointment_visit_bindings').all()).toEqual([
      { appointment_id: input.id, appointment_revision: 2, visit_mode: 'in-person', location_id: locationSnapshot.id, location_revision: 1 },
    ]);
    expect(f.raw.query('SELECT * FROM _calendar_hold_visit_bindings').all()).toEqual([]);
    expect(f.query<CalendarAppointmentView>('appointment', { actor, id: 'legacy-typed-appointment' })).not.toHaveProperty('visit');
    expect(f.command('appointment.reschedule', input)).toEqual(receipt);
    for (const replay of f.accepted) expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    expect(f.db.currentSeq).toBe(seq); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); expect(() => f.raw.query('SELECT 1').get()).toThrow(); }
}, 20_000);
