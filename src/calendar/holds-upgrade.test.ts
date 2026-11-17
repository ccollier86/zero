/** Populated 002 -> 003 qualification. All databases and migration evidence stay in native memory. */
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
import { readCalendarRejection } from './error';
import { calendarRealm } from './realm';
import { grantId, reservationId } from './realm-model';
import { CALENDAR_HOLD_TABLES, CALENDAR_LOCATION_TABLES, CALENDAR_SCHEDULING_TABLES, CALENDAR_TABLES } from './realm-schema';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash, calendarJson } from './validation';

// Source identities recorded independently before the authenticated-hold implementation.
const ORIGINAL_001_CHECKSUM = '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795';
const ORIGINAL_002_CHECKSUM = '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f';
const ORIGINAL_001_TABLES = '7ee1126feee7d9d62183a9de968fab0d27254ee32081ad4ad8e1b723346cfd24';
const ORIGINAL_002_TABLES = '9db0660cda239f4624a80c2f3cb22c41050286eaf644be83b11b9daf151a3bb9';
const actor: CalendarActor = { scopeId: 'tenant:synthetic-hold-upgrade', principal: 'synthetic-hold-upgrade-session', userId: 'synthetic-owner', manageAll: false, createOwn: true };
const legacyAppointment = { actor, requestId: 'legacy-appointment', id: 'legacy-appointment', resourceIds: ['person'], title: 'PRIVATE_LEGACY_APPOINTMENT',
  startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
const legacyBlock = { actor, requestId: 'legacy-block', id: 'legacy-block', resourceIds: ['person'], title: 'PRIVATE_LEGACY_BLOCK',
  startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };
const policy = { mode: 'windows' as const, windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' }] };
const holdInput = { actor, requestId: 'new-hold', id: 'new-hold', resourceIds: ['person', 'room'],
  startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10, ttlSeconds: 300 };

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [table, schema] of Object.entries(CALENDAR_SCHEDULING_TABLES)) db.defineTable(table, schema);
    const initial = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 2), createBackups: false, log() {} });
    try { expect(initial.run()).toEqual(['001', '002']); } finally { initial.dispose(); }

    // Populate exact 002 records without invoking current handlers that already depend on 003.
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-calendar-owner' });
    for (const id of ['person', 'room']) db.createStrict('calendar_resources', { id, scope_id: actor.scopeId, label: 'Synthetic ' + id,
      kind: id === 'person' ? 'person' : 'room', owner_id: actor.userId, time_zone: 'UTC', revision: 1, active: 1 });
    const saved = new Map<string, CalendarCommandReceipt>();
    const saveReceipt = (requestId: string, intent: unknown, targetKind: 'resource' | 'appointment' | 'block', right: 'manage' | 'book', result: CalendarCommandReceipt) => {
      const id = calendarHash([actor.scopeId, actor.principal, requestId]), block = targetKind === 'block';
      db.createStrict(block ? '_calendar_block_receipts' : '_calendar_receipts', { id, scope_id: actor.scopeId, principal: actor.principal, request_id: requestId,
        digest: calendarHash(intent), result_json: calendarJson(result), target_kind: targetKind, target_id: result.id, required_right: right });
      db.createStrict(block ? '_calendar_block_effect_intents' : '_calendar_effect_intents', { id, scope_id: actor.scopeId, receipt_id: id,
        operation: result.operation, target_kind: targetKind, target_id: result.id, revision: result.revision });
      saved.set(requestId, result);
    };
    saveReceipt('legacy-resource', ['resource.create', 'person', 'Synthetic person', 'person', actor.userId, 'UTC'], 'resource', 'manage',
      { requestId: 'legacy-resource', operation: 'resource.created', id: 'person', revision: 1, changed: true });
    db.createStrict('_calendar_grants', { id: grantId(actor.scopeId, 'person', 'synthetic-delegate'), scope_id: actor.scopeId, resource_id: 'person',
      user_id: 'synthetic-delegate', busy: 1, details: 1, book: 0, manage: 0 });
    db.update('calendar_resources', 'person', { revision: 2 });
    saveReceipt('legacy-grant', ['resource.grant', 'person', 1, 'synthetic-delegate', ['busy', 'details']], 'resource', 'manage',
      { requestId: 'legacy-grant', operation: 'resource.grant-changed', id: 'person', revision: 2, changed: true });
    db.update('calendar_resources', 'person', { revision: 3 });
    db.createStrict('_calendar_availability_history', { id: calendarHash([actor.scopeId, 'person', 3]), scope_id: actor.scopeId,
      resource_id: 'person', policy_revision: 3, mode: policy.mode, windows_json: calendarJson(policy.windows) });
    db.createStrict('_calendar_availability', { id: 'person', scope_id: actor.scopeId, resource_id: 'person', policy_revision: 3 });
    saveReceipt('legacy-policy', ['resource.availability', 'person', 2, policy], 'resource', 'manage',
      { requestId: 'legacy-policy', operation: 'resource.availability-changed', id: 'person', revision: 3, changed: true });

    const interval = normalizeCalendarTimedInterval({ startAt: legacyAppointment.startAt, endAt: legacyAppointment.endAt, timeZone: legacyAppointment.timeZone,
      bufferBeforeMinutes: legacyAppointment.bufferBeforeMinutes, bufferAfterMinutes: legacyAppointment.bufferAfterMinutes });
    db.createStrict('calendar_appointments', { id: legacyAppointment.id, scope_id: actor.scopeId, title: legacyAppointment.title,
      start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone,
      buffer_before: interval.bufferBeforeMinutes, buffer_after: interval.bufferAfterMinutes, occupied_start_ms: interval.occupiedStartMs,
      occupied_end_ms: interval.occupiedEndMs, status: 'confirmed', revision: 1, created_by: actor.userId });
    db.createStrict('_calendar_reservations', { id: reservationId(actor.scopeId, legacyAppointment.id, 'person'), scope_id: actor.scopeId,
      appointment_id: legacyAppointment.id, resource_id: 'person', occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, active: 1 });
    saveReceipt(legacyAppointment.requestId, ['appointment.create', legacyAppointment.id, ['person'], legacyAppointment.title, interval], 'appointment', 'book',
      { requestId: legacyAppointment.requestId, operation: 'appointment.created', id: legacyAppointment.id, revision: 1, changed: true });
    const blocked = normalizeCalendarTimedInterval({ startAt: legacyBlock.startAt, endAt: legacyBlock.endAt, timeZone: legacyBlock.timeZone,
      bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    db.createStrict('calendar_blocks', { id: legacyBlock.id, scope_id: actor.scopeId, title: legacyBlock.title, start_at: blocked.startAt,
      end_at: blocked.endAt, start_ms: blocked.startMs, end_ms: blocked.endMs, time_zone: blocked.timeZone, status: 'active', revision: 1, created_by: actor.userId });
    db.createStrict('_calendar_block_reservations', { id: blockReservationId(actor.scopeId, legacyBlock.id, 'person'), scope_id: actor.scopeId,
      block_id: legacyBlock.id, resource_id: 'person', occupied_start_ms: blocked.startMs, occupied_end_ms: blocked.endMs, active: 1 });
    saveReceipt(legacyBlock.requestId, ['block.create', legacyBlock.id, ['person'], legacyBlock.title, blocked], 'block', 'manage',
      { requestId: legacyBlock.requestId, operation: 'block.created', id: legacyBlock.id, revision: 1, changed: true });
    for (const [id, count] of [['resources', 2], ['appointments', 1], ['blocks', 1], ['receipts', 5]] as const) db.createStrict('_calendar_usage', { id, count });

    const command = (name: string, input: unknown): CalendarCommandReceipt => {
      const result = runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      if (result === null || typeof result !== 'object' || Array.isArray(result) || !('ok' in result) || result.ok !== true || !('value' in result)) throw new Error('Expected accepted calendar command');
      return result.value as unknown as CalendarCommandReceipt;
    };
    const query = <T = DatabaseSerializableValue>(name: string, input: unknown): T => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
          runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)) as unknown as T;
      } finally { copy.close(); }
    };
    const legacyData = () => Object.fromEntries(Object.keys(CALENDAR_SCHEDULING_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const upgrade = () => {
      for (const [table, schema] of Object.entries(CALENDAR_LOCATION_TABLES)) if (!(table in CALENDAR_SCHEDULING_TABLES)) db.defineTable(table, schema);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try {
        const applied = current.run(); expect(current.status().every(entry => entry.checksumMatches)).toBe(true); return applied;
      } finally { current.dispose(); }
    };
    return { db, raw, command, query, legacyData, upgrade, saved, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('hold migration is additive while both original source functions and declaration generations remain frozen', () => {
  expect(calendarRealm.migrations.map(migration => migration.version)).toEqual(['001', '002', '003', '004']);
  expect(hashMigration(calendarRealm.migrations[0]!)).toBe(ORIGINAL_001_CHECKSUM);
  expect(hashMigration(calendarRealm.migrations[1]!)).toBe(ORIGINAL_002_CHECKSUM);
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_TABLES))).toBe(ORIGINAL_001_TABLES);
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_SCHEDULING_TABLES))).toBe(ORIGINAL_002_TABLES);
  expect(calendarRealm.migrationChecksums.slice(0, 2)).toEqual([
    { version: '001', checksum: ORIGINAL_001_CHECKSUM }, { version: '002', checksum: ORIGINAL_002_CHECKSUM },
  ]);
  for (const [table, schema] of Object.entries(CALENDAR_SCHEDULING_TABLES)) expect(CALENDAR_HOLD_TABLES[table]).toEqual(schema);
  expect(Object.keys(CALENDAR_HOLD_TABLES).filter(table => !(table in CALENDAR_SCHEDULING_TABLES))).toEqual([
    'calendar_holds', '_calendar_hold_reservations', '_calendar_hold_receipts', '_calendar_hold_effect_intents',
  ]);
  for (const [table, schema] of Object.entries(CALENDAR_HOLD_TABLES)) expect(calendarRealm.tables[table]).toEqual(schema);
});

