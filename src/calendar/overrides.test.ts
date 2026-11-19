/** Native MEMORY transactions only. All owned read copies/logging/database resources close in finally. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { createDatabaseWriteCommandSession } from '../databases/database-write-command-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { cloneDatabaseSerializableValue } from '../databases/database-operation-payload';
import { createReactiveDB } from '../sync/reactive-db';
import { Migrator, type Migration } from '../migrations/migrator';
import { hashMigration } from '../migrations/schema-snapshot';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { calendarRealm } from './realm';
import { calendarRealm018 } from './test-support/calendar-realm-018';
import { CALENDAR_OVERRIDES_MIGRATION as migration, CALENDAR_OVERRIDE_ADDITIONS } from './realm-overrides-migration';
import { createCalendarReadContext } from './calendar-read-store';
import { assertCalendarResourcesAvailable, mintCalendarAppointmentOverlapAllowance } from './occupancy';
import { normalizeCalendarTimedInterval } from './time';
import { calendarRecord } from './validation';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import type { CalendarActor } from './contracts';
import type { CalendarOverrideReview } from './override-contracts';
import { normalizeCalendarAppointmentOverride, normalizeCalendarOverrideAuthority, normalizeCalendarOverrideGrant,
  CALENDAR_OVERRIDE_STATE as STATE, CALENDAR_OVERRIDE_GRANT_HISTORY as GRANTS, CALENDAR_OVERRIDE_GRANT_CURRENT as CURRENT,
  CALENDAR_OVERRIDE_ADMISSIONS as ADMISSIONS, CALENDAR_OVERRIDE_HISTORY as HISTORY, CALENDAR_OVERRIDE_WITNESSES as WITNESSES } from './override-model';
const actor: CalendarActor = { scopeId: 'tenant:synthetic-overrides', userId: 'owner', principal: 'session.owner', manageAll: true, createOwn: true,
  overrides: { policyVersion: 'appointment-overlap-v1', policyHash: 'a'.repeat(64), use: true, manageGrants: true } };
const plain: CalendarActor = { scopeId: actor.scopeId, userId: actor.userId, principal: actor.principal, manageAll: true, createOwn: true };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const candidate = { resourceIds: ['resource'], title: 'PRIVATE_CANDIDATE', ...timed };
function reject(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected native refusal'); }
  catch (error) { const actual = error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code; if (!actual) throw error; expect(actual).toBe(code); }
}
function fixture(upgrade = true, logging = false, maxEvents = 100) {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase(); let source: LoggingActorSource | undefined;
  try {
    raw.run('PRAGMA foreign_keys=ON'); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, table] of Object.entries(calendarRealm018.tables)) db.defineTable(name, table);
    const migrate = (registry: readonly Migration[] = calendarRealm.migrations) => { const m = new Migrator({ database: raw, dbPath: ':memory:', migrations: [...registry], createBackups: false, log() {} });
      try { return m.run(); } finally { m.dispose(); } };
    expect(migrate(calendarRealm018.migrations)).toHaveLength(18);
    let upgraded = false;
    const command = (name: string, body: Record<string, unknown> = {}): any => {
      const run = () => runDatabaseRealmCommand(upgraded ? calendarRealm : calendarRealm018, db, 'calendar.' + name, cloneDatabaseSerializableValue(name === 'owner.bind' ? body : { actor, ...body }));
      const result = calendarRecord(source ? source.run(loggingContext('synthetic-overrides'), run) : run(), ['ok', 'value']);
      if (result.ok !== true || !Object.hasOwn(result, 'value')) throw new Error('Expected accepted native command');
      return result.value;
    };
    command('owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-overrides-owner' });
    const resource = (id: string) => command('resource.create', { requestId: 'resource-' + id, id, label: 'PRIVATE_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    resource('resource');
    command('appointment.create', { requestId: 'accepted', id: 'accepted', ...candidate, title: 'PRIVATE_ACCEPTED' });
    const promote = () => { const result = migrate(); for (const [name, table] of Object.entries(calendarRealm.tables)) db.defineTable(name, table); upgraded = true; return result; };
    if (upgrade) expect(promote()).toEqual(['019']);
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'synthetic-overrides', scope: { kind: 'tenant', tenantId: 'synthetic-overrides' }, sourceQueue: { maxEvents } }));
    const query = (name: string, body: Record<string, unknown>): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), ctx =>
        runDatabaseRealmQuery(calendarRealm, ctx, 'calendar.' + name, cloneDatabaseSerializableValue({ actor, ...body }))); } finally { copy.close(); }
    };
    const grant = (categories: string[] = ['appointment-overlap'], extra: Record<string, unknown> = {}) => command('resource.override-grant', {
      id: 'resource', userId: actor.userId, requestId: 'grant-' + db.currentSeq, expectedRevision: db.get('calendar_resources', 'resource')!.revision, categories, ...extra });
    const review = (key = 'candidate', input: Record<string, unknown> = candidate, subject: CalendarActor = actor): CalendarOverrideReview => query('appointmentReviewCreate', { actor: subject, requestId: key, id: key, ...input });
    const proof = (key = 'candidate', input: Record<string, unknown> = candidate) => { const result = review(key, input); expect(result.status).toBe('reviewable');
      if (result.status !== 'reviewable') throw new Error('Expected reviewable'); return { policyVersion: result.policyVersion, decisionToken: result.decisionToken, reason: 'PRIVATE_REASON' }; };
    const state = () => JSON.stringify(Object.fromEntries(Object.keys(calendarRealm.tables).filter(name => db.hasTable(name)).map(name => [name, db.list(name)])));
    const drain = () => { if (source) { const page = source.control({}); source.control({ acknowledge: page.rows.map(row => row.id) }); } };
    return { db, raw, command, query, resource, migrate, promote, grant, review, proof, state, source, drain,
      close() { try { source?.close(); } finally { db.dispose(); } } };
  } catch (error) { try { source?.close(); } finally { db.dispose(); } throw error; }
}
test('closed input detaches reason/categories/capabilities and never executes authored descriptors', () => {
  const token = 'co1.1.300001.' + 'a'.repeat(32) + '.' + 'b'.repeat(64), value = { policyVersion: 'appointment-overlap-v1' as const, decisionToken: token, reason: ' reason ' };
  expect(normalizeCalendarAppointmentOverride(value)).toEqual({ ...value, reason: 'reason' });
  expect(Object.isFrozen(normalizeCalendarAppointmentOverride(value))).toBe(true);
  let calls = 0; const getter = Object.defineProperty({}, 'reason', { enumerable: true, get() { calls++; return 'x'; } });
  for (const input of [getter, new Proxy({}, { ownKeys() { calls++; return []; } }), { ...value, reason: ' ' }, { ...value, force: true }, { ...value, reason: 'x\ny' }, { ...value, decisionToken: 'invalid' }]) reject(() => normalizeCalendarAppointmentOverride(input), 'CALENDAR_INPUT_INVALID');
  expect(calls).toBe(0); expect(normalizeCalendarOverrideGrant({ categories: [] }).categories).toEqual([]);
  reject(() => normalizeCalendarOverrideGrant({ categories: ['appointment-overlap', 'appointment-overlap'] }), 'CALENDAR_INPUT_INVALID');
  reject(() => normalizeCalendarOverrideAuthority({ ...actor.overrides, owner: true }), 'CALENDAR_INPUT_INVALID');
});
test('genuine018 upgrade preserves every accepted row/checksum/receipt and creates only private empty authority state', () => {
  const f = fixture(false);
  try {
    const rows = () => JSON.stringify(Object.keys(calendarRealm018.tables).map(name => [name, f.raw.query(`SELECT * FROM ${name}${name === '_calendar_usage' ? " WHERE id<>'overrideVersion'" : ''} ORDER BY id`).all()]));
    const before = rows(), seq = f.db.currentSeq, hashes = calendarRealm018.migrations.map(hashMigration);
    expect(f.promote()).toEqual(['019']); expect(rows()).toBe(before); expect(f.db.currentSeq).toBe(seq);
    expect(calendarRealm.migrations.slice(0, 18).map(hashMigration)).toEqual(hashes);
    expect(f.db.get(STATE, 'application')?.review_key).toMatch(/^[a-f0-9]{64}$/); expect(f.db.list(GRANTS)).toEqual([]); expect(f.db.list(HISTORY)).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]); expect(f.migrate()).toEqual([]);
  } finally { f.close(); }
});
test('owner/manage do not imply independent grants; grant CAS/noop/replay/revocation are one resource receipt/effect', () => {
  const f = fixture();
  try {
    reject(() => f.review('owner-no-cap', candidate, plain), 'CALENDAR_OVERRIDE_NOT_ALLOWED');
    reject(() => f.review(), 'CALENDAR_OVERRIDE_NOT_ALLOWED');
    reject(() => f.grant(['appointment-overlap'], { actor: plain }), 'CALENDAR_OVERRIDE_NOT_ALLOWED');
    const accepted = f.grant(), seq = f.db.currentSeq;
    expect(accepted).toMatchObject({ operation: 'resource.override-grant-changed', revision: 2, changed: true });
    expect(f.db.list(GRANTS)).toHaveLength(1);
    expect(f.grant()).toMatchObject({ revision: 2, changed: false }); expect(f.db.list(GRANTS)).toHaveLength(1);
    f.grant([]);
    expect(f.command('resource.override-grant', { actor: plain, requestId: accepted.requestId, id: 'resource', expectedRevision: 1, userId: actor.userId, categories: ['appointment-overlap'] })).toEqual(accepted);
    expect(f.db.currentSeq).toBeGreaterThan(seq); reject(() => f.review('revoked'), 'CALENDAR_OVERRIDE_NOT_ALLOWED');
  } finally { f.close(); }
});
test('readonly review nonce has zero writes and final create commits exact private evidence plus ONE safe semantic event', () => {
  const f = fixture(true, true);
  try {
    f.grant(); f.drain(); const seq = f.db.currentSeq, before = f.state(), first = f.proof(), second = f.proof();
    expect(first.decisionToken).not.toBe(second.decisionToken); expect(f.db.currentSeq).toBe(seq); expect(f.state()).toBe(before);
    expect(first.decisionToken).not.toContain('accepted'); expect(first.decisionToken).not.toContain('PRIVATE_');
    const accepted = f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override: first });
    expect(accepted).toMatchObject({ operation: 'appointment.created', revision: 1, changed: true });
    expect(f.db.list(ADMISSIONS)).toHaveLength(1); expect(f.db.list(HISTORY)).toHaveLength(1); expect(f.db.list(WITNESSES)).toHaveLength(1);
    const events = f.source!.control({}).rows.map(row => row.event); expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ overrideCategory: 'appointment-overlap', overridePolicy: 'appointment-overlap-v1', reasonPresent: true });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_'); expect(JSON.stringify(events)).not.toContain('decisionToken');
    const committed = f.state(); expect(f.command('appointment.create', { actor: plain, requestId: 'candidate', id: 'candidate', ...candidate, override: first })).toEqual(accepted);
    expect(f.state()).toBe(committed); expect(f.source!.control({}).rows).toHaveLength(1);
  } finally { f.close(); }
});
test('reason/token/target/key/candidate changes refuse atomically and an expired proof cannot become a new ordinary save', () => {
  const f = fixture();
  try {
    f.grant(); const proof = f.proof(), before = f.state();
    for (const body of [{ id: 'other' }, { requestId: 'other' }, { title: 'PRIVATE_CHANGED' }, { override: { ...proof, decisionToken: proof.decisionToken.slice(0, -1) + (proof.decisionToken.endsWith('a') ? 'b' : 'a') } }]) {
      reject(() => f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override: proof, ...body }), 'CALENDAR_OVERRIDE_STALE'); expect(f.state()).toBe(before);
    }
    const now = Date.now; try { Date.now = () => now() + 300_001;
      reject(() => f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override: proof }), 'CALENDAR_OVERRIDE_STALE');
    } finally { Date.now = now; }
    expect(f.state()).toBe(before);
  } finally { f.close(); }
});
test('metadata-only/noop update never fabricates fresh exception history and ordinary grandfathered metadata remains usable', () => {
  const f = fixture();
  try {
    f.grant(); const override = f.proof(); f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override });
    const before = f.state();
    reject(() => f.command('appointment.update', { requestId: 'metadata-proof', id: 'candidate', expectedRevision: 1, title: 'rename', override }), 'CALENDAR_OVERRIDE_STALE');
    expect(f.state()).toBe(before);
    f.command('appointment.update', { actor: plain, requestId: 'metadata', id: 'candidate', expectedRevision: 1, title: 'rename' });
    expect(f.db.list(HISTORY)).toHaveLength(1);
    expect(f.command('appointment.update', { actor: plain, requestId: 'noop', id: 'candidate', expectedRevision: 2, title: 'rename' })).toMatchObject({ changed: false });
    expect(f.db.list(HISTORY)).toHaveLength(1);
  } finally { f.close(); }
});
test('private history/witness/key identities cannot be replaced, mutated, removed or attached after accepted effect', () => {
  const f = fixture();
  try {
    f.grant(); const override = f.proof(); f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override });
    const before = f.state();
    for (const table of [STATE, GRANTS, ADMISSIONS, HISTORY, WITNESSES]) {
      expect(() => f.raw.run(`UPDATE ${table} SET id=id`)).toThrow(); expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
    }
    expect(() => f.raw.run(`DELETE FROM ${CURRENT}`)).toThrow(); expect(() => f.raw.run("DELETE FROM _calendar_usage WHERE id='overrideVersion'")).toThrow();
    expect(f.state()).toBe(before);
  } finally { f.close(); }
});
test('quota and required semantic backpressure roll back all candidate/reservation/admission/history/receipt facts', () => {
  const f = fixture(true, true, 1);
  try {
    f.grant(); f.drain(); const override = f.proof();
    f.command('appointment.update', { requestId: 'fill-logging', id: 'accepted', expectedRevision: 1, title: 'fill' });
    // The review must bind this new accepted revision before testing final audit pressure.
    const current = f.proof(), before = f.state();
    expect(() => f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override: current })).toThrow();
    expect(f.state()).toBe(before); f.drain();
    f.raw.run("INSERT INTO _calendar_usage(id,count) VALUES('overrideWitnesses',1000000)"); const full = f.state();
    reject(() => f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override: current }), 'CALENDAR_CAPACITY');
    expect(f.state()).toBe(full); expect(f.db.list(ADMISSIONS)).toEqual([]);
  } finally { f.close(); }
});
test('adopted019 missing key/table/marker/current grant fails closed without allocating replacement authority', () => {
  const f = fixture();
  try {
    f.grant();
    for (const missing of [...Object.keys(CALENDAR_OVERRIDE_ADDITIONS), 'all', 'marker', 'grant-selector', 'grant-revision']) {
      const copy = Database.deserialize(f.raw.serialize(), { strict: true });
      try {
        copy.run('PRAGMA foreign_keys=OFF');
        if (missing === 'all') {
          for (const name of Object.keys(CALENDAR_OVERRIDE_ADDITIONS).reverse()) copy.run('DROP TABLE ' + name);
          copy.exec("DROP TRIGGER calendar_override_marker_delete; DELETE FROM _calendar_usage WHERE id='overrideVersion'");
        } else if (missing === 'marker') copy.exec("DROP TRIGGER calendar_override_marker_delete; DELETE FROM _calendar_usage WHERE id='overrideVersion'");
        else if (missing === 'grant-selector') copy.exec(`DROP TRIGGER calendar_override_grant_current_retain; DELETE FROM ${CURRENT}`);
        else if (missing === 'grant-revision') copy.exec(`PRAGMA ignore_check_constraints=ON; DROP TRIGGER ${GRANTS}_update;
          DROP TRIGGER calendar_override_grant_current_update; DROP TRIGGER calendar_override_grant_current_identity;
          UPDATE ${GRANTS} SET resource_revision=0; UPDATE ${CURRENT} SET resource_revision=0`);
        else copy.run('DROP TABLE ' + missing);
        copy.run('PRAGMA query_only=ON'); const before = copy.serialize();
        reject(() => withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), ctx => runDatabaseRealmQuery(calendarRealm, ctx, 'calendar.appointmentReviewCreate', cloneDatabaseSerializableValue({ actor, requestId: 'candidate', id: 'candidate', ...candidate }))), 'CALENDAR_STATE_INVALID');
        expect(copy.serialize()).toEqual(before);
      } finally { copy.close(); }
    }
  } finally { f.close(); }
});
test('late019 migration failure rolls backDDL/key/marker/ledger and leaves genuine018 retryable', () => {
  const f = fixture(false);
  try {
    const seq = f.db.currentSeq, before = f.state();
    const failing = { ...migration, up(database: Parameters<Migration['up']>[0]) { migration.up(database); throw new Error('synthetic late019'); } };
    expect(() => f.migrate([...calendarRealm018.migrations, failing])).toThrow('synthetic late019');
    expect(f.raw.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(STATE)).toBeNull(); expect(f.db.get('_calendar_usage', 'overrideVersion')).toBeNull();
    expect(f.db.currentSeq).toBe(seq); expect(f.state()).toBe(before); expect(f.raw.query('SELECT * FROM _migrations').all()).toHaveLength(18);
    expect(f.promote()).toEqual(['019']); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
test('malformed/prepopulated019 schema and missing018 state refuse genuine upgrade atomically', () => {
  for (const corruption of ['shape', 'artifact', 'state']) {
    const f = fixture(false);
    try {
      if (corruption === 'shape') f.raw.run(`CREATE TABLE ${STATE}(id TEXT PRIMARY KEY)`);
      else if (corruption === 'artifact') {
        const table = CALENDAR_OVERRIDE_ADDITIONS[STATE]!;
        f.raw.run(`CREATE TABLE ${STATE} (${Object.entries(table).map(([column, declaration]) => '"' + column + '" ' + declaration).join(',')})`);
        f.raw.run(`CREATE TRIGGER synthetic_bad_override BEFORE INSERT ON ${STATE} BEGIN SELECT RAISE(ABORT,'synthetic'); END`);
      } else f.raw.exec('DROP TRIGGER calendar_location_policy_state_delete; DELETE FROM _calendar_resource_location_policy_state');
      const before = f.state(), seq = f.db.currentSeq;
      expect(() => f.promote()).toThrow(); expect(f.state()).toBe(before); expect(f.db.currentSeq).toBe(seq);
      expect(f.db.get('_calendar_usage', 'overrideVersion')).toBeNull();
    } finally { f.close(); }
  }
});
test('forged/copied allowance cannot skip appointment occupancy and native mint requires a fresh unsealed admission', () => {
  const f = fixture();
  try {
    const copy = Database.deserialize(f.raw.serialize(), { readonly: true, strict: true });
    try { withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), ctx => {
      const read = createCalendarReadContext(ctx), interval = normalizeCalendarTimedInterval(timed);
      reject(() => assertCalendarResourcesAvailable(read, actor.scopeId, ['resource'], interval, undefined, Date.now(), { kind: 'calendar-appointment-overlap-allowance' }), 'CALENDAR_STATE_INVALID');
      reject(() => assertCalendarResourcesAvailable(read, actor.scopeId, ['resource'], interval), 'CALENDAR_BOOKING_CONFLICT');
    }); } finally { copy.close(); }
    const session = createDatabaseWriteCommandSession(f.db);
    try { reject(() => mintCalendarAppointmentOverlapAllowance(session.context, actor.scopeId, ['resource'], normalizeCalendarTimedInterval(timed), 'missing-admission'), 'CALENDAR_STATE_INVALID'); }
    finally { session.close(); }
  } finally { f.close(); }
});
test('late source receipt failure rolls back a fully written override candidate and its complete private evidence', () => {
  const f = fixture();
  try {
    f.grant(); const override = f.proof();
    f.raw.run("CREATE TRIGGER synthetic_late_override_receipt BEFORE INSERT ON _calendar_receipts WHEN NEW.target_id='candidate' BEGIN SELECT RAISE(ABORT,'synthetic late receipt'); END");
    const before = f.state(), seq = f.db.currentSeq;
    expect(() => f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override })).toThrow('synthetic late receipt');
    expect(f.state()).toBe(before); expect(f.db.currentSeq).toBe(seq);
    f.raw.run('DROP TRIGGER synthetic_late_override_receipt');
    expect(f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override })).toMatchObject({ changed: true });
  } finally { f.close(); }
});
test('native final exact proof catches synthesized witness/grant corruption before receipt/effect publication', () => {
  for (const kind of ['witness', 'grant']) {
    const f = fixture();
    try {
      if (kind === 'witness') {
        f.grant(); const override = f.proof();
        f.raw.exec(`DROP TRIGGER ${WITNESSES}_update; CREATE TRIGGER synthetic_override_witness AFTER INSERT ON ${WITNESSES} BEGIN UPDATE ${WITNESSES} SET descriptor_hash='${'b'.repeat(64)}' WHERE id=NEW.id; END`);
        const before = f.state(); reject(() => f.command('appointment.create', { requestId: 'candidate', id: 'candidate', ...candidate, override }), 'CALENDAR_STATE_INVALID'); expect(f.state()).toBe(before);
      } else {
        f.raw.exec(`DROP TRIGGER ${GRANTS}_update; CREATE TRIGGER synthetic_override_grant AFTER INSERT ON ${GRANTS} BEGIN UPDATE ${GRANTS} SET enabled=0 WHERE id=NEW.id; END`);
        const before = f.state(); reject(() => f.grant(), 'CALENDAR_STATE_INVALID'); expect(f.state()).toBe(before);
      }
    } finally { f.close(); }
  }
});
