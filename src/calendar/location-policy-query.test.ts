/** Actual native realm/readonly MEMORY queries; no physical fixture or provider. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarLocationPage } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import type { CalendarResourceLocationPolicyInput } from './location-policy-contracts';
import { CALENDAR_LOCATION_POLICY_CURRENT as CURRENT, CALENDAR_LOCATION_POLICY_HISTORY as HISTORY,
  CALENDAR_LOCATION_POLICY_STATE as STATE, CALENDAR_LOCATION_POLICY_WINDOWS as WINDOWS } from './location-policy-model';
import { calendarRealm } from './realm';

const actor: CalendarActor = { scopeId: 'tenant:synthetic-location-policy-query', userId: 'manager', principal: 'session.manager', manageAll: true, createOwn: true };
const viewer: CalendarActor = { ...actor, userId: 'viewer', principal: 'session.viewer', manageAll: false };
const occupied = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z' };
const window = (startAt = '2030-01-01T09:00:00.000Z', endAt = '2030-01-01T12:00:00.000Z') => ({ startAt, endAt });
const effective = (locationId: string, windows = [window()]): CalendarResourceLocationPolicyInput => ({ kind: 'effective-utc-v1', assignments: [{ locationId, windows }] });
interface Plan { sql: string; params: unknown[]; count: number; detail: string }
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, table] of Object.entries(calendarRealm.tables)) db.defineTable(name, table);
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: [...calendarRealm.migrations], createBackups: false, log() {} });
    try { migrator.run(); } finally { migrator.dispose(); }
    const command = (name: string, body: Record<string, unknown>) => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, cloneDatabaseSerializableValue(body));
    command('owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-location-policy-owner' });
    const resource = (id = 'resource', ownerId = actor.userId) => command('resource.create', { actor, id, requestId: 'resource-' + id,
      label: 'PRIVATE_RESOURCE_' + id, kind: 'person', ownerId, timeZone: 'UTC' });
    const location = (id = 'office') => command('location.create', { actor, id, requestId: 'location-' + id, label: 'PRIVATE_LOCATION_' + id, region: null, active: true });
    const policy = (input: CalendarResourceLocationPolicyInput, id = 'resource', extra: Record<string, unknown> = {}) => command('resource.location-policy', {
      actor, id, requestId: 'policy-' + db.currentSeq, expectedRevision: db.get('calendar_resources', id)!.revision, ...input, ...extra });
    const assign = (ids: string[], id = 'resource', extra: Record<string, unknown> = {}) => command('resource.locations', {
      actor, id, requestId: 'assignment-' + db.currentSeq, expectedRevision: db.get('calendar_resources', id)!.revision, locationIds: ids, ...extra });
    const grant = (id: string, grants: string[]) => command('resource.grant', { actor, id, requestId: 'grant-' + db.currentSeq,
      expectedRevision: db.get('calendar_resources', id)!.revision, userId: viewer.userId, grants });
    const plans: Plan[] = [];
    const query = (patch: Record<string, unknown> = {}, observe = false): CalendarLocationPage => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true }), prepare = copy.prepare.bind(copy);
      const observer = observe ? spyOn(copy, 'prepare').mockImplementation(<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, bindings?: TParams) => {
        const statement = prepare<TRow, TParams>(sql, bindings);
        return new Proxy(statement, { get(target, key) {
          const member = Reflect.get(target, key);
          if (key === 'all' || key === 'get') return (...params: never[]) => {
            const rows = member.apply(target, params), explain = prepare('EXPLAIN QUERY PLAN ' + sql);
            try { plans.push({ sql, params, count: Array.isArray(rows) ? rows.length : rows === null ? 0 : 1,
              detail: (explain.all(...params) as { detail: string }[]).map(row => row.detail).join('\n') }); }
            finally { explain.finalize(); }
            return rows;
          };
          return typeof member === 'function' ? member.bind(target) : member;
        } });
      }) : null;
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context,
          'calendar.visitLocations', cloneDatabaseSerializableValue({ actor, resourceIds: ['resource'], ...patch }))) as unknown as CalendarLocationPage;
      } finally { observer?.mockRestore(); copy.close(); }
    };
    const state = () => JSON.stringify(Object.fromEntries(Object.keys(calendarRealm.tables).map(name => [name, db.list(name)])));
    return { db, raw, command, resource, location, policy, assign, grant, plans, query, state, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}
function rejected(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(code); }
}
function removeFixtureTriggers(database: Database, table: string): void {
  const query = database.prepare<{ name: string }, [string]>("SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name=?");
  try { for (const row of query.all(table)) database.run('DROP TRIGGER "' + row.name.replaceAll('"', '""') + '"'); }
  finally { query.finalize(); }
}

test('legacy and explicit static assignments retain all-time interval-free and whole-interval directory semantics', () => {
  const f = fixture();
  try {
    f.resource(); f.location(); f.assign(['office']);
    const expected = f.query(); expect(expected.items.map(item => item.id)).toEqual(['office']);
    expect(f.query({ interval: occupied })).toEqual(expected);
    expect(f.query({ interval: { startAt: '0000-01-01T00:00:00.000Z', endAt: '0000-02-03T00:00:00.000Z' } })).toEqual(expected);
    f.policy({ kind: 'static-v1', locationIds: ['office'] }); expect(f.query({ interval: occupied })).toEqual(expected);
    const before = f.raw.serialize(), sequence = f.db.currentSeq;
    expect(f.query({ resourceIds: [] })).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.query({ resourceIds: [], interval: occupied })).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
  } finally { f.close(); }
});

test('effective coverage merges adjacent windows but never stitches across gaps or different locations', () => {
  const f = fixture();
  try {
    f.resource(); for (const id of ['adjacent', 'gap', 'other']) f.location(id);
    f.policy({ kind: 'effective-utc-v1', assignments: [
      { locationId: 'adjacent', windows: [window('2030-01-01T10:30:00.000Z', '2030-01-01T11:00:00.000Z'), window('2030-01-01T09:00:00.000Z', '2030-01-01T10:30:00.000Z')] },
      { locationId: 'gap', windows: [window('2030-01-01T09:00:00.000Z', '2030-01-01T10:30:00.000Z'), window('2030-01-01T10:31:00.000Z', '2030-01-01T12:00:00.000Z')] },
      { locationId: 'other', windows: [window('2030-01-01T10:30:00.000Z', '2030-01-01T12:00:00.000Z')] },
    ] });
    expect(f.query().items.map(item => item.id)).toEqual(['adjacent', 'gap', 'other']);
    expect(f.query({ interval: occupied }).items.map(item => item.id)).toEqual(['adjacent']);
    expect(f.query({ interval: { ...occupied, startAt: '2030-01-01T11:00:00.000Z', endAt: '2030-01-01T12:00:00.000Z' } }).items.map(item => item.id)).toEqual(['gap', 'other']);
  } finally { f.close(); }
});

test('full eligibility is checked for every selected resource before public pagination and truncation', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('second'); for (const id of ['a-ineligible', 'b-eligible', 'c-eligible']) f.location(id);
    const ids = ['a-ineligible', 'b-eligible', 'c-eligible']; f.assign(ids, 'second');
    f.policy({ kind: 'effective-utc-v1', assignments: ids.map(locationId => ({ locationId,
      windows: [locationId === 'a-ineligible' ? window('2030-01-01T09:00:00.000Z', '2030-01-01T10:30:00.000Z') : window()] })) });
    const query = { resourceIds: ['second', 'resource'], interval: occupied, limit: 1 };
    const first = f.query(query); expect(first).toMatchObject({ items: [{ id: 'b-eligible' }], truncated: true, nextAfter: 'b-eligible' });
    expect(f.query({ ...query, after: first.nextAfter })).toMatchObject({ items: [{ id: 'c-eligible' }], truncated: false, nextAfter: null });
    f.policy(effective('b-eligible', [window('2030-01-01T09:00:00.000Z', '2030-01-01T10:30:00.000Z')]), 'second');
    expect(f.query(query)).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.query({ resourceIds: ['second', 'resource'] }).items.map(item => item.id)).toEqual(['b-eligible']);
  } finally { f.close(); }
});

test('all co-resource book authorization precedes policy and private directory reads', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('hidden'); f.location(); f.assign(['office']); f.assign(['office'], 'hidden'); f.grant('resource', ['book']);
    rejected(() => f.query({ actor: viewer, resourceIds: ['resource', 'hidden'], interval: occupied }, true), 'CALENDAR_NOT_FOUND');
    expect(f.plans.some(plan => plan.sql.includes('FROM ' + CURRENT) || plan.sql.includes('FROM ' + HISTORY) || plan.sql.includes('FROM calendar_locations'))).toBe(false);
    f.grant('hidden', ['book']); expect(f.query({ actor: viewer, resourceIds: ['resource', 'hidden'], interval: occupied }).items[0]!.id).toBe('office');
    f.grant('resource', ['details', 'busy']); rejected(() => f.query({ actor: viewer, interval: occupied }), 'CALENDAR_NOT_FOUND');
    rejected(() => f.query({ actor: { ...actor, scopeId: 'tenant:other' }, interval: occupied }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('current policy changes and failed writes preserve precise query truth, replay and retained generations', () => {
  const f = fixture();
  try {
    f.resource(); f.location();
    const first = f.policy(effective('office'), 'resource', { requestId: 'accepted', expectedRevision: 1 });
    const retained = f.db.list(HISTORY), sequence = f.db.currentSeq;
    expect(f.query({ interval: occupied }).items[0]!.id).toBe('office');
    expect(f.policy(effective('office'), 'resource', { requestId: 'accepted', expectedRevision: 1 })).toEqual(first); expect(f.db.currentSeq).toBe(sequence);
    f.raw.run("CREATE TRIGGER synthetic_policy_failure BEFORE INSERT ON _calendar_receipts WHEN NEW.request_id='rollback' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");
    const before = f.state();
    expect(() => f.policy(effective('office', []), 'resource', { requestId: 'rollback' })).toThrow();
    expect(f.state()).toBe(before); expect(f.query({ interval: occupied }).items[0]!.id).toBe('office');
    f.policy(effective('office', [])); expect(f.query({ interval: occupied }).items).toEqual([]);
    expect(f.query().items[0]!.id).toBe('office'); expect(f.db.get(HISTORY, String(retained[0]!.id))).toEqual(retained[0]!);
  } finally { f.close(); }
});

test('occupied query intervals are closed canonical UTC strings, positive and bounded at33 elapsed days', () => {
  const f = fixture();
  try {
    f.resource(); f.location(); f.assign(['office']);
    for (const interval of [null, {}, { ...occupied, timeZone: 'UTC' }, { startAt: occupied.startAt }, { ...occupied, startAt: Date.parse(occupied.startAt) },
      { ...occupied, startAt: '2030-01-01T10:00:00Z' }, { ...occupied, endAt: occupied.startAt },
      { ...occupied, endAt: '2030-02-03T10:00:00.001Z' }]) rejected(() => f.query({ interval }), 'CALENDAR_INPUT_INVALID');
    expect(f.query({ interval: { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-02-03T10:00:00.000Z' } }).items[0]!.id).toBe('office');
  } finally { f.close(); }
});

test('queries seed indexed current IDs and seek only the selected policy generation despite retained history', () => {
  const f = fixture();
  try {
    f.resource(); f.location();
    for (let index = 0; index < 24; index++) f.policy(effective('office', [window('2030-01-01T' + String(index).padStart(2, '0') + ':00:00.000Z', '2030-01-02T00:00:00.000Z')]));
    f.policy(effective('office')); const before = f.raw.serialize();
    expect(f.query({ interval: occupied, limit: 1 }, true).items[0]!.id).toBe('office');
    expect(f.plans.filter(plan => plan.sql.startsWith('SELECT m.location_id'))[0]!.count).toBe(1);
    const history = f.plans.filter(plan => plan.sql.includes('FROM ' + HISTORY));
    expect(history).toHaveLength(2);
    for (const plan of history) { expect(plan.count).toBe(1); expect(plan.sql).toMatch(/WHERE (?:id=\?|scope_id=\?.*LIMIT 1)/s); expect(plan.detail).not.toMatch(/SCAN .*location_policy_history/); }
    const windows = f.plans.filter(plan => plan.sql.includes('FROM ' + WINDOWS)); expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const plan of windows) { expect(plan.sql).toMatch(/(?:history_id|resource_revision)=\?/); expect(plan.detail).not.toMatch(/SCAN .*location_policy_windows/); expect(plan.count).toBeLessThanOrEqual(257); }
    expect(windows.some(plan => plan.sql.includes('start_ms') && plan.sql.includes('LIMIT 1') && plan.detail.includes('calendar_location_policy_coverage'))).toBe(true);
    expect(f.raw.serialize()).toEqual(before);
  } finally { f.close(); }
});

for (const broken of ['selector', 'state', 'directory-union', 'window'] as const) test('corrupt018 ' + broken + ' cannot become false empty eligibility or repaired state', () => {
  const f = fixture();
  try {
    f.resource(); f.location(); f.policy(effective('office'));
    const table = broken === 'selector' ? CURRENT : broken === 'state' ? STATE : broken === 'window' ? WINDOWS : '_calendar_resource_location_current';
    removeFixtureTriggers(f.raw, table); f.raw.run('DELETE FROM "' + table + '"');
    const before = f.raw.serialize();
    rejected(() => f.query({ interval: occupied }), 'CALENDAR_STATE_INVALID'); rejected(() => f.query(), 'CALENDAR_STATE_INVALID');
    expect(f.raw.serialize()).toEqual(before);
  } finally { f.close(); }
});
