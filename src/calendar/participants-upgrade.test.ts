/** Populated 007 -> 008 through the real memory migrator. No files, backups, actors, caches or output. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarAppointmentView, CalendarCommandReceipt, CalendarHoldView, CalendarParticipantReference } from './contracts';
import { calendarRealm } from './realm';
import { CALENDAR_PARTICIPANT_ADDITIONS, CALENDAR_PARTICIPANT_TABLES } from './realm-participant-bindings-migration';
import { CALENDAR_INTEGRATION_ADDITIONS } from './realm-integrations-migration';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { CALENDAR_VISIT_TABLES } from './realm-visit-bindings-migration';

// Recorded from actual functions and the complete declaration before 008 was
// introduced. Never derive replacement historical identities from current code.
const ORIGINAL_007_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
  'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
  'e77be92766070b2da02fb306de1f8694c5714b7ef173c995c198f336ca7c2a10',
  'a38cc0a9ee67b8dcba14583ed27df66fbd8c6b78010110daefac4042af53eca0',
  'e36da6d58e7345c042829228d96a50c7799c1f2b9a4c5135294718e5ff4c0681',
] as const;
const ORIGINAL_007_TABLES = 'f7663cf08f0f844f10394fc366589ca7d16fcb02aa6aa8124aa143c5214c184f';
const actor: CalendarActor = { scopeId: 'tenant:synthetic-participants-upgrade', userId: 'owner', principal: 'upgrade-session', manageAll: true, createOwn: true };
const typeReference = { id: 'legacy-type', revision: 1 };
const typeSnapshot = { ...typeReference, label: 'PRIVATE_ORIGINAL_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'type.blue' };
const locationSnapshot = { id: 'legacy-location', revision: 1, label: 'PRIVATE_ORIGINAL_LOCATION', region: 'US-IN' };
const visit = { mode: 'in-person', location: { id: locationSnapshot.id, revision: 1 } } as const;
const visitSnapshot = { mode: 'in-person', location: locationSnapshot };
const resourceIds = ['person'];
interface BoundReferences { readonly id: string; readonly revision: number; readonly references: readonly CalendarParticipantReference[] }
const timed = (hour: number) => ({ startAt: `2030-01-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
  endAt: `2030-01-01T${String(hour + 1).padStart(2, '0')}:00:00.000Z`, timeZone: 'UTC' });

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    // Both the writer and every readonly query snapshot remain native memory
    // handles. Register closure before any seeding; setup failure compensates.
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(CALENDAR_VISIT_TABLES)) db.defineTable(name, schema);
    // Empty current-handler support only; not historical migration evidence.
    db.defineTable('_calendar_integration_policy_history', CALENDAR_INTEGRATION_ADDITIONS._calendar_integration_policy_history!);
    db.defineTable('_calendar_integration_policy_current', CALENDAR_INTEGRATION_ADDITIONS._calendar_integration_policy_current!);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 7), createBackups: false, log() {} });
    try { expect(historical.run()).toEqual(['001', '002', '003', '004', '005', '006', '007']); } finally { historical.dispose(); }
    expect(raw.query("SELECT name FROM sqlite_master WHERE name LIKE '%participant%'").all()).toEqual([]);

    const accepted: { name: string; input: Record<string, unknown>; receipt: CalendarCommandReceipt }[] = [];
    const command = (name: string, input: Record<string, unknown>): CalendarCommandReceipt => {
      const result = runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      if (result === null || typeof result !== 'object' || Array.isArray(result) || !('ok' in result) || result.ok !== true || !('value' in result)) throw new Error('Expected accepted calendar command: ' + name + ' ' + JSON.stringify(result));
      return result.value as unknown as CalendarCommandReceipt;
    };
    const seed = (name: string, input: Record<string, unknown>) => {
      const complete = { actor, ...input }, receipt = command(name, complete);
      accepted.push({ name, input: complete, receipt }); return receipt;
    };
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-owner' });
    // No participant table exists while these genuine accepted 007 facts and
    // typed/visit/untyped intent digests are written. Omitted participant fields
    // must not force a pre-install of 008 or synthesize historical receipts.
    seed('resource.create', { id: 'person', requestId: 'resource', label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    seed('resource.grant', { id: 'person', requestId: 'grant', expectedRevision: 1, userId: 'delegate', grants: ['busy', 'details'] });
    seed('location.create', { id: locationSnapshot.id, requestId: 'location', label: locationSnapshot.label, region: locationSnapshot.region });
    seed('resource.locations', { id: 'person', requestId: 'resource-locations', expectedRevision: 2, locationIds: [locationSnapshot.id] });
    seed('resource.availability', { id: 'person', requestId: 'availability', expectedRevision: 3, mode: 'windows',
      windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' }] });
    seed('type.create', { id: typeReference.id, requestId: 'type', label: typeSnapshot.label, durationMinutes: 60,
      bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: typeSnapshot.colorKey });
    seed('resource.types', { id: 'person', requestId: 'resource-types', expectedRevision: 4, mode: 'optional', typeIds: [typeReference.id] });
    seed('appointment.create', { id: 'legacy-appointment', requestId: 'appointment', title: 'PRIVATE_ORIGINAL_APPOINTMENT', resourceIds, ...timed(8) });
    seed('appointment.create', { id: 'legacy-typed-appointment', requestId: 'typed-appointment', title: 'PRIVATE_TYPED_APPOINTMENT', resourceIds,
      ...timed(10), appointmentType: typeReference });
    seed('appointment.create', { id: 'legacy-typed-visit', requestId: 'typed-visit', title: 'PRIVATE_TYPED_VISIT', resourceIds,
      ...timed(12), appointmentType: typeReference, visit });
    seed('appointment.reschedule', { id: 'legacy-typed-visit', requestId: 'visit-change', expectedRevision: 1, ...timed(12),
      bufferBeforeMinutes: 5, bufferAfterMinutes: 10, visit: { mode: 'video' } });
    seed('appointment.reschedule', { id: 'legacy-typed-visit', requestId: 'visit-restore', expectedRevision: 2, ...timed(12),
      bufferBeforeMinutes: 5, bufferAfterMinutes: 10, visit });
    seed('hold.acquire', { id: 'legacy-hold', requestId: 'hold', resourceIds, ...timed(14), ttlSeconds: 300 });
    seed('hold.acquire', { id: 'legacy-typed-hold', requestId: 'typed-hold', resourceIds, ...timed(16), ttlSeconds: 300, appointmentType: typeReference, visit });
    seed('block.create', { id: 'legacy-block', requestId: 'block', title: 'PRIVATE_ORIGINAL_BLOCK', resourceIds, ...timed(18) });
    seed('lifecycle.replace', { requestId: 'lifecycle-policy', expectedRevision: 1, extended: true, cancellationReason: 'required', noShowReason: 'required' });
    seed('appointment.transition', { id: 'legacy-typed-appointment', requestId: 'no-show', expectedRevision: 1, policyRevision: 2, status: 'no-show', reason: 'PRIVATE_NO_SHOW_REASON' });

    const query = <T = unknown>(name: string, input: Record<string, unknown>): T => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
          runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)) as T;
      } finally { copy.close(); }
    };
    const legacy = () => Object.fromEntries(Object.keys(CALENDAR_VISIT_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const upgrade = () => {
      for (const [name, schema] of Object.entries(calendarRealm.tables)) if (!(name in CALENDAR_VISIT_TABLES)) db.defineTable(name, schema);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = current.run(); expect(current.status().every(entry => entry.checksumMatches)).toBe(true); return applied; } finally { current.dispose(); }
    };
    return { db, raw, accepted, command, query, legacy, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('008 is additive over pinned seven migration functions, registered checksums and the full 007 declaration', () => {
  expect(calendarRealm.migrations.map(migration => migration.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014']);
  expect(calendarRealm.migrations.slice(0, 7).map(hashMigration)).toEqual([...ORIGINAL_007_CHECKSUMS]);
  expect(calendarRealm.migrationChecksums.slice(0, 7)).toEqual(ORIGINAL_007_CHECKSUMS.map((checksum, index) => ({ version: String(index + 1).padStart(3, '0'), checksum })));
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_VISIT_TABLES))).toBe(ORIGINAL_007_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_VISIT_TABLES)) expect(CALENDAR_PARTICIPANT_TABLES[name]).toEqual(schema);
  expect(Object.keys(CALENDAR_PARTICIPANT_TABLES).filter(name => !(name in CALENDAR_VISIT_TABLES))).toEqual([
    '_calendar_appointment_participant_bindings', '_calendar_appointment_participant_current', '_calendar_hold_participant_bindings',
  ]);
  expect(calendarRealm.tables).toEqual(CALENDAR_INTEGRATION_INSPECTION_TABLES);
});

test('real populated 007 upgrade preserves every row, definition, ledger, sequence, typed visit and accepted digest without participant backfill', () => {
  const f = fixture();
  try {
    const before = f.legacy(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const definitions = f.raw.query<{ type: string; name: string; sql: string }, []>("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    for (const table of Object.keys(CALENDAR_VISIT_TABLES)) expect(before[table]!.length).toBeGreaterThan(0);
    expect(f.upgrade()).toEqual(['008', '009', '010', '011', '012', '013', '014']); expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version IN ('001','002','003','004','005','006','007') ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.query<CalendarAppointmentView>('appointment', { actor, id: 'legacy-typed-visit' })).toMatchObject({ id: 'legacy-typed-visit', revision: 3,
      appointmentType: typeSnapshot, visit: visitSnapshot });
    expect(f.query<CalendarHoldView>('hold', { actor, id: 'legacy-typed-hold' })).toMatchObject({ id: 'legacy-typed-hold', revision: 1,
      appointmentType: typeSnapshot, visit: visitSnapshot });
    for (const id of ['legacy-appointment', 'legacy-typed-appointment', 'legacy-typed-visit']) {
      expect(f.query<BoundReferences>('appointmentParticipants', { actor, id })).toEqual({ id, revision: id === 'legacy-typed-visit' ? 3 : id === 'legacy-typed-appointment' ? 2 : 1, references: [] });
      expect(f.query('appointment', { actor, id })).not.toHaveProperty('participants');
    }
    for (const id of ['legacy-hold', 'legacy-typed-hold']) {
      expect(f.query<BoundReferences>('holdParticipants', { actor, id })).toEqual({ id, revision: 1, references: [] });
      expect(f.query('hold', { actor, id })).not.toHaveProperty('participants');
    }
    for (const replay of f.accepted) {
      expect(f.query<CalendarCommandReceipt>('receipt', { actor, requestId: replay.receipt.requestId })).toEqual(replay.receipt);
      expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    }
    for (const table of Object.keys(CALENDAR_PARTICIPANT_ADDITIONS)) expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.db.get('_calendar_usage', 'appointmentParticipantHistory')).toBeNull();
    expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.upgrade()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); expect(() => f.raw.query('SELECT 1').get()).toThrow(); }
}, 20_000);

test('upgraded typed visits acquire participants only through an explicit new revision and preserve old accepted intent evidence', () => {
  const f = fixture();
  try {
    f.upgrade(); const before = f.legacy();
    const input = { actor, id: 'legacy-typed-visit', requestId: 'attach-participants', expectedRevision: 3,
      references: [{ kind: 'guardian-user' as const, userId: 'canonical-non-provider' }] };
    const receipt = f.command('appointment.participants', input), seq = f.db.currentSeq;
    expect(receipt).toMatchObject({ requestId: input.requestId, id: input.id, revision: 4, changed: true });
    expect(f.query<BoundReferences>('appointmentParticipants', { actor, id: input.id })).toEqual({ id: input.id, revision: 4, references: input.references });
    const appointment = f.query<CalendarAppointmentView>('appointment', { actor, id: input.id });
    expect(appointment).toMatchObject({ revision: 4, appointmentType: typeSnapshot, visit: visitSnapshot });
    expect(appointment).not.toHaveProperty('participants');
    expect(f.raw.query('SELECT appointment_id,appointment_revision,references_json FROM _calendar_appointment_participant_bindings').all()).toEqual([
      { appointment_id: input.id, appointment_revision: 4, references_json: JSON.stringify(input.references) },
    ]);
    expect(f.raw.query('SELECT * FROM _calendar_hold_participant_bindings').all()).toEqual([]);
    for (const [table, rows] of Object.entries(before)) if (!['calendar_appointments', '_calendar_receipts', '_calendar_effect_intents', '_calendar_usage'].includes(table))
      expect(f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(rows);
    expect(f.command('appointment.participants', input)).toEqual(receipt);
    for (const replay of f.accepted) expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    expect(f.db.currentSeq).toBe(seq); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); expect(() => f.raw.query('SELECT 1').get()).toThrow(); }
}, 20_000);

test('populated retained participant history keeps current and hold reads indexed without scanning old generations', () => {
  const f = fixture();
  try {
    f.upgrade();
    const originalVisits = f.raw.query('SELECT * FROM _calendar_appointment_visit_bindings ORDER BY id').all();
    let revision = 3;
    for (let generation = 0; generation < 128; generation++) {
      const references = [{ kind: 'guardian-user' as const, userId: generation % 2 ? 'retained-a' : 'retained-b' }];
      const receipt = f.command('appointment.participants', { actor, id: 'legacy-typed-visit', requestId: 'retained-participants-' + generation,
        expectedRevision: revision, references });
      expect(receipt).toMatchObject({ revision: ++revision, changed: true });
    }
    expect(f.raw.query('SELECT count(*) AS count FROM _calendar_appointment_participant_bindings').get()).toEqual({ count: 128 });
    expect(f.raw.query('SELECT count(*) AS count FROM _calendar_appointment_participant_current').get()).toEqual({ count: 1 });
    expect(f.query<BoundReferences>('appointmentParticipants', { actor, id: 'legacy-typed-visit' })).toEqual({ id: 'legacy-typed-visit', revision,
      references: [{ kind: 'guardian-user', userId: 'retained-a' }] });
    expect(f.db.get('_calendar_usage', 'appointmentParticipantHistory')).toMatchObject({ count: 128 });
    const currentSql = `SELECT b.* FROM _calendar_appointment_participant_current p
      JOIN _calendar_appointment_participant_bindings b ON b.id=p.binding_id AND b.scope_id=p.scope_id AND b.appointment_id=p.appointment_id
      WHERE p.scope_id=? AND p.appointment_id=?`;
    const currentPlan = f.raw.query<{ detail: string }, [string, string]>('EXPLAIN QUERY PLAN ' + currentSql)
      .all(actor.scopeId, 'legacy-typed-visit').map(row => row.detail).join('\n');
    expect(currentPlan).toMatch(/SEARCH p USING INDEX calendar_appointment_participant_current_identity/);
    expect(currentPlan).toMatch(/SEARCH b USING INDEX sqlite_autoindex__calendar_appointment_participant_bindings_1/);
    expect(currentPlan).not.toMatch(/SCAN (?:p|b)\b/);
    expect(f.raw.query(currentSql).get('tenant:unrelated', 'legacy-typed-visit')).toBeNull();

    const references = [{ kind: 'guardian-user' as const, userId: 'retained-hold-subject' }];
    f.command('hold.acquire', { actor, id: 'new-participant-hold', requestId: 'new-participant-hold', resourceIds,
      ...timed(20), ttlSeconds: 300, participants: references });
    expect(f.query<BoundReferences>('holdParticipants', { actor, id: 'new-participant-hold' })).toEqual({ id: 'new-participant-hold', revision: 1, references });
    const holdPlan = f.raw.query<{ detail: string }, [string, string]>(
      'EXPLAIN QUERY PLAN SELECT * FROM _calendar_hold_participant_bindings WHERE scope_id=? AND hold_id=?')
      .all(actor.scopeId, 'new-participant-hold').map(row => row.detail).join('\n');
    expect(holdPlan).toContain('SEARCH _calendar_hold_participant_bindings USING INDEX calendar_hold_participant_binding_identity');
    expect(holdPlan).not.toMatch(/SCAN _calendar_hold_participant_bindings/);
    expect(f.raw.query('SELECT * FROM _calendar_appointment_visit_bindings ORDER BY id').all()).toEqual(originalVisits);
    expect(f.query<CalendarAppointmentView>('appointment', { actor, id: 'legacy-typed-visit' })).toMatchObject({ revision,
      appointmentType: typeSnapshot, visit: visitSnapshot });
    const seq = f.db.currentSeq;
    for (const replay of f.accepted) expect(f.command(replay.name, replay.input)).toEqual(replay.receipt);
    expect(f.db.currentSeq).toBe(seq); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); expect(() => f.raw.query('SELECT 1').get()).toThrow(); }
}, 20_000);
