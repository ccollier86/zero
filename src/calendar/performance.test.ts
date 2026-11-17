/** Native in-memory SQL plans and bounded-history correctness, not a disk-mode latency benchmark. */
import { expect, test } from 'bun:test';
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { readCalendarRejection } from './error';
import { calendarRealm } from './realm';
import { queryCalendarAppointments, queryCalendarBusy } from './realm-queries';
import { calendarOverlapSearchStart, normalizeCalendarTimedInterval } from './time';

const DAY = 86_400_000, MAX_OCCUPIED = 33 * DAY;
const actor: CalendarActor = { scopeId: 'application', userId: 'synthetic-owner', principal: 'synthetic-owner', manageAll: true, createOwn: true };
const begin = Date.parse('2030-01-01T00:00:00.000Z');

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    const command = (name: string, value: unknown) => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, value as never);
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
    command('resource.create', { actor, requestId: 'resource', id: 'person', label: 'Synthetic', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const insertAppointment = raw.prepare(`INSERT INTO calendar_appointments
      (id,scope_id,title,start_at,end_at,start_ms,end_ms,time_zone,buffer_before,buffer_after,occupied_start_ms,occupied_end_ms,status,revision,created_by)
      VALUES(?,'application','Synthetic',?,?,?,?, 'UTC',0,0,?,?,'confirmed',1,'synthetic-owner')`);
    const insertReservation = raw.prepare(`INSERT INTO _calendar_reservations
      (id,scope_id,appointment_id,resource_id,occupied_start_ms,occupied_end_ms,active) VALUES(?,'application',?,'person',?,?,1)`);
    // Old, valid, retained appointment rows are seeded directly as synthetic
    // setup. Production mutations still go through the canonical realm command.
    raw.transaction(() => {
      for (let i = 0; i < 2_000; i++) {
        const id = 'history-' + i, start = begin - (3_000 - i) * DAY, end = start + 3_600_000;
        insertAppointment.run(id, new Date(start).toISOString(), new Date(end).toISOString(), start, end, start, end);
        insertReservation.run('reservation-' + id, id, start, end);
      }
    })();
    const plans: { sql: string; params: unknown[]; detail: string }[] = [];
    const context = { database: { query(sql: string) {
      const statement = raw.query(sql);
      return new Proxy(statement, { get(target, key) {
        const member = Reflect.get(target, key);
        if (key === 'all' || key === 'get') return (...params: never[]) => {
          if (sql.includes('occupied_start_ms') && /(?:SELECT a\.\*|SELECT resource_id,occupied_start_ms)/.test(sql)) {
            const plan = raw.query('EXPLAIN QUERY PLAN ' + sql).all(...params) as { detail: string }[];
            plans.push({ sql, params, detail: plan.map(row => row.detail).join('\n') });
          }
          return member.apply(target, params);
        };
        return typeof member === 'function' ? member.bind(target) : member;
      } });
    }, prepare(sql: string) { return raw.prepare(sql); } } } as unknown as DatabaseReadQueryContext;
    return { db, command, context, plans, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('bounded overlap lookup includes the longest admitted interval and preserves half-open adjacency', () => {
  const f = fixture();
  try {
    const occupiedStart = begin - MAX_OCCUPIED + 1;
    const input = { actor, requestId: 'longest', id: 'longest', resourceIds: ['person'], title: 'Synthetic maximum duration',
      startAt: new Date(occupiedStart + DAY).toISOString(), endAt: new Date(occupiedStart + 32 * DAY).toISOString(),
      timeZone: 'UTC', bufferBeforeMinutes: 1440, bufferAfterMinutes: 1440 };
    const interval = normalizeCalendarTimedInterval(inputWithoutActor(input));
    expect(interval.occupiedEndMs).toBe(begin + 1);
    expect(calendarOverlapSearchStart(begin)).toBe(begin - MAX_OCCUPIED);
    f.command('appointment.create', input);
    const range = { actor, resourceIds: ['person'], startAt: new Date(begin).toISOString(), endAt: new Date(begin + DAY).toISOString() };
    expect(queryCalendarAppointments(f.context, range).items.map(item => item.id)).toEqual(['longest']);
    expect(queryCalendarBusy(f.context, range).items).toHaveLength(1);
    const adjacent = { ...range, startAt: new Date(begin + 1).toISOString() };
    expect(queryCalendarAppointments(f.context, adjacent).items).toEqual([]);
    expect(queryCalendarBusy(f.context, adjacent).items).toEqual([]);
    for (const plan of f.plans) {
      expect(plan.sql).toContain('occupied_start_ms>=?');
      expect(plan.detail).toMatch(/calendar_(?:appointment_range|reservation_overlap)/);
      expect(plan.detail).toMatch(/occupied_start_ms>\? AND occupied_start_ms<\?/);
    }
    expect(f.plans).toHaveLength(4);
    // The new appointment's one-hour before-buffer makes its occupied start
    // begin exactly at queryStart. The longest old interval still overlaps it
    // by 1 ms and must be found by the canonical writer's bounded lookup.
    const buffered = { actor, requestId: 'buffered-edge', id: 'buffered-edge', resourceIds: ['person'], title: 'Synthetic buffered edge',
      startAt: new Date(begin + 3_600_000).toISOString(), endAt: new Date(begin + 7_200_000).toISOString(),
      timeZone: 'UTC', bufferBeforeMinutes: 60, bufferAfterMinutes: 0 };
    let failure: unknown;
    try { f.command('appointment.create', buffered); } catch (error) { failure = error; }
    expect(readCalendarRejection(failure)).toMatchObject({ code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' });
    expect(f.db.get('calendar_appointments', buffered.id)).toBeNull();
    expect(() => f.command('appointment.create', { ...buffered, requestId: 'buffered-adjacent', id: 'buffered-adjacent',
      startAt: new Date(begin + 3_600_001).toISOString(), endAt: new Date(begin + 7_200_001).toISOString() })).not.toThrow();
  } finally { f.close(); }
});

test('canonical write conflict lookup uses the same bounded interval index without losing conflicts', () => {
  const f = fixture();
  const prepare = f.db.prepare.bind(f.db);
  const seen: { sql: string; params: unknown[]; detail: string }[] = [];
  try {
    // Observe the actual native prepared SELECT without replacing the immutable
    // command context or its source-audit capability.
    f.db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (!sql.includes('FROM main."_calendar_reservations"') || !sql.includes('occupied_start_ms')) return statement;
      return new Proxy(statement, { get(target, key) {
        if (key === 'all') return (...params: never[]) => {
          const plan = f.db.getRawDatabase().query('EXPLAIN QUERY PLAN ' + sql).all(...params) as { detail: string }[];
          seen.push({ sql, params, detail: plan.map(row => row.detail).join('\n') });
          return target.all(...params);
        };
        const member = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } });
    }) as typeof f.db.prepare;
    const input = { actor, requestId: 'fresh', id: 'fresh', resourceIds: ['person'], title: 'Synthetic',
      startAt: new Date(begin).toISOString(), endAt: new Date(begin + 3_600_000).toISOString(), timeZone: 'UTC' };
    f.command('appointment.create', input);
    expect(seen[0]!.sql).toContain('"occupied_start_ms" >= ?');
    expect(seen[0]!.params).toContain(begin - MAX_OCCUPIED);
    expect(seen[0]!.detail).toContain('calendar_reservation_overlap');
    expect(seen[0]!.detail).toMatch(/occupied_start_ms>\? AND occupied_start_ms<\?/);
    expect(() => f.command('appointment.create', { ...input, id: 'competing', requestId: 'competing' })).toThrow();
    expect(f.db.prepare('SELECT count(*) AS count FROM calendar_appointments').get()).toEqual({ count: 2_001 });
  } finally { f.db.prepare = prepare; f.close(); }
});

test('overlap lower bound clamps safely at the canonical date limit', () => {
  expect(calendarOverlapSearchStart(-8_640_000_000_000_000)).toBe(-8_640_000_000_000_000);
  expect(calendarOverlapSearchStart(8_640_000_000_000_000)).toBe(8_640_000_000_000_000 - MAX_OCCUPIED);
  expect(() => calendarOverlapSearchStart(NaN)).toThrow();
});

function inputWithoutActor(input: Record<string, unknown>) {
  return { startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone,
    bufferBeforeMinutes: input.bufferBeforeMinutes, bufferAfterMinutes: input.bufferAfterMinutes };
}
