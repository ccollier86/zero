/** Native MEMORY transactions/read-only copies only; no physical-file qualification. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery, type DatabaseReadQueryContext } from '../databases/database-realm';
import { cloneDatabaseSerializableValue, type DatabaseSerializableValue } from '../databases/database-operations';
import { Migrator } from '../migrations/migrator';
import { createReactiveDB } from '../sync/reactive-db';
import { calendarAppointmentDateWindow } from './appointment-date-query';
import type { CalendarActor, CalendarAllDayAppointmentInterval, CalendarAppointmentPage } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { calendarRealm016 } from './test-support/calendar-realm-016';
import { queryCalendarAppointmentDates, queryCalendarAppointments, queryCalendarBusy, readCalendarAppointment } from './realm-queries';
import { CALENDAR_APPOINTMENT_TIME_CURRENT as CURRENT, CALENDAR_APPOINTMENT_TIME_HISTORY as HISTORY } from './appointment-time-bindings';

const manager: CalendarActor = { scopeId: 'tenant:synthetic-date-query', userId: 'manager', principal: 'session.manager', manageAll: true, createOwn: true };
const viewer: CalendarActor = { ...manager, userId: 'viewer', principal: 'session.viewer', manageAll: false };
const timed = { startAt: '2026-04-01T12:00:00.000Z', endAt: '2026-04-01T13:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const interval = (startDate = '2026-04-01', endDate = '2026-04-02', timeZone = 'UTC'): CalendarAllDayAppointmentInterval => ({ kind: 'all-day-local-v1', startDate, endDate, timeZone });
function fixture(upgrade = true) {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    const realm = upgrade ? calendarRealm : calendarRealm016;
    for (const [name, table] of Object.entries(calendarRealm016.tables)) db.defineTable(name, table);
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: [...realm.migrations], createBackups: false, log() {} });
    try { migrator.run(); } finally { migrator.dispose(); }
    if (upgrade) for (const [name, table] of Object.entries(calendarRealm.tables)) db.defineTable(name, table);
    const command = (name: string, body: Record<string, unknown> = {}) => runDatabaseRealmCommand(realm, db, 'calendar.' + name,
      (name === 'owner.bind' ? body : { actor: manager, ...body }) as DatabaseSerializableValue);
    command('owner.bind', { scopeId: manager.scopeId, ownerId: 'synthetic-date-query-owner' });
    const resource = (id: string, ownerId: string | null = manager.userId) => command('resource.create', { requestId: 'resource-' + id, id,
      label: 'PRIVATE_RESOURCE_' + id, kind: ownerId ? 'person' : 'room', ownerId, timeZone: 'UTC' });
    const appointment = (id: string, resourceIds: string[], value: CalendarAllDayAppointmentInterval = interval(), patch: Record<string, unknown> = {}) =>
      command('appointment.create', { requestId: 'create-' + id, id, title: 'PRIVATE_TITLE_' + id, resourceIds, interval: value, ...patch });
    const grant = (id: string, grants: string[], userId = viewer.userId) => command('resource.grant', { requestId: 'grant-' + db.currentSeq, id,
      expectedRevision: db.get('calendar_resources', id)!.revision, userId, grants });
    const read = <T>(run: (context: DatabaseReadQueryContext) => T): T => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), run); }
      finally { copy.close(); }
    };
    const dates = (patch: Record<string, unknown> = {}) => read(context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.appointmentsByDate',
      cloneDatabaseSerializableValue({ actor: manager, resourceIds: ['resource'], startDate: '2026-04-01', endDate: '2026-04-02', ...patch }))) as unknown as CalendarAppointmentPage;
    const detail = (id: string, actor = manager) => read(context => readCalendarAppointment(context, { actor, id }));
    return { db, raw, command, resource, appointment, grant, read, dates, detail, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}
function rejected(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('expected rejection'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(code); }
}

test('date windows use exact Gregorian nominal days, including leap years and four-digit domain edges', () => {
  expect(calendarAppointmentDateWindow('2028-02-01', '2028-03-03')).toEqual({ startDate: '2028-02-01', endDate: '2028-03-03', lookbackStartDate: '2028-01-01' });
  expect(calendarAppointmentDateWindow('0000-01-01', '0000-02-01').lookbackStartDate).toBe('0000-01-01');
  expect(calendarAppointmentDateWindow('9999-12-30', '9999-12-31').lookbackStartDate).toBe('9999-11-29');
  for (const [start, end] of [['2026-02-29', '2026-03-01'], ['2026-04-31', '2026-05-01'], ['2026-4-01', '2026-04-02'],
    ['2026-04-01', '2026-04-01'], ['2026-04-02', '2026-04-01'], ['2026-04-01', '2026-05-03'],
    ['-000001-01-01', '0000-01-01'], ['9999-12-31', '+010000-01-01'], ['2026-04-01T00:00:00.000Z', '2026-04-02']]) {
    rejected(() => calendarAppointmentDateWindow(start, end), 'CALENDAR_INPUT_INVALID');
  }
});

test('the same authored date is selected across zones independently of the frozen UTC projection', () => {
  const f = fixture();
  try {
    for (const id of ['east', 'west', 'timed']) f.resource(id);
    const east = interval('2026-04-01', '2026-04-02', 'Pacific/Kiritimati'), west = interval('2026-04-01', '2026-04-02', 'US/Pacific');
    f.appointment('east', ['east'], east); f.appointment('west', ['west'], west);
    f.command('appointment.create', { requestId: 'timed', id: 'timed', title: 'PRIVATE_TIMED', resourceIds: ['timed'], ...timed });
    const before = f.raw.serialize(), seq = f.db.currentSeq;
    const page = f.dates({ resourceIds: ['west', 'east', 'timed'] });
    expect(page.items.map(item => item.id)).toEqual(['east', 'west']); expect(page.truncated).toBe(false);
    expect(page.items[0]!).toMatchObject({ interval: east, startAt: '2026-03-31T10:00:00.000Z' });
    expect(page.items[1]!).toMatchObject({ interval: west, startAt: '2026-04-01T07:00:00.000Z', timeZone: f.db.get('calendar_appointments', 'west')!.time_zone });
    expect(f.detail('east').interval).toEqual(east); expect(f.detail('west').interval).toEqual(west);
    const timedView = f.detail('timed'); expect(Object.hasOwn(timedView, 'interval')).toBe(false);
    expect(timedView).toMatchObject(timed);
    expect(f.dates({ resourceIds: ['east', 'west'], startDate: '2026-03-31', endDate: '2026-04-01' })).toEqual({ items: [], truncated: false });
    expect(f.dates({ resourceIds: ['east', 'west'], startDate: '2026-04-02', endDate: '2026-04-03' })).toEqual({ items: [], truncated: false });
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('31-date fall-back facts overlap nominal query dates and retain read authority without Temporal or Intl', () => {
  const f = fixture(), temporal = Object.getOwnPropertyDescriptor(globalThis, 'Temporal'), intl = Object.getOwnPropertyDescriptor(Intl, 'DateTimeFormat');
  try {
    f.resource('resource'); const authored = interval('2026-10-15', '2026-11-15', 'America/New_York');
    f.appointment('fall-back', ['resource'], authored);
    const row = f.db.get('calendar_appointments', 'fall-back')!, { start_at: startAt, end_at: endAt } = row;
    if (typeof startAt !== 'string' || typeof endAt !== 'string') throw new Error('Synthetic appointment projection is missing.');
    expect(Number(row.end_ms) - Number(row.start_ms)).toBe(31 * 86_400_000 + 3_600_000);
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: undefined });
    Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value() { throw new Error('no current tzdb read'); } });
    expect(f.dates({ startDate: '2026-11-14', endDate: '2026-11-15' }).items.map(item => item.id)).toEqual(['fall-back']);
    expect(f.dates({ startDate: '2026-10-15', endDate: '2026-11-15' }).items[0]!.interval).toEqual(authored);
    expect(f.dates({ startDate: '2026-11-15', endDate: '2026-11-16' })).toEqual({ items: [], truncated: false });
    expect(f.detail('fall-back').interval).toEqual(authored);
    const utc = { actor: manager, resourceIds: ['resource'], startAt: '2026-11-14T00:00:00.000Z', endAt: '2026-11-15T00:00:00.000Z' };
    expect(f.read(context => queryCalendarAppointments(context, utc)).items[0]!.interval).toEqual(authored);
    const busy = f.read(context => queryCalendarBusy(context, utc));
    expect(busy.items).toEqual([{ resourceId: 'resource', startAt, endAt }]);
    expect(JSON.stringify(busy)).not.toMatch(/PRIVATE_|startDate|timeZone|all-day/);
  } finally {
    if (temporal) Object.defineProperty(globalThis, 'Temporal', temporal); else Reflect.deleteProperty(globalThis, 'Temporal');
    if (intl) Object.defineProperty(Intl, 'DateTimeFormat', intl); f.close();
  }
});

test('whole co-resource detail authorization is applied before LIMIT and truncation', () => {
  const f = fixture();
  try {
    f.resource('resource'); f.resource('hidden', null); f.grant('resource', ['details']);
    f.appointment('aaa-hidden', ['resource', 'hidden']);
    f.appointment('visible', ['resource'], interval('2026-04-02', '2026-04-03'));
    const request = { actor: viewer, startDate: '2026-04-01', endDate: '2026-04-04', limit: 1 };
    expect(f.dates(request)).toMatchObject({ items: [{ id: 'visible' }], truncated: false });
    expect(f.dates({ ...request, endDate: '2026-04-02' })).toEqual({ items: [], truncated: false });
    rejected(() => f.detail('aaa-hidden', viewer), 'CALENDAR_NOT_FOUND');
    f.appointment('visible-next', ['resource'], interval('2026-04-03', '2026-04-04'));
    expect(f.dates(request)).toMatchObject({ items: [{ id: 'visible' }], truncated: true });
    f.grant('hidden', ['details']); expect(f.dates(request)).toMatchObject({ items: [{ id: 'aaa-hidden' }], truncated: true });
    f.grant('resource', ['book', 'busy']); rejected(() => f.dates(request), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('current membership, not retained reservations, controls date selection and detail rights after a resource edit', () => {
  const f = fixture();
  try {
    f.resource('old', viewer.userId); f.resource('next', 'next-owner'); f.appointment('moved', ['old']);
    const current = f.db.list(CURRENT), history = f.db.list(HISTORY);
    f.command('appointment.update', { requestId: 'move', id: 'moved', expectedRevision: 1, resourceIds: ['next'] });
    expect(f.db.list(CURRENT)).toEqual(current); expect(f.db.list(HISTORY)).toEqual(history);
    expect(f.db.list('_calendar_reservations').map(row => ({ resource: row.resource_id, active: row.active })).sort((a, b) => String(a.resource).localeCompare(String(b.resource))))
      .toEqual([{ resource: 'next', active: 1 }, { resource: 'old', active: 0 }]);
    expect(f.dates({ actor: viewer, resourceIds: ['old'] })).toEqual({ items: [], truncated: false });
    rejected(() => f.detail('moved', viewer), 'CALENDAR_NOT_FOUND');
    const nextOwner = { ...viewer, userId: 'next-owner' };
    expect(f.dates({ actor: nextOwner, resourceIds: ['next'] }).items[0]).toMatchObject({ id: 'moved', resourceIds: ['next'], interval: interval() });
    expect(f.detail('moved', nextOwner).interval).toEqual(interval());
    f.command('appointment.cancel', { requestId: 'cancel', id: 'moved', expectedRevision: 2, confirmed: true });
    expect(f.dates({ actor: nextOwner, resourceIds: ['next'] })).toEqual({ items: [], truncated: false });
    expect(f.detail('moved', nextOwner)).toMatchObject({ status: 'cancelled', interval: interval() });
  } finally { f.close(); }
});

test('date selection follows the current kind and date generation while old all-day history remains retained', () => {
  const f = fixture();
  try {
    f.resource('resource'); f.appointment('converted', ['resource']);
    const first = f.db.list(HISTORY)[0]!;
    f.command('appointment.update', { requestId: 'to-timed', id: 'converted', expectedRevision: 1, interval: { kind: 'timed-v1', ...timed } });
    expect(f.db.list(HISTORY)).toHaveLength(2); expect(f.db.get(HISTORY, String(first.id))).toEqual(first);
    expect(f.dates()).toEqual({ items: [], truncated: false });
    expect(Object.hasOwn(f.detail('converted'), 'interval')).toBe(false);
    expect(f.db.list(CURRENT)[0]).toMatchObject({ kind: 'timed-v1', start_date: null, end_date: null });
    const next = interval('2026-04-03', '2026-04-04');
    f.command('appointment.update', { requestId: 'new-date', id: 'converted', expectedRevision: 2, interval: next });
    expect(f.db.list(HISTORY)).toHaveLength(3); expect(f.db.get(HISTORY, String(first.id))).toEqual(first);
    expect(f.dates()).toEqual({ items: [], truncated: false });
    expect(f.dates({ startDate: next.startDate, endDate: next.endDate }).items[0]).toMatchObject({ id: 'converted', interval: next });
  } finally { f.close(); }
});

test('date-query input admission is closed, bounded and owner-first, without timezone conversion', () => {
  const f = fixture();
  try {
    f.resource('resource');
    for (const patch of [{ startDate: '2026-02-30' }, { endDate: '2026-05-03' }, { startDate: '2026-04-02' }, { limit: 101 }, { limit: 0 },
      { resourceIds: ['resource', 'resource'] }, { resourceIds: Array.from({ length: 17 }, (_, index) => 'r' + index) }, { timeZone: 'UTC' }, { startAt: timed.startAt }]) {
      rejected(() => f.dates(patch), 'CALENDAR_INPUT_INVALID');
    }
    expect(f.dates({ resourceIds: [] })).toEqual({ items: [], truncated: false });
    rejected(() => f.dates({ actor: { ...manager, scopeId: 'tenant:another-owner' } }), 'CALENDAR_STATE_INVALID');
    let called = false;
    rejected(() => f.read(context => queryCalendarAppointmentDates(context, { actor: manager, resourceIds: ['resource'],
      get startDate() { called = true; return '2026-04-01'; }, endDate: '2026-04-02' })), 'CALENDAR_INPUT_INVALID');
    expect(called).toBe(false);
  } finally { f.close(); }
});

test('date selection uses the bounded current-date index and never streams retained history', () => {
  const f = fixture();
  try {
    f.resource('resource');
    for (let index = 0; index < 40; index++) {
      const from = new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), until = new Date(Date.UTC(2020, 0, index + 2)).toISOString().slice(0, 10);
      f.appointment('history-' + index, ['resource'], interval(from, until));
    }
    f.appointment('current', ['resource']);
    const observed: { sql: string; params: unknown[]; count: number }[] = [];
    const page = f.read(context => queryCalendarAppointmentDates({ database: new Proxy({ ...context.database }, {
      get(target, key) {
        if (key !== 'query') return Reflect.get(target, key);
        return (sql: string) => new Proxy({ ...target.query(sql) }, { get(statement, method) {
          const member = Reflect.get(statement, method);
          if (method !== 'all' && method !== 'get') return member;
          return (...params: never[]) => {
            const rows = member(...params);
            observed.push({ sql, params, count: Array.isArray(rows) ? rows.length : rows === null ? 0 : 1 });
            return rows;
          };
        } });
      },
    }) }, { actor: manager, resourceIds: ['resource'], startDate: '2026-04-01', endDate: '2026-04-02', limit: 1 }));
    expect(page.items.map(item => item.id)).toEqual(['current']);
    const selection = observed.find(entry => entry.sql.startsWith('SELECT a.* FROM ' + CURRENT))!;
    expect(selection.params.slice(0, 4)).toEqual([manager.scopeId, '2026-03-01', '2026-04-02', '2026-04-01']);
    expect(selection.params.at(-1)).toBe(2); expect(selection.count).toBe(1);
    const plan = f.raw.query('EXPLAIN QUERY PLAN ' + selection.sql).all(...selection.params as never[]) as { detail: string }[];
    const detail = plan.map(row => row.detail).join('\n');
    expect(detail).toContain('calendar_appointment_time_current_dates'); expect(detail).toMatch(/start_date>\? AND start_date<\?/);
    expect(detail).not.toMatch(/SCAN (?:t|a)\b/); expect(selection.sql).not.toContain(HISTORY);
    const historyReads = observed.filter(entry => entry.sql.includes('FROM ' + HISTORY));
    expect(historyReads).toHaveLength(2);
    for (const query of historyReads) { expect(query.count).toBe(1); expect(query.sql).toMatch(/WHERE (?:id=\?|scope_id=\?.*LIMIT 1)/s); }
  } finally { f.close(); }
});

for (const corruption of ['pointer', 'parent', 'history', 'state'] as const) test('all detail/range views fail closed on corrupt017 ' + corruption + ' metadata', () => {
  const f = fixture();
  try {
    f.resource('resource'); f.appointment('appointment', ['resource']);
    // Deliberate synthetic corruption only, bypassing native immutable seals to
    // prove read diagnosis rather than claiming production mutation authority.
    if (corruption === 'pointer') {
      f.raw.run(`DROP TRIGGER ${CURRENT}_parent_update`); f.raw.run(`DROP TRIGGER ${CURRENT}_forward`);
      f.raw.run(`UPDATE ${CURRENT} SET start_date='2026-03-31'`);
    } else if (corruption === 'parent') {
      f.raw.run('DROP TRIGGER calendar_appointment_revision'); f.raw.run('DROP TRIGGER calendar_appointment_time_parent_generation');
      f.raw.run("UPDATE calendar_appointments SET time_zone='Pacific/Honolulu'");
    } else if (corruption === 'history') {
      f.raw.run(`DROP TRIGGER ${HISTORY}_update`); f.raw.run(`PRAGMA ignore_check_constraints=ON`);
      f.raw.run(`UPDATE ${HISTORY} SET engine_json='{}'`);
    } else {
      f.raw.run('DROP TRIGGER _calendar_appointment_time_state_delete'); f.raw.run('DELETE FROM _calendar_appointment_time_state');
    }
    const before = f.raw.serialize();
    rejected(() => f.detail('appointment'), 'CALENDAR_STATE_INVALID');
    rejected(() => f.dates(), 'CALENDAR_STATE_INVALID');
    rejected(() => f.read(context => queryCalendarAppointments(context, { actor: manager, resourceIds: ['resource'],
      startAt: '2026-04-01T00:00:00.000Z', endAt: '2026-04-02T00:00:00.000Z' })), 'CALENDAR_STATE_INVALID');
    expect(f.raw.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('genuine pre017 timed views preserve their original JSON shape without creating metadata', () => {
  const f = fixture(false);
  try {
    f.resource('resource'); f.command('appointment.create', { requestId: 'legacy', id: 'legacy', title: 'PRIVATE_LEGACY', resourceIds: ['resource'], ...timed });
    const before = f.raw.serialize(), detail = f.detail('legacy');
    expect(detail).toMatchObject(timed); expect(Object.hasOwn(detail, 'interval')).toBe(false);
    const page = f.read(context => queryCalendarAppointments(context, { actor: manager, resourceIds: ['resource'], startAt: '2026-04-01T00:00:00.000Z', endAt: '2026-04-02T00:00:00.000Z' }));
    expect(page.items).toEqual([detail]); expect(f.raw.serialize()).toEqual(before);
    expect(f.raw.query("SELECT name FROM sqlite_schema WHERE name='_calendar_appointment_time_state'").get()).toBeNull();
    rejected(() => f.dates(), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});