test('real migrator upgrades populated 002 without rewriting either generation of evidence, triggers or receipt outcomes', () => {
  const f = fixture();
  try {
    const data = f.legacyData(), seq = f.db.currentSeq;
    const triggers = f.raw.query<{ name: string; sql: string }, []>("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    const ledger = f.raw.query("SELECT * FROM _migrations WHERE version IN ('001','002') ORDER BY version").all();
    expect(f.upgrade()).toEqual(['003', '004']); expect(f.legacyData()).toEqual(data); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version IN ('001','002') ORDER BY version").all()).toEqual(ledger);
    for (const trigger of triggers) expect(f.raw.query("SELECT name,sql FROM sqlite_master WHERE name=? AND type='trigger'").get(trigger.name)).toEqual(trigger);
    for (const [requestId, receipt] of f.saved) expect(f.query<CalendarCommandReceipt | null>('receipt', { actor, requestId })).toEqual(receipt);
    expect(f.command('appointment.create', legacyAppointment)).toEqual(f.saved.get(legacyAppointment.requestId)!);
    expect(f.command('block.create', legacyBlock)).toEqual(f.saved.get(legacyBlock.requestId)!);
    expect(f.command('resource.create', { actor, requestId: 'legacy-resource', id: 'person', label: 'Synthetic person', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' }))
      .toEqual(f.saved.get('legacy-resource')!);
    expect(f.command('resource.grant', { actor, requestId: 'legacy-grant', id: 'person', expectedRevision: 1, userId: 'synthetic-delegate', grants: ['details', 'busy'] }))
      .toEqual(f.saved.get('legacy-grant')!);
    expect(f.command('resource.availability', { actor, requestId: 'legacy-policy', id: 'person', expectedRevision: 2, ...policy })).toEqual(f.saved.get('legacy-policy')!);
    expect(f.legacyData()).toEqual(data); expect(f.db.currentSeq).toBe(seq);
    for (const table of ['calendar_holds', '_calendar_hold_reservations', '_calendar_hold_receipts', '_calendar_hold_effect_intents']) expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.upgrade()).toEqual([]); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('all three retained receipt stores reject global IDs and scoped request identity reuse in every direction', () => {
  const f = fixture();
  try {
    f.upgrade(); f.command('hold.acquire', holdInput);
    f.raw.run('PRAGMA recursive_triggers=OFF');
    const stores = ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts'] as const;
    const columns = ['id', 'scope_id', 'principal', 'request_id', 'digest', 'result_json', 'target_kind', 'target_id', 'required_right'];
    for (const target of stores) for (const source of stores) {
      if (source === target) continue;
      const template = f.raw.query<Record<string, string>, []>(`SELECT * FROM ${target} ORDER BY id LIMIT 1`).get()!;
      const identity = f.raw.query<Record<string, string>, []>(`SELECT * FROM ${source} ORDER BY id LIMIT 1`).get()!;
      // Independent global-ID collision, with a different principal and request key.
      // Independent scoped-principal-request collision, with a different global ID.
      for (const [id, principal, requestId] of [
        [identity.id, 'synthetic-unrelated-principal', 'synthetic-distinct-request'],
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
    for (const [name, input] of [
      ['hold.acquire', { ...holdInput, requestId: legacyAppointment.requestId }],
      ['hold.acquire', { ...holdInput, requestId: legacyBlock.requestId }],
      ['appointment.create', { ...legacyAppointment, requestId: holdInput.requestId }],
      ['block.create', { ...legacyBlock, requestId: holdInput.requestId }],
    ] as const) {
      let failure: unknown;
      try { f.command(name, input); } catch (error) { failure = error; }
      expect(readCalendarRejection(failure)?.code).toBe('CALENDAR_INTENT_CONFLICT');
    }
    const seq = f.db.currentSeq;
    expect(f.command('hold.acquire', holdInput)).toEqual({ requestId: holdInput.requestId, operation: 'hold.acquired', id: holdInput.id, revision: 1, changed: true });
    expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('hold evidence cannot be rewritten and acquired timing, subject and reservation snapshots cannot be mutated through SQL', () => {
  const f = fixture();
  try {
    f.upgrade(); f.command('hold.acquire', holdInput);
    f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const table of ['_calendar_hold_receipts', '_calendar_hold_effect_intents']) {
      const before = f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all(); expect(before.length).toBeGreaterThan(0);
      expect(() => f.raw.run(`UPDATE ${table} SET id=id`)).toThrow();
      expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
      expect(f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(before);
    }
    const beforeHold = f.db.get('calendar_holds', holdInput.id)!;
    for (const [field, value] of [
      ['id', 'another-hold'], ['scope_id', 'tenant:other'], ['principal', 'another-principal'], ['created_by', 'another-user'],
      ['start_at', '2030-01-01T14:01:00.000Z'], ['end_at', '2030-01-01T15:01:00.000Z'],
      ['start_ms', Date.parse(holdInput.startAt) + 60_000], ['end_ms', Date.parse(holdInput.endAt) + 60_000],
      ['time_zone', 'America/New_York'], ['buffer_before', 6], ['buffer_after', 11],
      ['occupied_start_ms', Number(beforeHold.occupied_start_ms) - 60_000], ['occupied_end_ms', Number(beforeHold.occupied_end_ms) + 60_000],
      ['created_ms', Number(beforeHold.created_ms) - 1], ['expires_ms', Number(beforeHold.expires_ms) + 1],
    ] as const) expect(() => f.raw.query(`UPDATE calendar_holds SET ${field}=?,status='released',revision=2 WHERE id=?`).run(value, holdInput.id)).toThrow();
    expect(() => f.raw.query("UPDATE calendar_holds SET status='confirmed',appointment_id=?,revision=2 WHERE id=?").run(legacyAppointment.id, holdInput.id)).toThrow();
    expect(() => f.raw.run('DELETE FROM calendar_holds')).toThrow();
    expect(() => f.raw.run('INSERT OR REPLACE INTO calendar_holds SELECT * FROM calendar_holds LIMIT 1')).toThrow();
    expect(f.db.get('calendar_holds', holdInput.id)).toEqual(beforeHold);

    const reservation = f.raw.query<Record<string, string | number>, []>('SELECT * FROM _calendar_hold_reservations ORDER BY id LIMIT 1').get()!;
    const beforeReservations = f.raw.query('SELECT * FROM _calendar_hold_reservations ORDER BY id').all();
    for (const [field, value] of [
      ['id', 'another-reservation'], ['scope_id', 'tenant:other'], ['hold_id', 'another-hold'], ['resource_id', 'another-resource'],
      ['resource_revision', Number(reservation.resource_revision) + 1], ['occupied_start_ms', Number(reservation.occupied_start_ms) - 1],
      ['occupied_end_ms', Number(reservation.occupied_end_ms) + 1], ['expires_ms', Number(reservation.expires_ms) + 1],
    ] as const) expect(() => f.raw.query(`UPDATE _calendar_hold_reservations SET ${field}=? WHERE id=?`).run(value, reservation.id!)).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_hold_reservations')).toThrow();
    expect(() => f.raw.run('INSERT OR REPLACE INTO _calendar_hold_reservations SELECT * FROM _calendar_hold_reservations LIMIT 1')).toThrow();
    expect(f.raw.query('SELECT * FROM _calendar_hold_reservations ORDER BY id').all()).toEqual(beforeReservations);
    // An immutable acquisition receipt seals membership, including against a
    // later otherwise-valid INSERT rather than merely UPDATE/DELETE/REPLACE.
    f.command('resource.create', { actor: { ...actor, manageAll: true }, requestId: 'new-equipment', id: 'new-equipment', label: 'Synthetic equipment', kind: 'equipment', ownerId: actor.userId, timeZone: 'UTC' });
    expect(() => f.db.createStrict('_calendar_hold_reservations', { id: 'synthetic-appended-reservation', scope_id: actor.scopeId, hold_id: holdInput.id,
      resource_id: 'new-equipment', resource_revision: 1, occupied_start_ms: beforeHold.occupied_start_ms!, occupied_end_ms: beforeHold.occupied_end_ms!,
      expires_ms: beforeHold.expires_ms!, active: 1 })).toThrow();
    expect(f.raw.query('SELECT * FROM _calendar_hold_reservations ORDER BY id').all()).toEqual(beforeReservations);

    f.command('hold.release', { actor, requestId: 'release-hold', id: holdInput.id, expectedRevision: 1, confirmed: true });
    expect(() => f.raw.query("UPDATE calendar_holds SET status='held',revision=3 WHERE id=?").run(holdInput.id)).toThrow();
    expect(() => f.raw.query("UPDATE calendar_holds SET status='confirmed',appointment_id=?,revision=3 WHERE id=?").run(legacyAppointment.id, holdInput.id)).toThrow();
    expect(f.raw.query('SELECT active FROM _calendar_hold_reservations').all()).toEqual([{ active: 0 }, { active: 0 }]);
  } finally { f.close(); }
});

test('confirmation preserves ordinary appointment evidence while binding replay to the original held subject', () => {
  const f = fixture();
  try {
    f.upgrade(); f.command('hold.acquire', holdInput);
    const confirm = { actor, requestId: 'confirm-hold', id: holdInput.id, appointmentId: 'confirmed-held-appointment', expectedRevision: 1, title: 'PRIVATE_CONFIRMED_TITLE' };
    const accepted = f.command('hold.confirm', confirm);
    expect(accepted).toEqual({ requestId: confirm.requestId, operation: 'appointment.created', id: confirm.appointmentId, revision: 1, changed: true });
    const receiptId = calendarHash([actor.scopeId, actor.principal, confirm.requestId]);
    expect(f.db.get('_calendar_receipts', receiptId)).toMatchObject({ target_kind: 'appointment', target_id: confirm.appointmentId, required_right: 'book' });
    expect(f.db.get('_calendar_hold_receipts', receiptId)).toBeNull();
    expect(f.db.get('_calendar_effect_intents', receiptId)).toMatchObject({ operation: 'appointment.created', target_kind: 'appointment', target_id: confirm.appointmentId });
    expect(f.db.get('calendar_holds', holdInput.id)).toMatchObject({ status: 'confirmed', revision: 2, appointment_id: confirm.appointmentId });
    expect(f.raw.query('SELECT active FROM _calendar_hold_reservations').all()).toEqual([{ active: 0 }, { active: 0 }]);
    const seq = f.db.currentSeq;
    expect(f.command('hold.confirm', confirm)).toEqual(accepted);
    expect(f.query<CalendarCommandReceipt | null>('receipt', { actor, requestId: confirm.requestId })).toEqual(accepted);
    expect(f.db.currentSeq).toBe(seq);
    const rebound = { ...actor, userId: 'another-user-on-same-principal', manageAll: true };
    let failure: unknown;
    try { f.command('hold.confirm', { ...confirm, actor: rebound }); } catch (error) { failure = error; }
    expect(readCalendarRejection(failure)?.code).toBe('CALENDAR_NOT_FOUND');
    expect(() => f.query('receipt', { actor: rebound, requestId: confirm.requestId })).toThrow();
    expect(f.db.currentSeq).toBe(seq);
    expect(() => f.raw.query("UPDATE calendar_holds SET status='released',revision=3 WHERE id=?").run(holdInput.id)).toThrow();
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('SQL confirmation demands the exact held co-resource set, not just a matching appointment interval', () => {
  const f = fixture();
  try {
    f.upgrade(); f.command('hold.acquire', holdInput);
    const held = f.db.get('calendar_holds', holdInput.id)!, appointmentId = 'synthetic-sql-confirm-target';
    f.db.createStrict('calendar_appointments', { id: appointmentId, scope_id: actor.scopeId, title: 'PRIVATE_SQL_TARGET',
      start_at: held.start_at!, end_at: held.end_at!, start_ms: held.start_ms!, end_ms: held.end_ms!, time_zone: held.time_zone!,
      buffer_before: held.buffer_before!, buffer_after: held.buffer_after!, occupied_start_ms: held.occupied_start_ms!,
      occupied_end_ms: held.occupied_end_ms!, status: 'confirmed', revision: 1, created_by: actor.userId });
    const reserve = (resourceId: string) => f.db.createStrict('_calendar_reservations', { id: reservationId(actor.scopeId, appointmentId, resourceId),
      scope_id: actor.scopeId, appointment_id: appointmentId, resource_id: resourceId,
      occupied_start_ms: held.occupied_start_ms!, occupied_end_ms: held.occupied_end_ms!, active: 1 });
    const consume = () => f.raw.query("UPDATE calendar_holds SET status='confirmed',appointment_id=?,revision=2 WHERE id=?").run(appointmentId, holdInput.id);
    reserve('person');
    expect(consume).toThrow(); expect(f.db.get('calendar_holds', holdInput.id)).toEqual(held);
    reserve('room');
    // Prove this matching appointment is admitted before testing the extra-core
    // case; roll back the intentionally raw SQL transition immediately.
    const rollback = new Error('synthetic-memory-confirmation-rollback');
    try { f.raw.transaction(() => { consume(); throw rollback; })(); }
    catch (error) { expect(error).toBe(rollback); }
    expect(f.db.get('calendar_holds', holdInput.id)).toEqual(held);
    f.command('resource.create', { actor: { ...actor, manageAll: true }, requestId: 'sql-extra-resource', id: 'sql-extra-resource', label: 'Synthetic extra resource', kind: 'equipment', ownerId: actor.userId, timeZone: 'UTC' });
    reserve('sql-extra-resource');
    expect(consume).toThrow(); expect(f.db.get('calendar_holds', holdInput.id)).toEqual(held);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
