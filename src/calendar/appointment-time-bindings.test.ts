/** Preparatory017 native MEMORY only. No registration, physical fixtures or capability claim. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { defineDatabaseRealm, runDatabaseRealmCommand, runDatabaseRealmQuery, type DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { Migrator, type Migration } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import { calendarRealm } from './realm';
import { CALENDAR_APPOINTMENT_ALL_DAY_ADDITIONS, CALENDAR_APPOINTMENT_ALL_DAY_MIGRATION, calendarAppointmentAllDayTables } from './realm-appointment-all-day-migration';
import { bindCalendarAppointmentTime, calendarAppointmentTime, calendarAppointmentTimeFields, readCalendarAppointmentTime,
  calendarAppointmentTimeHistoryFields, resolveCalendarAppointmentTimeIntent, CALENDAR_APPOINTMENT_TIME_CURRENT as CURRENT, CALENDAR_APPOINTMENT_TIME_HISTORY as HISTORY,
  CALENDAR_APPOINTMENT_TIME_STATE as STATE } from './appointment-time-bindings';
import { normalizeCalendarAppointmentTimeIntent } from './appointment-time-input';
import { calendarIntent, calendarRevision, reservationId } from './realm-model';
import { bindCalendarAppointmentType } from './appointment-type-bindings';
import { appendCalendarAppointmentUpdateHistory } from './appointment-resource-bindings';
import { calendarInteger, calendarRecord } from './validation';

const actor = { scopeId: 'tenant:synthetic-all-day-metadata', userId: 'user', principal: 'session', manageAll: true, createOwn: true };
const timed = { startAt: '2026-01-01T10:00:00.000Z', endAt: '2026-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const allDay = { kind: 'all-day-local-v1' as const, startDate: '2026-10-15', endDate: '2026-11-15', timeZone: 'America/New_York' };
const migrations = [...calendarRealm.migrations, CALENDAR_APPOINTMENT_ALL_DAY_MIGRATION];
function testTimeCommand(context: DatabaseWriteCommandContext, input: unknown) {
  const r = calendarRecord(input, ['requestId', 'expectedRevision', 'interval', 'title', 'skipBinding', 'afterBinding', 'clearType', 'appendHistory', 'omitDateHistory']);
  const row = context.db.get('calendar_appointments', 'appointment')!, revision = calendarInteger(r.expectedRevision, 1);
  const intent = r.interval === undefined ? undefined : normalizeCalendarAppointmentTimeIntent(r.interval);
  return calendarIntent(context, actor, r.requestId, ['synthetic.time', revision, intent ?? null, r.title ?? null], 'appointment', 'manage', requestId => {
    calendarRevision(row as { revision: number }, revision);
    const current = calendarAppointmentTime(context, row), fact = intent ? resolveCalendarAppointmentTimeIntent(intent, current) : current;
    context.db.update('calendar_appointments', 'appointment', { ...calendarAppointmentTimeFields(fact), revision: revision + 1, ...(r.title === undefined ? {} : { title: r.title }) });
    context.db.update('_calendar_reservations', reservationId(actor.scopeId, 'appointment', 'resource'), {
      occupied_start_ms: fact.interval.occupiedStartMs, occupied_end_ms: fact.interval.occupiedEndMs });
    if (r.clearType) bindCalendarAppointmentType(context, actor.scopeId, 'appointment', revision + 1, undefined);
    if (!r.skipBinding) bindCalendarAppointmentTime(context, actor.scopeId, 'appointment', revision + 1, fact);
    if (r.appendHistory) {
      const snapshot = (title: unknown, value: typeof fact) => ({ title, resourceIds: ['resource'], startAt: value.interval.startAt, endAt: value.interval.endAt,
        timeZone: value.interval.timeZone, bufferBeforeMinutes: value.interval.bufferBeforeMinutes, bufferAfterMinutes: value.interval.bufferAfterMinutes,
        ...(r.omitDateHistory ? {} : calendarAppointmentTimeHistoryFields(value)) });
      appendCalendarAppointmentUpdateHistory(context, actor.scopeId, 'appointment', revision + 1,
        snapshot(row.title, current), snapshot(r.title ?? row.title, fact));
    }
    if (r.afterBinding) throw new Error('synthetic after-binding failure');
    return { requestId, operation: r.appendHistory ? 'appointment.updated' : 'appointment.rescheduled', id: 'appointment', revision: revision + 1, changed: true };
  });
}
const prepared = defineDatabaseRealm({ name: calendarRealm.name, version: 'synthetic-preparatory017', tables: calendarAppointmentAllDayTables(), migrations,
  commands: { ...calendarRealm.commands, 'synthetic.time': testTimeCommand }, queries: {
    'synthetic.readTime': context => readCalendarAppointmentTime(context, context.database.query<Row>('SELECT * FROM calendar_appointments WHERE id=?').get('appointment')!) as never } });
function fixture() {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase();
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, table] of Object.entries(calendarRealm.tables)) db.defineTable(name, table);
    const migrate = (registry: readonly Migration[] = migrations) => {
      const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: [...registry], createBackups: false, log() {} });
      try { return migrator.run(); } finally { migrator.dispose(); }
    };
    expect(migrate(calendarRealm.migrations)).toHaveLength(16);
    let upgraded = false;
    const command = (name: string, body: Record<string, unknown> = {}): any => (runDatabaseRealmCommand(upgraded ? prepared : calendarRealm, db,
      name.startsWith('synthetic.') ? name : 'calendar.' + name,
      (name.startsWith('synthetic.') || name === 'owner.bind' ? body : { actor, ...body }) as DatabaseSerializableValue) as any).value;
    command('owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-owner' });
    command('resource.create', { requestId: 'resource', id: 'resource', label: 'PRIVATE_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const booking = { requestId: 'create', id: 'appointment', title: 'PRIVATE_TITLE', resourceIds: ['resource'], ...timed }, accepted = command('appointment.create', booking);
    const upgrade = () => { const applied = migrate(); for (const [name, table] of Object.entries(calendarAppointmentAllDayTables())) db.defineTable(name, table); upgraded = true; return applied; };
    const retained = () => JSON.stringify(Object.fromEntries(Object.entries(calendarRealm.tables).map(([name, table]) => [name,
      raw.query(`SELECT ${Object.keys(table).map(column => `"${column}"`).join(',')} FROM ${name} ORDER BY id`).all()])));
    const definitions = () => raw.query("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const read = () => { const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(prepared, context, 'synthetic.readTime', {})) as any; }
      finally { copy.close(); } };
    return { db, raw, command, upgrade, migrate, retained, definitions, read, booking, accepted, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('017 is unregistered, maps are additive and all original001–016 identities remain unchanged', () => {
  const hashes = calendarRealm.migrations.map(hashMigration), original = hashSchemaSnapshot(snapshotDeclaredTables(calendarRealm.tables));
  expect(calendarRealm.version).toBe('16'); expect(calendarRealm.migrations).toHaveLength(16);
  expect(Object.keys(calendarRealm.tables)).not.toContain(STATE);
  expect(Object.keys(calendarRealm.tables.calendar_appointments!)).not.toContain('time_kind');
  expect(prepared.migrations.slice(0, 16).map(hashMigration)).toEqual(hashes);
  expect(hashes).toEqual([
    '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795', '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
    'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f', 'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
    'e77be92766070b2da02fb306de1f8694c5714b7ef173c995c198f336ca7c2a10', 'a38cc0a9ee67b8dcba14583ed27df66fbd8c6b78010110daefac4042af53eca0',
    'e36da6d58e7345c042829228d96a50c7799c1f2b9a4c5135294718e5ff4c0681', '1dd8c3a24f0710f6e2e2f19304d9e0e318dd42bbb3230fa1107ee9cbe7f2eb94',
    'f9cfda1d3e4cd012282865a8637639e8a30b700cf72d3769177d56d206b3fe17', '5a53a35f77b17cc698bbc21f2744be8f14cc2fd6da29e1df44ff225a1dc9cbb3',
    '973644331b5d77442e142596ed1fda02d987c9abe7b72a83050471ef07de4707', '8b71d49213fce98e2d289eca7a67e5895bd6747ce12bda9760d3d7d293995e42',
    '0fa8a49cbbbf0881608d6b1aafbb1900a218ac73a4b7ee95ac7367ef0c8ef448', 'bf3c1f6718bf15a8a0d1686d0ad3ef920d0477730faae5943d182861dcd5b945',
    '24ba28d0d72cc5b90ad5436c5483188bbcf9ee637fdf08ea7fe3990d5ab528b4', '0553be4d7a34a76f3e0c9335f056c7abaefab7fac910c127d503060ee061a2d8' ]);
  expect(original).toBe('a9de3c82718367f9dfb5db628706f7a2b2fda542d12fc27be8d2d589a8d1f2a4');
  expect(hashSchemaSnapshot(snapshotDeclaredTables(calendarRealm.tables))).toBe(original);
  const tables = calendarAppointmentAllDayTables(); expect(Object.isFrozen(tables)).toBe(true);
  for (const name of Object.keys(calendarRealm.tables)) { expect(Object.isFrozen(tables[name])).toBe(true); expect(tables[name]).not.toBe(calendarRealm.tables[name]); }
  expect(Reflect.set(tables.calendar_resources!, 'label', 'INTEGER')).toBe(false);
});
test('latest-map MEMORY predeclaration is admitted only as exact empty metadata, without faking fresh physical bootstrap', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try { const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, table] of Object.entries(calendarAppointmentAllDayTables())) db.defineTable(name, table);
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log() {} });
    try { expect(migrator.run()).toHaveLength(17); } finally { migrator.dispose(); }
    expect(db.get(STATE, 'application')?.version).toBe(17); expect(db.list(HISTORY)).toEqual([]);
  } finally { db.dispose(); }
});
test('native populated016 migration ownsDDL before latest ReactiveDB definitions, with no semantic backfill or receipt changes', () => {
  const f = fixture();
  try {
    const before = f.retained(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.upgrade()).toEqual(['017']); expect(f.retained()).toBe(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.list(HISTORY)).toEqual([]); expect(f.db.list(CURRENT)).toEqual([]);
    expect(f.db.get(STATE, 'application')).toEqual({ id: 'application', version: 17 });
    expect(f.command('appointment.create', f.booking)).toEqual(f.accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version LIMIT 16').all()).toEqual(ledger);
    expect(f.read()).toMatchObject({ kind: 'timed-v1', interval: timed }); expect(f.migrate()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
test('late017 failure rolls backDDL/state/ledger and preserves a retryable populated016', () => {
  const f = fixture();
  try {
    const before = f.retained(), definitions = f.definitions(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const failing = { ...CALENDAR_APPOINTMENT_ALL_DAY_MIGRATION, up(database: Parameters<Migration['up']>[0]) {
      CALENDAR_APPOINTMENT_ALL_DAY_MIGRATION.up(database); throw new Error('late017'); } };
    expect(() => f.migrate([...calendarRealm.migrations, failing])).toThrow('late017');
    expect(f.retained()).toBe(before); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
    expect(f.upgrade()).toEqual(['017']);
  } finally { f.close(); }
});
const emptyState = `CREATE TABLE ${STATE}(id TEXT PRIMARY KEY NOT NULL CHECK(id='application'),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=17));`;
for (const [label, sql] of [
  ['malformed table', `CREATE TABLE ${CURRENT}(id TEXT PRIMARY KEY)`],
  ['populated partial state', emptyState + `INSERT INTO ${STATE} VALUES('application',17)`],
  ['missing016 state', 'DROP TRIGGER calendar_appointment_resource_version_delete; DELETE FROM _calendar_appointment_resource_state'],
  ['unexpected index', emptyState + `CREATE INDEX synthetic_unexpected ON ${STATE}(version)`],
  ['unexpected trigger', emptyState + `CREATE TRIGGER synthetic_unexpected BEFORE INSERT ON ${STATE} BEGIN SELECT RAISE(ABORT,'synthetic'); END`],
]) test('017 admission rejects without repair: ' + label, () => {
    const f = fixture();
    try { f.raw.exec(sql); const before = f.retained(), definitions = f.definitions(); expect(() => f.migrate()).toThrow();
      expect(f.retained()).toBe(before); expect(f.definitions()).toEqual(definitions); }
    finally { f.close(); }
});
test('LocalDate31 fall-back facts, title/status changes and exact replay retain the accepted snapshot without Temporal', () => {
  const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    f.upgrade(); const accepted = f.command('synthetic.time', { requestId: 'all-day', expectedRevision: 1, interval: allDay });
    const fact = f.read(), history = f.db.list(HISTORY), pointer = f.db.list(CURRENT);
    expect(fact).toMatchObject({ kind: 'all-day-local-v1', intent: allDay, interval: { dayCount: 31 } });
    expect(fact.interval.endMs - fact.interval.startMs).toBe(31 * 86_400_000 + 3_600_000);
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: undefined });
    expect(f.command('synthetic.time', { requestId: 'all-day', expectedRevision: 1, interval: allDay })).toEqual(accepted);
    const beforeNewDates = f.raw.serialize(), beforeNewDatesSeq = f.db.currentSeq;
    expect(() => f.command('synthetic.time', { requestId: 'new-dates', expectedRevision: 2,
      interval: { ...allDay, startDate: '2026-10-16', endDate: '2026-11-16' } })).toThrow(expect.objectContaining({ code: 'CALENDAR_TIME_RULES_UNAVAILABLE' }));
    expect(f.raw.serialize()).toEqual(beforeNewDates); expect(f.db.currentSeq).toBe(beforeNewDatesSeq);
    f.command('synthetic.time', { requestId: 'title', expectedRevision: 2, title: 'PRIVATE_NEW' });
    f.command('synthetic.time', { requestId: 'same-dates', expectedRevision: 3, interval: allDay });
    expect(f.db.list(HISTORY)).toEqual(history); expect(f.db.list(CURRENT)).toEqual(pointer); expect(f.read()).toEqual(fact);
    f.command('appointment.cancel', { requestId: 'cancel', id: 'appointment', expectedRevision: 4, confirmed: true });
    expect(f.db.list(HISTORY)).toEqual(history); expect(f.read()).toEqual(fact);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); f.close(); }
});
test('explicit conversion back to timed retains both generations and advances the pointer', () => {
  const f = fixture();
  try { f.upgrade(); f.command('synthetic.time', { requestId: 'all-day', expectedRevision: 1, interval: allDay });
    const first = f.db.list(HISTORY)[0]!;
    f.command('synthetic.time', { requestId: 'timed', expectedRevision: 2, interval: { kind: 'timed-v1', ...timed } });
    expect(f.db.list(HISTORY)).toHaveLength(2); expect(f.db.get(HISTORY, String(first.id))).toEqual(first);
    expect(f.read()).toMatchObject({ kind: 'timed-v1', interval: timed });
    f.command('synthetic.time', { requestId: 'title', expectedRevision: 3, title: 'PRIVATE_NEW' }); expect(f.db.list(HISTORY)).toHaveLength(2);
  } finally { f.close(); }
});
test('016 update images must retain authored LocalDate facts; omitted date authority rolls the edit back', () => {
  const f = fixture();
  try { f.upgrade(); f.command('synthetic.time', { requestId: 'all-day', expectedRevision: 1, interval: allDay, appendHistory: true });
    const history = f.db.list(HISTORY), before = f.raw.serialize(), seq = f.db.currentSeq;
    expect(() => f.command('synthetic.time', { requestId: 'missing-dates', expectedRevision: 2, title: 'PRIVATE_IGNORED', appendHistory: true, omitDateHistory: true })).toThrow();
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.command('synthetic.time', { requestId: 'title', expectedRevision: 2, title: 'PRIVATE_NEW', appendHistory: true });
    expect(f.db.list(HISTORY)).toEqual(history);
    const images = f.db.list('_calendar_appointment_update_history').map(row => JSON.parse(String(row.after_json)));
    expect(images.map(image => image.interval)).toEqual([allDay, allDay]);
  } finally { f.close(); }
});
test('kind downgrade without a new binding and retained types fail the final time seal; explicit type clear permits conversion', () => {
  const f = fixture();
  try { f.upgrade(); f.command('type.create', { requestId: 'type', id: 'type', label: 'PRIVATE_TYPE', durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    f.command('appointment.update', { requestId: 'typed', id: 'appointment', expectedRevision: 1, appointmentType: { id: 'type', revision: 1 } });
    const before = f.raw.serialize(), seq = f.db.currentSeq;
    expect(() => f.command('synthetic.time', { requestId: 'typed-all-day', expectedRevision: 2, interval: allDay })).toThrow();
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.command('synthetic.time', { requestId: 'clear-all-day', expectedRevision: 2, interval: allDay, clearType: true });
    const accepted = f.raw.serialize(), acceptedSeq = f.db.currentSeq;
    expect(() => f.command('synthetic.time', { requestId: 'downgrade', expectedRevision: 3, interval: { kind: 'timed-v1', ...timed }, skipBinding: true })).toThrow();
    expect(f.raw.serialize()).toEqual(accepted); expect(f.db.currentSeq).toBe(acceptedSeq); expect(f.read().kind).toBe('all-day-local-v1');
  } finally { f.close(); }
});
for (const extras of [{ skipBinding: true }, { afterBinding: true }]) test(extras.skipBinding
  ? 'missing time binding fails the effect seal and rolls back all state'
  : 'late fault rolls back parent/reservations/history/budget/receipt', () => {
    const f = fixture();
    try { f.upgrade(); const before = f.raw.serialize(), seq = f.db.currentSeq;
      expect(() => f.command('synthetic.time', { requestId: 'failed', expectedRevision: 1, interval: allDay, ...extras })).toThrow();
      expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.db.list(HISTORY)).toEqual([]);
    } finally { f.close(); }
});
test('history budget100000 is enforced atomically', () => {
  const f = fixture();
  try { f.upgrade(); f.db.createStrict('_calendar_usage', { id: 'appointmentTimeHistory', count: 100000 }); const before = f.raw.serialize(), seq = f.db.currentSeq;
    expect(() => f.command('synthetic.time', { requestId: 'full', expectedRevision: 1, interval: allDay })).toThrow(expect.objectContaining({ code: 'CALENDAR_CAPACITY' }));
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});
test('immutable history/pointer/state and sealed same-generation parent tampering reject', () => {
  const f = fixture();
  try { f.upgrade(); f.command('synthetic.time', { requestId: 'all-day', expectedRevision: 1, interval: allDay });
    for (const sql of [`UPDATE ${HISTORY} SET start_date='2026-01-01'`, `DELETE FROM ${HISTORY}`, `DELETE FROM ${CURRENT}`,
      `UPDATE ${CURRENT} SET binding_id='missing'`, `UPDATE ${STATE} SET version=17`, `DELETE FROM ${STATE}`,
      "UPDATE calendar_appointments SET time_kind='timed-v1' WHERE id='appointment'", "UPDATE calendar_appointments SET start_ms=start_ms+1 WHERE id='appointment'",
      `INSERT OR REPLACE INTO ${STATE} VALUES('application',17)`, `INSERT INTO ${STATE} VALUES(NULL,17)`]) expect(() => f.raw.run(sql)).toThrow();
    expect(f.read().kind).toBe('all-day-local-v1');
  } finally { f.close(); }
});
for (const table of [STATE, CURRENT, HISTORY]) test('missing017 metadata cannot become legacy timed in a warm reader: ' + table, () => {
    const f = fixture();
    try { f.upgrade(); f.command('synthetic.time', { requestId: 'all-day', expectedRevision: 1, interval: allDay });
      f.raw.run('PRAGMA foreign_keys=OFF'); f.raw.run('DROP TABLE ' + table); const before = f.raw.serialize();
      expect(() => f.read()).toThrow(); expect(f.raw.serialize()).toEqual(before);
    } finally { f.close(); }
});
test('stored-fact reads reject corrupted Gregorian facts, provenance, projections and parent identity without current rules or repair', () => {
  const f = fixture();
  try {
    f.upgrade(); f.command('synthetic.time', { requestId: 'all-day', expectedRevision: 1, interval: allDay });
    const original = f.db.list(HISTORY)[0]!;
    // Deliberate corruption of this owned synthetic MEMORY fixture only. No
    // production repair path is provided by the helpers under test.
    f.raw.run(`DROP TRIGGER ${HISTORY}_update`); f.raw.run('PRAGMA ignore_check_constraints=ON');
    for (const [field, value] of [['start_date', '2026-02-30'], ['day_count', 30], ['authored_time_zone', null], ['engine_json', '{}'],
      ['engine_json', '{"name":"temporal-all-day-v1","runtime":"synthetic","icu":null}'], ['start_ms', Number(original.start_ms) + 1],
      ['time_zone', 'UTC'], ['appointment_revision', 100], ['scope_id', 'tenant:other']]) {
      f.raw.run(`UPDATE ${HISTORY} SET ${field}=? WHERE id=?`, [value, String(original.id)]);
      const before = f.raw.serialize(), seq = f.db.currentSeq;
      expect(() => f.read()).toThrow(); expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
      f.raw.run(`UPDATE ${HISTORY} SET ${field}=? WHERE id=?`, [original[String(field)] as string | number | null, String(original.id)]);
    }
    f.raw.run('PRAGMA ignore_check_constraints=OFF'); expect(f.read().kind).toBe('all-day-local-v1');
  } finally { f.close(); }
});
test('descriptor-safe authored intent is detached/closed and needs neither Temporal nor timezone database lookup', () => {
  let reads = 0; const accessor = { ...allDay, get startDate() { reads++; return '2026-01-01'; } };
  for (const value of [accessor, new Proxy(allDay, {}), { ...allDay, engine: {} }, { ...allDay, startAt: timed.startAt }, { ...allDay, endDate: undefined },
    { ...allDay, endDate: '2026-11-16' }, { ...allDay, startDate: '2026-02-30' }, { ...allDay, timeZone: ' UTC' }, null, []]) expect(() => normalizeCalendarAppointmentTimeIntent(value)).toThrow();
  expect(reads).toBe(0); const mutable = { ...allDay }, value = normalizeCalendarAppointmentTimeIntent(mutable); mutable.startDate = '2026-01-01';
  expect(value).toEqual(allDay); expect(Object.isFrozen(value)).toBe(true);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal'), formatter = Intl.DateTimeFormat;
  try { Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: undefined });
    Intl.DateTimeFormat = new Proxy(formatter, {
      apply() { throw new Error('must not resolve current rules'); },
      construct() { throw new Error('must not resolve current rules'); },
    });
    expect(normalizeCalendarAppointmentTimeIntent(allDay)).toEqual(allDay);
  } finally { Intl.DateTimeFormat = formatter; if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
});
test('SQL branch checks reject missing/null/wrong engine fields rather than accepting CHECK unknown', () => {
  const raw = new Database(':memory:');
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=OFF');
    for (const name of [HISTORY, STATE]) raw.run(`CREATE TABLE ${name} (${Object.entries(CALENDAR_APPOINTMENT_ALL_DAY_ADDITIONS[name]!).map(([key, definition]) => `"${key}" ${definition}`).join(',')})`);
    const fact = resolveCalendarAppointmentTimeIntent(allDay), i = fact.interval;
    const valid: Record<string, string | number | null> = { id: 'history', scope_id: actor.scopeId, appointment_id: 'appointment', appointment_revision: 1,
      kind: fact.kind, start_date: allDay.startDate, end_date: allDay.endDate, day_count: 31, authored_time_zone: allDay.timeZone,
      start_at: i.startAt, end_at: i.endAt, start_ms: i.startMs, end_ms: i.endMs, time_zone: i.timeZone,
      buffer_before: 0, buffer_after: 0, occupied_start_ms: i.occupiedStartMs, occupied_end_ms: i.occupiedEndMs,
      engine_json: JSON.stringify({ name: 'temporal-all-day-v1', runtime: 'synthetic', icu: 'synthetic' }) };
    const columns = Object.keys(valid), insert = raw.prepare(`INSERT INTO ${HISTORY}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
    try {
      insert.run(...Object.values(valid)); raw.run(`DELETE FROM ${HISTORY}`);
      for (const engine of [null, '{}', 'null', '[]', 'false', '{', JSON.stringify({ name: 'temporal-all-day-v1', runtime: 'synthetic' }),
        JSON.stringify({ name: 'temporal-all-day-v1', runtime: null, icu: 'synthetic' }), JSON.stringify({ name: 'temporal-all-day-v1', runtime: 'synthetic', icu: null }),
        JSON.stringify({ name: 'temporal-all-day-v1', runtime: '', icu: 'synthetic' }), JSON.stringify({ name: 'wrong', runtime: 'synthetic', icu: 'synthetic' }),
        JSON.stringify({ name: 'temporal-all-day-v1', runtime: 'synthetic', icu: 'synthetic', authority: true })]) {
        expect(() => insert.run(...Object.values({ ...valid, engine_json: engine }))).toThrow();
      }
      for (const change of [{ start_date: null }, { end_date: null }, { day_count: null }, { authored_time_zone: null }, { buffer_before: 1 }, { id: null },
        { day_count: 32 }, { kind: 'timed-v1' }, { occupied_end_ms: i.occupiedEndMs + 1 }]) expect(() => insert.run(...Object.values({ ...valid, ...change }))).toThrow();
    } finally { insert.finalize(); }
    for (const [id, version] of [[null, 17], ['application', null], ['other', 17], ['application', 16]]) expect(() => raw.run(`INSERT INTO ${STATE} VALUES(?,?)`, [id, version])).toThrow();
    raw.run(`INSERT INTO ${STATE} VALUES('application',17)`); expect(() => raw.run(`INSERT INTO ${STATE} VALUES('application',17)`)).toThrow();
  } finally { raw.close(); }
});
