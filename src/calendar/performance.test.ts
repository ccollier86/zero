/** Native in-memory SQL plans and bounded-history correctness, not a disk-mode latency benchmark. */
import { expect, test } from 'bun:test';
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { readCalendarRejection } from './error';
import { calendarRealm } from './realm';
import { queryCalendarBlocks } from './blocks';
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
    const insertBlock = raw.prepare(`INSERT INTO calendar_blocks
      (id,scope_id,title,start_at,end_at,start_ms,end_ms,time_zone,status,revision,created_by)
      VALUES(?,'application','Synthetic block',?,?,?,?,'UTC','active',1,'synthetic-owner')`);
    const insertBlockReservation = raw.prepare(`INSERT INTO _calendar_block_reservations
      (id,scope_id,block_id,resource_id,occupied_start_ms,occupied_end_ms,active) VALUES(?,'application',?,'person',?,?,1)`);
    // Old, valid, retained appointment/block rows are seeded directly as synthetic
    // setup. Production mutations still go through the canonical realm command.
    raw.transaction(() => {
      for (let i = 0; i < 2_000; i++) {
        const id = 'history-' + i, start = begin - (3_000 - i) * DAY, end = start + 3_600_000;
        insertAppointment.run(id, new Date(start).toISOString(), new Date(end).toISOString(), start, end, start, end);
        insertReservation.run('reservation-' + id, id, start, end);
        // Non-overlapping on the same resource, rather than impossible synthetic occupancy.
        const blockId = 'block-history-' + i, blockStart = start + 2 * 3_600_000, blockEnd = blockStart + 3_600_000;
        insertBlock.run(blockId, new Date(blockStart).toISOString(), new Date(blockEnd).toISOString(), blockStart, blockEnd);
        insertBlockReservation.run('reservation-' + blockId, blockId, blockStart, blockEnd);
      }
    })();
    const plans: { sql: string; params: unknown[]; detail: string; rowsReturned: number }[] = [];
    const context = { database: { query(sql: string) {
      const statement = raw.query(sql);
      return new Proxy(statement, { get(target, key) {
        const member = Reflect.get(target, key);
        if (key === 'all' || key === 'get') return (...params: never[]) => {
          const result = member.apply(target, params);
          if (sql.includes('occupied_start_ms') && /(?:SELECT a\.\*|SELECT resource_id,occupied_start_ms)/.test(sql)
            || sql.includes('SELECT b.*') && sql.includes('b.start_ms>=?')) {
            const plan = raw.query('EXPLAIN QUERY PLAN ' + sql).all(...params) as { detail: string }[];
            plans.push({ sql, params, detail: plan.map(row => row.detail).join('\n'), rowsReturned: Array.isArray(result) ? result.length : result == null ? 0 : 1 });
          }
          return result;
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
      expect(plan.detail).toMatch(/calendar_(?:appointment_range|(?:block_)?reservation_overlap)/);
      expect(plan.detail).toMatch(/occupied_start_ms>\? AND occupied_start_ms<\?/);
    }
    expect(f.plans).toHaveLength(6);
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

test('populated block range and mixed busy use bounded indexes on both stores without leaking retained history', () => {
  const f = fixture();
  try {
    const blockStart = begin - 31 * DAY + 1;
    f.command('block.create', { actor, requestId: 'long-block', id: 'long-block', resourceIds: ['person'], title: 'PRIVATE_BLOCK',
      startAt: new Date(blockStart).toISOString(), endAt: new Date(begin + 1).toISOString(), timeZone: 'UTC' });
    f.command('appointment.create', { actor, requestId: 'current-appointment', id: 'current-appointment', resourceIds: ['person'], title: 'PRIVATE_APPOINTMENT',
      startAt: new Date(begin + 1).toISOString(), endAt: new Date(begin + 3_600_001).toISOString(), timeZone: 'UTC' });
    const range = { actor, resourceIds: ['person'], startAt: new Date(begin).toISOString(), endAt: new Date(begin + DAY).toISOString() };
    expect(queryCalendarBlocks(f.context, range).items.map(item => item.id)).toEqual(['long-block']);
    expect(queryCalendarAppointments(f.context, range).items.map(item => item.id)).toEqual(['current-appointment']);
    const busy = queryCalendarBusy(f.context, range);
    expect(busy).toEqual({ items: [
      { resourceId: 'person', startAt: new Date(blockStart).toISOString(), endAt: new Date(begin + 1).toISOString() },
      { resourceId: 'person', startAt: new Date(begin + 1).toISOString(), endAt: new Date(begin + 3_600_001).toISOString() },
    ], truncated: false });
    expect(JSON.stringify(busy)).not.toMatch(/PRIVATE|history|long-block|current-appointment/);
    expect(queryCalendarBusy(f.context, { ...range, limit: 1 })).toEqual({ items: [busy.items[0]!], truncated: true });
    expect(queryCalendarBlocks(f.context, { ...range, startAt: new Date(begin + 1).toISOString() }).items).toEqual([]);
    const blockPlans = f.plans.filter(plan => plan.sql.includes('SELECT b.*'));
    expect(blockPlans).toHaveLength(2);
    for (const plan of blockPlans) {
      expect(plan.params[1]).toBe(calendarOverlapSearchStart(Number(plan.params[3])));
      expect(plan.detail).toMatch(/SEARCH b USING INDEX calendar_block_range \(scope_id=\? AND status=\? AND start_ms>\? AND start_ms<\?\)/);
      expect(plan.detail).not.toMatch(/\bSCAN b\b/);
    }
    const busyPlans = f.plans.filter(plan => plan.sql.startsWith('SELECT resource_id,occupied_start_ms,occupied_end_ms,id FROM'));
    expect(busyPlans).toHaveLength(4);
    for (const plan of busyPlans) {
      expect(plan.params).toContain(begin - MAX_OCCUPIED);
      const table = plan.sql.includes('FROM _calendar_block_reservations') ? '_calendar_block_reservations' : '_calendar_reservations';
      const index = table === '_calendar_reservations' ? 'calendar_reservation_overlap' : 'calendar_block_reservation_overlap';
      expect(plan.detail).toContain(`SEARCH ${table} USING INDEX ${index} (scope_id=? AND resource_id=? AND active=? AND occupied_start_ms>? AND occupied_start_ms<?)`);
      expect(plan.sql).toContain('ORDER BY occupied_start_ms,id LIMIT ?');
      expect(plan.rowsReturned).toBeLessThanOrEqual(Number(plan.params[5]));
      expect(plan.detail).not.toMatch(/\bSCAN _calendar_(?:block_)?reservations\b/);
      expect(plan.detail).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    }
  } finally { f.close(); }
});

test('dense current busy merges at most 32 bounded source pages with the exact prior global order and truncation', () => {
  const f = fixture();
  try {
    const resourceIds = ['person', ...Array.from({ length: 15 }, (_, index) => (index % 2 ? 'resource-' : 'Resource-') + String(index).padStart(2, '0'))];
    for (const id of resourceIds.slice(1)) f.command('resource.create', { actor, requestId: 'create-' + id, id, label: 'Synthetic', kind: 'room', ownerId: null, timeZone: 'UTC' });
    const raw = f.db.getRawDatabase();
    const insertAppointment = raw.prepare(`INSERT INTO calendar_appointments
      (id,scope_id,title,start_at,end_at,start_ms,end_ms,time_zone,buffer_before,buffer_after,occupied_start_ms,occupied_end_ms,status,revision,created_by)
      VALUES(?,'application','PRIVATE_DENSE_APPOINTMENT',?,?,?,?,'UTC',0,0,?,?,'confirmed',1,'synthetic-owner')`);
    const insertReservation = raw.prepare(`INSERT INTO _calendar_reservations
      (id,scope_id,appointment_id,resource_id,occupied_start_ms,occupied_end_ms,active) VALUES(?,'application',?,?,?,?,1)`);
    const insertBlock = raw.prepare(`INSERT INTO calendar_blocks
      (id,scope_id,title,start_at,end_at,start_ms,end_ms,time_zone,status,revision,created_by)
      VALUES(?,'application','PRIVATE_DENSE_BLOCK',?,?,?,?,'UTC','active',1,'synthetic-owner')`);
    const insertBlockReservation = raw.prepare(`INSERT INTO _calendar_block_reservations
      (id,scope_id,block_id,resource_id,occupied_start_ms,occupied_end_ms,active) VALUES(?,'application',?,?,?,?,1)`);
    // Each resource has 200 non-overlapping appointments interleaved with 200
    // non-overlapping blocks. Cross-resource ties exercise SQLite BINARY order.
    raw.transaction(() => {
      for (const [resourceIndex, resourceId] of resourceIds.entries()) for (let index = 0; index < 200; index++) {
        const id = `dense-appointment-${resourceId}-${index}`, start = begin + index * 1000, end = start + 50 + resourceIndex;
        insertAppointment.run(id, new Date(start).toISOString(), new Date(end).toISOString(), start, end, start, end);
        insertReservation.run('reservation-' + id, id, resourceId, start, end);
        const blockId = `dense-block-${resourceId}-${index}`, blockStart = start + 500, blockEnd = blockStart + 75 + resourceIndex;
        insertBlock.run(blockId, new Date(blockStart).toISOString(), new Date(blockEnd).toISOString(), blockStart, blockEnd);
        insertBlockReservation.run('reservation-' + blockId, blockId, resourceId, blockStart, blockEnd);
      }
    })();
    const placeholders = resourceIds.map(() => '?').join(',');
    // Reference only: the previous global SQL ordering is deliberately kept in
    // the synthetic test, never used by the production busy path.
    const reference = raw.query(`SELECT resource_id,occupied_start_ms,occupied_end_ms FROM (
      SELECT resource_id,occupied_start_ms,occupied_end_ms,id,0 AS kind FROM _calendar_reservations WHERE scope_id=? AND resource_id IN (${placeholders}) AND active=1 AND occupied_start_ms>=? AND occupied_start_ms<? AND occupied_end_ms>?
      UNION ALL
      SELECT resource_id,occupied_start_ms,occupied_end_ms,id,1 AS kind FROM _calendar_block_reservations WHERE scope_id=? AND resource_id IN (${placeholders}) AND active=1 AND occupied_start_ms>=? AND occupied_start_ms<? AND occupied_end_ms>?
    ) ORDER BY occupied_start_ms,resource_id,kind,id LIMIT ?`);
    for (const limit of [1, 7, 100]) {
      f.plans.length = 0;
      const page = queryCalendarBusy(f.context, { actor, resourceIds, startAt: new Date(begin).toISOString(), endAt: new Date(begin + DAY).toISOString(), limit });
      const expected = reference.all(actor.scopeId, ...resourceIds, begin - MAX_OCCUPIED, begin + DAY, begin,
        actor.scopeId, ...resourceIds, begin - MAX_OCCUPIED, begin + DAY, begin, limit + 1) as { resource_id: string; occupied_start_ms: number; occupied_end_ms: number }[];
      expect(page).toEqual({ items: expected.slice(0, limit).map(row => ({ resourceId: row.resource_id,
        startAt: new Date(row.occupied_start_ms).toISOString(), endAt: new Date(row.occupied_end_ms).toISOString() })), truncated: expected.length > limit });
      expect(JSON.stringify(page)).not.toMatch(/PRIVATE|dense-|reservation|kind|"id"/);
      expect(f.plans).toHaveLength(32);
      expect(f.plans.reduce((count, plan) => count + plan.rowsReturned, 0)).toBe(32 * (limit + 1));
      for (const plan of f.plans) {
        expect(plan.rowsReturned).toBe(limit + 1); expect(plan.params[5]).toBe(limit + 1);
        expect(plan.sql).toContain('resource_id=?'); expect(plan.sql).not.toMatch(/\bIN\s*\(|UNION/);
        expect(plan.sql).toContain('ORDER BY occupied_start_ms,id LIMIT ?');
        expect(plan.params[2]).toBe(begin - MAX_OCCUPIED);
        expect(plan.detail).toMatch(/SEARCH _calendar_(?:block_)?reservations USING INDEX calendar_(?:block_)?reservation_overlap \(scope_id=\? AND resource_id=\? AND active=\? AND occupied_start_ms>\? AND occupied_start_ms<\?\)/);
        expect(plan.detail).not.toMatch(/\bSCAN _calendar_(?:block_)?reservations\b/);
        expect(plan.detail).not.toContain('USE TEMP B-TREE FOR ORDER BY');
      }
    }
    f.plans.length = 0;
    const short = queryCalendarBusy(f.context, { actor, resourceIds, startAt: new Date(begin).toISOString(), endAt: new Date(begin + 1).toISOString(), limit: 100 });
    expect(short.items).toHaveLength(16); expect(short.truncated).toBe(false);
    expect(short.items.map(item => item.resourceId)).toEqual(resourceIds.slice().sort());
    expect(f.plans.reduce((count, plan) => count + plan.rowsReturned, 0)).toBe(16);
    f.plans.length = 0;
    expect(queryCalendarBusy(f.context, { actor, resourceIds: [], startAt: new Date(begin).toISOString(), endAt: new Date(begin + DAY).toISOString() }))
      .toEqual({ items: [], truncated: false });
    expect(f.plans).toHaveLength(0);
    expect(() => queryCalendarBusy(f.context, { actor: { ...actor, manageAll: false, createOwn: false, userId: 'unauthorized' }, resourceIds,
      startAt: new Date(begin).toISOString(), endAt: new Date(begin + DAY).toISOString() })).toThrow();
    expect(f.plans).toHaveLength(0); // all selected-resource authorization precedes any occupancy read
  } finally { f.close(); }
});

test('populated shared writer scans both bounded reservation indexes and admits only exact no-overlap boundaries', () => {
  const f = fixture(), prepare = f.db.prepare.bind(f.db);
  const seen: { sql: string; params: unknown[]; detail: string }[] = [];
  try {
    f.db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (!/FROM main\."_calendar_(?:block_)?reservations"/.test(sql) || !sql.includes('occupied_start_ms')) return statement;
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
    const block = (id: string, startMs: number, endMs: number) => f.command('block.create', { actor, requestId: id, id, resourceIds: ['person'], title: 'Synthetic',
      startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(), timeZone: 'UTC' });
    const appointment = (id: string, startMs: number, endMs: number) => f.command('appointment.create', { actor, requestId: id, id, resourceIds: ['person'], title: 'Synthetic',
      startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(), timeZone: 'UTC' });
    block('long-edge', begin - 31 * DAY + 1, begin + 1);
    expect(seen).toHaveLength(2); // no old history incorrectly rejects a current interval
    expect(() => appointment('one-ms-overlap', begin, begin + 3_600_000)).toThrow();
    expect(f.db.get('calendar_appointments', 'one-ms-overlap')).toBeNull();
    expect(() => appointment('adjacent-appointment', begin + 1, begin + 3_600_001)).not.toThrow();
    expect(() => block('adjacent-block', begin + 3_600_001, begin + 7_200_001)).not.toThrow();
    expect(() => block('competing-block', begin + 1_800_001, begin + 3_600_001)).toThrow();
    expect(() => appointment('competing-appointment', begin + 3_600_001, begin + 7_200_001)).toThrow();
    expect(() => appointment('clear-after-both', begin + 7_200_001, begin + 10_800_001)).not.toThrow();
    expect(f.db.get('calendar_blocks', 'competing-block')).toBeNull();
    expect(f.db.get('calendar_appointments', 'competing-appointment')).toBeNull();
    const appointmentPlans = seen.filter(plan => plan.sql.includes('FROM main."_calendar_reservations"'));
    const blockPlans = seen.filter(plan => plan.sql.includes('FROM main."_calendar_block_reservations"'));
    expect(appointmentPlans).toHaveLength(7); expect(blockPlans).toHaveLength(6);
    for (const [plans, index] of [[appointmentPlans, 'calendar_reservation_overlap'], [blockPlans, 'calendar_block_reservation_overlap']] as const) {
      for (const plan of plans) {
        expect(plan.sql).toContain('"occupied_start_ms" >= ?');
        expect(plan.sql).toContain('"occupied_start_ms" < ?');
        expect(plan.sql).toContain('"occupied_end_ms" > ?');
        expect(plan.params[3]).toBe(calendarOverlapSearchStart(Number(plan.params[5])));
        expect(plan.detail).toContain(index);
        expect(plan.detail).toMatch(/scope_id=\? AND resource_id=\? AND active=\? AND occupied_start_ms>\? AND occupied_start_ms<\?/);
        expect(plan.detail).not.toMatch(/\bSCAN main\._calendar_(?:block_)?reservations\b/);
      }
    }
    expect(f.db.prepare('SELECT count(*) AS count FROM calendar_appointments').get()).toEqual({ count: 2_002 });
    expect(f.db.prepare('SELECT count(*) AS count FROM calendar_blocks').get()).toEqual({ count: 2_002 });
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
