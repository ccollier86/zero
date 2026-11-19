/** Native MEMORY only; all source/read copies close in finally. No physical qualification. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { defineDatabaseRealm, runDatabaseRealmCommand, type DatabaseReadQueryContext } from '../databases/database-realm';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { Migrator, type Migration } from '../migrations/migrator';
import { createReactiveDB } from '../sync/reactive-db';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { hashMigration } from '../migrations/schema-snapshot';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm017 } from './test-support/calendar-realm-017';
import { CALENDAR_RESOURCE_LOCATION_POLICY_MIGRATION as migration, calendarResourceLocationPolicyTables } from './realm-location-policy-migration';
import { readCalendarResourceLocationCoverage, readCalendarResourceLocationPolicy, replaceCalendarResourceLocationPolicy } from './location-policies';
import { queryCalendarLocationAssignmentWitnesses } from './locations';
import { CALENDAR_LOCATION_POLICY_CURRENT as CURRENT, CALENDAR_LOCATION_POLICY_HISTORY as HISTORY, CALENDAR_LOCATION_POLICY_WINDOWS as WINDOWS,
  CALENDAR_LOCATION_POLICY_STATE as STATE, normalizeCalendarResourceLocationPolicy } from './location-policy-model';

const actor = { scopeId: 'tenant:synthetic-location-policy', userId: 'owner', principal: 'session.owner', manageAll: true, createOwn: true };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const visit = { mode: 'in-person', location: { id: 'office', revision: 1 } };
const effective = (startAt = '2030-01-01T09:00:00.000Z', endAt = '2030-01-01T17:00:00.000Z') => ({ kind: 'effective-utc-v1' as const, assignments: [{ locationId: 'office', windows: [{ startAt, endAt }] }] });
const migrations = [...calendarRealm017.migrations, migration];
const prepared = defineDatabaseRealm({ name: calendarRealm017.name, version: 'synthetic-location-policy018', tables: calendarResourceLocationPolicyTables(), migrations,
  commands: { ...calendarRealm017.commands, 'calendar.resource.location-policy': replaceCalendarResourceLocationPolicy }, queries: calendarRealm017.queries });
function rejected(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected native rejection'); }
  catch (error) { const actual = error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code;
    if (!actual) throw error; expect(actual).toBe(code); }
}
function fixture(upgrade = true, logging = false) {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase();
  let source: LoggingActorSource | undefined;
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, table] of Object.entries(calendarRealm017.tables)) db.defineTable(name, table);
    const migrate = (registry: readonly Migration[] = migrations) => {
      const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: [...registry], createBackups: false, log() {} });
      try { return migrator.run(); } finally { migrator.dispose(); }
    };
    expect(migrate(calendarRealm017.migrations)).toHaveLength(17);
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'synthetic-location-policy', scope: { kind: 'tenant', tenantId: 'synthetic-location-policy' }, sourceQueue: { maxEvents: 100 } }));
    let upgraded = false;
    const command = (name: string, body: Record<string, unknown> = {}): any => {
      const run = () => runDatabaseRealmCommand(upgraded ? prepared : calendarRealm017, db, 'calendar.' + name,
        (name === 'owner.bind' ? body : { actor, ...body }) as never);
      return (source ? source.run(loggingContext('synthetic-location-policy'), run) : run() as any).value;
    };
    command('owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-location-policy-owner' });
    const resource = (id: string) => command('resource.create', { requestId: 'resource-' + id, id, label: 'PRIVATE_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    resource('resource'); command('location.create', { requestId: 'office', id: 'office', label: 'PRIVATE_OFFICE' });
    const legacy = { requestId: 'legacy-locations', id: 'resource', expectedRevision: 1, locationIds: ['office'] }, oldReceipt = command('resource.locations', legacy);
    const appointment = (id: string, extra: Record<string, unknown> = {}) => command('appointment.create', { requestId: 'create-' + id, id,
      resourceIds: ['resource'], title: 'PRIVATE_APPOINTMENT', ...timed, visit, ...extra });
    const booking = appointment('accepted');
    const promote = () => { const result = migrate(); for (const [name, table] of Object.entries(calendarResourceLocationPolicyTables())) db.defineTable(name, table); upgraded = true; return result; };
    if (upgrade) expect(promote()).toEqual(['018']);
    const read = <T>(run: (context: DatabaseReadQueryContext) => T): T => { const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), run); } finally { copy.close(); } };
    const policy = (value: unknown = effective(), extra: Record<string, unknown> = {}) => command('resource.location-policy', {
      id: 'resource', requestId: 'policy-' + db.currentSeq, expectedRevision: db.get('calendar_resources', 'resource')!.revision, ...value as object, ...extra });
    const view = (subject = actor, id = 'resource') => read(context => readCalendarResourceLocationPolicy(context, { actor: subject, id }));
    const snapshot = () => JSON.stringify(Object.fromEntries(Object.keys(calendarResourceLocationPolicyTables()).map(name => [name, raw.query('SELECT * FROM ' + name + ' ORDER BY id').all()])));
    const close = () => { try { source?.close(); } finally { db.dispose(); } };
    return { db, raw, source, command, resource, legacy, oldReceipt, appointment, booking, promote, migrate, read, policy, view, snapshot, close };
  } catch (error) { try { source?.close(); } finally { db.dispose(); } throw error; }
}

test('normalizer detaches, sorts, merges adjacency/overlap, freezes and permits long explicit UTC windows', () => {
  const input = { kind: 'effective-utc-v1', assignments: [{ locationId: 'z', windows: [] }, { locationId: 'a', windows: [
    { startAt: '2040-01-01T00:00:00.000Z', endAt: '2050-01-01T00:00:00.000Z' },
    { startAt: '2030-01-01T00:00:00.000Z', endAt: '2040-01-01T00:00:00.000Z' }] }] };
  const result = normalizeCalendarResourceLocationPolicy(input);
  expect(result).toEqual({ kind: 'effective-utc-v1', assignments: [{ locationId: 'a', windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2050-01-01T00:00:00.000Z' }] }, { locationId: 'z', windows: [] }] });
  input.assignments[1]!.windows[0]!.endAt = '2045-01-01T00:00:00.000Z'; expect(Object.isFrozen(result)).toBe(true);
  if (result.kind !== 'effective-utc-v1') throw new Error('Expected effective source');
  expect(Object.isFrozen(result.assignments[0]!.windows[0])).toBe(true);
  expect(normalizeCalendarResourceLocationPolicy({ kind: 'static-v1', locationIds: ['z', 'a'] })).toEqual({ kind: 'static-v1', locationIds: ['a', 'z'] });
});
test('closed normalization rejects hostile descriptors, mixed kinds, duplicate IDs, bad dates and raw work limits without callbacks', () => {
  let invoked = 0; const accessor = Object.defineProperty({}, 'kind', { enumerable: true, get() { invoked++; return 'static-v1'; } });
  for (const input of [accessor, new Proxy({}, { ownKeys() { invoked++; return []; } }), { kind: 'static-v1', locationIds: ['a', 'a'] },
    { kind: 'static-v1', locationIds: [], assignments: [] }, effective('2030-01-02T00:00:00.000Z', '2030-01-01T00:00:00.000Z'),
    { kind: 'effective-utc-v1', assignments: [{ locationId: 'a', windows: Array(65).fill({ startAt: timed.startAt, endAt: timed.endAt }) }] },
    { kind: 'effective-utc-v1', assignments: Array.from({ length: 5 }, (_, i) => ({ locationId: 'r' + i, windows: Array(64).fill({ startAt: timed.startAt, endAt: timed.endAt }) })) },
    { kind: 'static-v1', locationIds: Array.from({ length: 17 }, (_, i) => 'r' + i) }, effective('2030-01-01', timed.endAt)]) rejected(() => normalizeCalendarResourceLocationPolicy(input), 'CALENDAR_INPUT_INVALID');
  expect(invoked).toBe(0);
});
test('maximum legal work fits the explicit normalized byte ceiling and long future intervals are never clamped', () => {
  const assignments = Array.from({ length: 16 }, (_, location) => ({ locationId: 'r' + String(location).padStart(3, '0') + 'x'.repeat(124),
    windows: Array.from({ length: location < 4 ? 64 : 0 }, (_, window) => ({ startAt: new Date(Date.parse('+010000-01-01T00:00:00.000Z') + window * 2000).toISOString(),
      endAt: new Date(Date.parse('+010000-01-01T00:00:00.000Z') + window * 2000 + 1000).toISOString() })) }));
  const input = { kind: 'effective-utc-v1', assignments };
  // Canonical extended-year endpoints are already27 characters. Concentrating
  // all256 windows in four entries adds twelve more separators than16x16.
  expect(new TextEncoder().encode(JSON.stringify(input)).length).toBe(23063);
  expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeLessThanOrEqual(24 * 1024);
  const normalized = normalizeCalendarResourceLocationPolicy(input);
  expect(normalized.kind).toBe('effective-utc-v1');
  if (normalized.kind !== 'effective-utc-v1') throw new Error('Expected effective source');
  expect(normalized.assignments.reduce((count, assignment) => count + assignment.windows.length, 0)).toBe(256);
  const smaller = normalizeCalendarResourceLocationPolicy({ kind: 'effective-utc-v1', assignments: assignments.slice(0, 15) });
  expect(smaller.kind).toBe('effective-utc-v1');
});
test('genuine populated017 upgrade derives only exact legacy selectors, preserving all old rows/receipts/sequences/checksums', () => {
  const f = fixture(false);
  try {
    const original = () => JSON.stringify(Object.entries(calendarRealm017.tables).map(([name, table]) => [name, f.raw.query(`SELECT ${Object.keys(table).filter(key => key !== '_identity').map(key => '"' + key + '"').join(',')} FROM ${name}${name === '_calendar_usage' ? " WHERE id<>'locationPolicyVersion'" : ''} ORDER BY id`).all()]));
    const before = original(), seq = f.db.currentSeq, hashes = calendarRealm017.migrations.map(hashMigration);
    expect(f.promote()).toEqual(['018']); expect(original()).toBe(before); expect(f.db.currentSeq).toBe(seq);
    expect(prepared.migrations.slice(0, 17).map(hashMigration)).toEqual(hashes);
    expect(f.db.list(HISTORY)).toEqual([]); expect(f.db.list(WINDOWS)).toEqual([]);
    expect(f.view().policy).toEqual({ kind: 'static-v1', locationIds: ['office'] });
    expect(f.command('resource.locations', f.legacy)).toEqual(f.oldReceipt); expect(f.migrate()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
test('effective policy, union, windows and one resource receipt/effect commit together; original replay/no-op are quiet', () => {
  const f = fixture();
  try {
    const accepted = f.policy(), before = f.snapshot(), seq = f.db.currentSeq;
    expect(accepted).toMatchObject({ operation: 'resource.location-policy-changed', revision: 3, changed: true });
    expect(f.db.list(HISTORY)).toHaveLength(1); expect(f.db.list(WINDOWS)).toHaveLength(1); expect(f.view().policy).toEqual(effective());
    expect(f.command('resource.location-policy', { id: 'resource', requestId: accepted.requestId, expectedRevision: 2, ...effective() })).toEqual(accepted);
    expect(f.snapshot()).toBe(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.policy()).toMatchObject({ changed: false, revision: 3 }); expect(f.db.list(HISTORY)).toHaveLength(1);
    expect(f.command('resource.locations', f.legacy)).toEqual(f.oldReceipt);
    rejected(() => f.command('resource.locations', { ...f.legacy, requestId: 'cannot-flatten', expectedRevision: 3 }), 'CALENDAR_LOCATION_FORMAT_UNSUPPORTED');
    f.policy({ kind: 'static-v1', locationIds: ['office'] });
    f.command('resource.locations', { requestId: 'static-legacy-clear', id: 'resource', expectedRevision: 4, locationIds: [] });
    expect(f.view().policy).toEqual({ kind: 'static-v1', locationIds: [] }); expect(f.db.list(HISTORY)).toHaveLength(3);
  } finally { f.close(); }
});
test('whole occupied interval, buffers and every selected resource are admitted while retained metadata edits stay grandfathered', () => {
  const f = fixture();
  try {
    f.policy(effective('2030-01-01T10:00:00.000Z', '2030-01-01T11:00:00.000Z'));
    rejected(() => f.appointment('buffer-gap', { bufferBeforeMinutes: 1 }), 'CALENDAR_VISIT_CONFLICT');
    rejected(() => f.appointment('end-gap', { endAt: '2030-01-01T11:00:00.001Z' }), 'CALENDAR_VISIT_CONFLICT');
    f.policy(effective('2030-01-02T09:00:00.000Z', '2030-01-02T17:00:00.000Z'));
    f.command('appointment.update', { requestId: 'title-retained', id: 'accepted', expectedRevision: 1, title: 'PRIVATE_RENAMED' });
    f.command('appointment.participants', { requestId: 'people-retained', id: 'accepted', expectedRevision: 2, references: [{ kind: 'guardian-user', userId: 'participant' }] });
    rejected(() => f.command('appointment.update', { requestId: 'move-refused', id: 'accepted', expectedRevision: 3, ...timed, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' }), 'CALENDAR_VISIT_CONFLICT');
    f.command('appointment.cancel', { requestId: 'cancel-retained', id: 'accepted', expectedRevision: 3, confirmed: true });
    expect(f.db.get('calendar_appointments', 'accepted')!.status).toBe('cancelled');
  } finally { f.close(); }
});
test('holds acquire whole coverage and confirmation rechecks captured resource revision instead of treating a hold as an exception', () => {
  const f = fixture();
  try {
    f.policy(); const input = { requestId: 'held', id: 'hold', resourceIds: ['resource'], ...timed, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', visit };
    f.command('hold.acquire', input); f.policy(effective('2030-01-02T00:00:00.000Z', '2030-01-03T00:00:00.000Z'));
    rejected(() => f.command('hold.confirm', { requestId: 'confirm-stale', id: 'hold', appointmentId: 'from-hold', expectedRevision: 1, title: 'PRIVATE' }), 'CALENDAR_HOLD_STALE');
    rejected(() => f.command('hold.acquire', { ...input, requestId: 'outside-hold', id: 'outside' }), 'CALENDAR_VISIT_CONFLICT');
    expect(f.db.get('calendar_holds', 'hold')!.status).toBe('held');
  } finally { f.close(); }
});
test('31 LocalDates crossing fall-back use frozen33-day occupancy instead of timed31-day coercion or current Temporal', () => {
  const f = fixture(), temporal = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    f.policy(effective('2026-10-15T04:00:00.000Z', '2026-11-15T05:00:00.000Z'));
    f.command('appointment.create', { requestId: 'all-day', id: 'all-day', resourceIds: ['resource'], title: 'PRIVATE', visit,
      interval: { kind: 'all-day-local-v1', startDate: '2026-10-15', endDate: '2026-11-15', timeZone: 'America/New_York' } });
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: undefined });
    const allowed = f.read(context => readCalendarResourceLocationCoverage(context, actor.scopeId, 'resource').allows('office', Date.parse('2026-10-15T04:00:00.000Z'), Date.parse('2026-11-15T05:00:00.000Z')));
    expect(allowed).toBe(true);
    f.command('appointment.update', { requestId: 'all-day-title', id: 'all-day', expectedRevision: 1, title: 'PRIVATE_RENAMED' });
  } finally { if (temporal) Object.defineProperty(globalThis, 'Temporal', temporal); else Reflect.deleteProperty(globalThis, 'Temporal'); f.close(); }
});
test('late quota/pointer faults atomically roll back policy, union, parent, windows, usages and receipt', () => {
  const f = fixture();
  try {
    for (const [key, count] of [['locationPolicyHistory', 100000], ['locationPolicyWindows', 1000000]] as const) {
      f.db.createStrict('_calendar_usage', { id: key, count }); const before = f.snapshot(), seq = f.db.currentSeq;
      rejected(() => f.policy(), 'CALENDAR_CAPACITY'); expect(f.snapshot()).toBe(before); expect(f.db.currentSeq).toBe(seq);
      f.db.delete('_calendar_usage', key);
    }
    f.raw.run(`CREATE TRIGGER synthetic_late_policy BEFORE UPDATE ON ${CURRENT} BEGIN SELECT RAISE(ABORT,'synthetic late pointer'); END`);
    const before = f.snapshot(), seq = f.db.currentSeq; expect(() => f.policy()).toThrow(); expect(f.snapshot()).toBe(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});
test('every current co-resource coverage is mandatory and returning static policy preserves immutable effective history', () => {
  const f = fixture();
  try {
    f.resource('room'); f.command('resource.locations', { id: 'room', requestId: 'room-office', expectedRevision: 1, locationIds: ['office'] });
    f.policy(); f.command('resource.location-policy', { id: 'room', requestId: 'room-closed', expectedRevision: 2,
      ...effective('2030-01-02T00:00:00.000Z', '2030-01-03T00:00:00.000Z') });
    rejected(() => f.appointment('all-resources', { resourceIds: ['resource', 'room'], startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' }), 'CALENDAR_VISIT_CONFLICT');
    const old = f.db.list(HISTORY);
    f.command('resource.location-policy', { id: 'room', requestId: 'room-static', expectedRevision: 3, kind: 'static-v1', locationIds: ['office'] });
    f.appointment('all-resources', { resourceIds: ['resource', 'room'], startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    for (const row of old) expect(f.db.get(HISTORY, String(row.id))).toEqual(row);
  } finally { f.close(); }
});
test('nonmanager new-location witnesses need current native visibility but exact accepted replay never grants a new selection', () => {
  const f = fixture(), subject = { ...actor, manageAll: false };
  try {
    f.command('location.create', { requestId: 'hidden-office', id: 'hidden', label: 'PRIVATE_HIDDEN' });
    f.command('resource.create', { requestId: 'private-room', id: 'private-room', label: 'PRIVATE_ROOM', kind: 'room', ownerId: null, timeZone: 'UTC' });
    f.command('resource.locations', { requestId: 'private-room-hidden', id: 'private-room', expectedRevision: 1, locationIds: ['hidden'] });
    const patch = { actor: subject, id: 'resource', requestId: 'delegated-policy', expectedRevision: 2, kind: 'effective-utc-v1', assignments: [{ locationId: 'hidden', windows: [] }] };
    rejected(() => f.command('resource.location-policy', patch), 'CALENDAR_NOT_FOUND');
    rejected(() => f.command('resource.location-policy', { ...patch, locationWitnesses: [{ locationId: 'hidden', resourceId: 'private-room' }] }), 'CALENDAR_NOT_FOUND');
    f.command('resource.grant', { requestId: 'show-witness', id: 'private-room', expectedRevision: 2, userId: actor.userId, grants: ['busy'] });
    const witnesses = f.read(context => queryCalendarLocationAssignmentWitnesses(context, { actor: subject, locationIds: ['hidden'] }));
    expect(witnesses).toEqual([{ locationId: 'hidden', resourceId: 'private-room' }]);
    f.command('resource.grant', { requestId: 'revoke-witness', id: 'private-room', expectedRevision: 3, userId: actor.userId, grants: [] });
    rejected(() => f.command('resource.location-policy', { ...patch, locationWitnesses: witnesses }), 'CALENDAR_NOT_FOUND');
    f.command('resource.grant', { requestId: 'show-again', id: 'private-room', expectedRevision: 4, userId: actor.userId, grants: ['busy'] });
    const accepted = f.command('resource.location-policy', { ...patch, locationWitnesses: witnesses });
    expect(f.command('resource.location-policy', patch)).toEqual(accepted);
    const stranger = { ...subject, userId: 'stranger', principal: 'stranger' };
    rejected(() => f.command('resource.location-policy', { ...patch, actor: stranger }), 'CALENDAR_NOT_FOUND');
    rejected(() => f.view(stranger), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});
test('native final seal rejects malformed compiled cells in an unsealed generation and rolls every domain fact back', () => {
  const f = fixture();
  try {
    // Corrupt this owned MEMORY fixture's compiled projection during insertion;
    // disabling its immutable-update guard is deliberate fault injection only.
    f.raw.run(`DROP TRIGGER ${WINDOWS}_update`);
    f.raw.run(`CREATE TRIGGER synthetic_bad_cell AFTER INSERT ON ${WINDOWS} BEGIN UPDATE ${WINDOWS} SET start_ms=start_ms-1 WHERE id=NEW.id; END`);
    const before = f.snapshot(), seq = f.db.currentSeq;
    rejected(() => f.policy(), 'CALENDAR_STATE_INVALID');
    expect(f.snapshot()).toBe(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});
test('semantic evidence records safe format/count facts once, never authored windows/labels or no-op/replay success', () => {
  const f = fixture(true, true);
  try {
    const initial = f.source!.control({}); f.source!.control({ acknowledge: initial.rows.map(row => row.id) });
    const accepted = f.policy(); f.command('resource.location-policy', { id: 'resource', requestId: accepted.requestId, expectedRevision: 2, ...effective() }); f.policy();
    const rows = f.source!.control({}).rows;
    expect(rows).toHaveLength(1); const json = JSON.stringify(rows);
    expect(json).toContain('resource.location-policy-changed'); expect(json).toContain('effective-utc-v1');
    expect(json).not.toMatch(/PRIVATE_|2030-|source_json|startAt|endAt/);
  } finally { f.close(); }
});
test('native state/marker/history/windows/selectors and directory projections refuse late attachment, replacement and identity corruption', () => {
  const f = fixture();
  try {
    f.policy();
    for (const sql of [`DELETE FROM ${HISTORY}`, `DELETE FROM ${WINDOWS}`, `DELETE FROM ${CURRENT}`, `UPDATE ${WINDOWS} SET end_ms=end_ms+1`,
      `UPDATE ${CURRENT} SET source_kind='legacy',history_id=NULL,resource_revision=resource_revision+1`, `UPDATE ${STATE} SET version=18`,
      "DELETE FROM _calendar_usage WHERE id='locationPolicyVersion'", "INSERT OR REPLACE INTO _calendar_usage VALUES('locationPolicyVersion',18)",
      'DELETE FROM _calendar_resource_location_current']) expect(() => f.raw.run(sql)).toThrow();
    expect(f.view().policy).toEqual(effective());
  } finally { f.close(); }
});
for (const table of [STATE, CURRENT, HISTORY, WINDOWS]) test('partial018 removal fails closed without repairing or falling back: ' + table, () => {
  const f = fixture();
  try {
    f.policy();
    const copy = Database.deserialize(f.raw.serialize(), { strict: true });
    try {
      copy.run('PRAGMA foreign_keys=OFF'); copy.run('DROP TABLE ' + table); copy.run('PRAGMA query_only=ON'); const before = copy.serialize();
      rejected(() => withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => readCalendarResourceLocationPolicy(context, { actor, id: 'resource' })), 'CALENDAR_STATE_INVALID');
      expect(copy.serialize()).toEqual(before);
    } finally { copy.close(); }
    expect(f.view().policy).toEqual(effective());
  } finally { f.close(); }
});
for (const marker of [true, false]) test('all018 tables missing cannot recover legacy union through ' + (marker ? 'retained marker' : 'retained native/compat ledger'), () => {
  const f = fixture();
  try {
    f.policy(); const copy = Database.deserialize(f.raw.serialize(), { strict: true });
    try {
      copy.run('PRAGMA foreign_keys=OFF');
      for (const table of [CURRENT, WINDOWS, HISTORY, STATE]) copy.run('DROP TABLE ' + table);
      if (!marker) {
        copy.run('DROP TRIGGER calendar_location_policy_marker_delete'); copy.run("DELETE FROM _calendar_usage WHERE id='locationPolicyVersion'");
      }
      copy.run('PRAGMA query_only=ON');
      rejected(() => withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => readCalendarResourceLocationCoverage(context, actor.scopeId, 'resource')), 'CALENDAR_STATE_INVALID');
    } finally { copy.close(); }
  } finally { f.close(); }
});
test('missing selector and forged directory/window rows reject before a current policy can be treated as empty or free', () => {
  const f = fixture();
  try {
    f.policy();
    for (const sql of [`DROP TRIGGER ${CURRENT}_retain; DELETE FROM ${CURRENT}`,
      'DROP TRIGGER calendar_location_policy_directory__calendar_resource_location_current_delete; DELETE FROM _calendar_resource_location_current',
      `DROP TRIGGER ${WINDOWS}_update; UPDATE ${WINDOWS} SET start_ms=start_ms-1`]) {
      const copy = Database.deserialize(f.raw.serialize(), { strict: true });
      try { copy.exec(sql); copy.run('PRAGMA query_only=ON');
        rejected(() => withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => readCalendarResourceLocationCoverage(context, actor.scopeId, 'resource')), 'CALENDAR_STATE_INVALID');
      } finally { copy.close(); }
    }
  } finally { f.close(); }
});
for (const corruption of ['missing17state', 'malformed18table', 'unexpected18trigger', 'lost004members'] as const) test('corrupt populated017 preparation refuses atomically without repair: ' + corruption, () => {
  const f = fixture(false);
  try {
    if (corruption === 'missing17state') f.raw.exec('DROP TRIGGER _calendar_appointment_time_state_delete; DELETE FROM _calendar_appointment_time_state');
    else if (corruption === 'malformed18table') f.raw.run(`CREATE TABLE ${STATE}(id TEXT PRIMARY KEY)`);
    else if (corruption === 'unexpected18trigger') f.raw.exec(`CREATE TABLE ${STATE}(id TEXT PRIMARY KEY NOT NULL CHECK(id='application'),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=18)); CREATE TRIGGER synthetic_unexpected BEFORE INSERT ON ${STATE} BEGIN SELECT RAISE(ABORT,'synthetic'); END`);
    else f.raw.exec('DELETE FROM _calendar_resource_location_current');
    const retained = () => JSON.stringify(Object.keys(calendarRealm017.tables).map(table => [table, f.raw.query('SELECT * FROM ' + table + ' ORDER BY id').all()]));
    const before = retained(), seq = f.db.currentSeq;
    expect(() => f.migrate()).toThrow(); expect(retained()).toBe(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.get('_calendar_usage', 'locationPolicyVersion')).toBeNull();
  } finally { f.close(); }
});
test('late018 upgrade failure rolls backDDL/derivedselectors/marker/ledger and leaves populated017 retryable', () => {
  const f = fixture(false);
  try {
    const before = f.raw.serialize(), seq = f.db.currentSeq;
    const failing = { ...migration, up(database: Parameters<Migration['up']>[0]) { migration.up(database); throw new Error('synthetic late018'); } };
    expect(() => f.migrate([...calendarRealm017.migrations, failing])).toThrow('synthetic late018');
    expect(f.raw.query("SELECT 1 FROM sqlite_schema WHERE name=?").get(STATE)).toBeNull(); expect(f.db.get('_calendar_usage', 'locationPolicyVersion')).toBeNull();
    expect(f.db.currentSeq).toBe(seq); expect(f.raw.query('SELECT * FROM _migrations').all()).toHaveLength(17);
    expect(f.promote()).toEqual(['018']); expect(f.view().policy).toEqual({ kind: 'static-v1', locationIds: ['office'] });
    expect(before.byteLength).toBeGreaterThan(0);
  } finally { f.close(); }
});
