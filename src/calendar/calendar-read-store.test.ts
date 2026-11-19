/** Actual readonly MEMORY capabilities, not a writer-context cast. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { createDatabaseWriteCommandSession } from '../databases/database-write-command-capability';
import type { DatabaseFindInput } from '../databases/database-operations';
import { DATABASE_FIND_MAX_ROWS } from '../databases/database-operation-contracts';
import { DatabaseError } from '../databases/database-error';
import { createReactiveDB } from '../sync/reactive-db';
import { CALENDAR_TABLES } from './realm-schema';
import { createCalendarReadContext } from './calendar-read-store';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  let copy: Database | undefined;
  try {
    for (const [table, schema] of Object.entries(CALENDAR_TABLES)) db.defineTable(table, schema);
    for (const [id, count] of [['z', 2], ['b', 1], ['a', 1], ['c', 3]] as const) db.createStrict('_calendar_usage', { id, count });
    copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
    const session = createDatabaseReadQuerySession(copy), context = createCalendarReadContext(session.context);
    const writer = createDatabaseWriteCommandSession(db);
    return { db, copy, session, context, writer, close() { writer.close(); session.close(); copy!.close(); db.dispose(); } };
  } catch (error) { copy?.close(); db.dispose(); throw error; }
}
function rejects(run: () => unknown, code: DatabaseError['code']): void {
  try { run(); throw new Error('Expected rejection'); } catch (error) { expect(error).toBeInstanceOf(DatabaseError); expect((error as DatabaseError).code).toBe(code); }
}

test('Calendar read store exposes only frozen native reads and retains its query lifetime', () => {
  const f = fixture();
  try {
    const before = f.db.getRawDatabase().serialize(), seq = f.db.currentSeq;
    expect(Object.isFrozen(f.context)).toBe(true); expect(Object.isFrozen(f.context.db)).toBe(true);
    expect(Object.getPrototypeOf(f.context.db)).toBeNull();
    expect(Object.keys(f.context.db).sort()).toEqual(['find', 'get', 'hasTable']);
    expect(f.context.db.hasTable('_calendar_usage')).toBe(true);
    expect(f.context.db.hasTable('_calendar_appointment_time_state')).toBe(false);
    expect(f.context.db.get('_calendar_usage', 'a')).toEqual({ id: 'a', count: 1 });
    expect(f.context.db.get('_calendar_usage', 'missing')).toBeNull();
    expect(f.context.db.get('_calendar_usage', "a' OR 1=1 --")).toBeNull();
    expect(f.db.getRawDatabase().serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.session.close();
    rejects(() => f.context.db.get('_calendar_usage', 'a'), 'DATABASE_CLOSED');
  } finally { f.close(); }
});

test('Calendar structured reads share writer filter semantics and deterministic bounded ordering', () => {
  const f = fixture();
  try {
    const inputs: DatabaseFindInput[] = [
      { order: [{ field: 'count', direction: 'asc' }], limit: 3 },
      { select: ['id'], filters: [{ type: 'anyOf', filters: [
        { type: 'field', field: 'count', operator: 'eq', value: 1, match: 'exact' },
        { type: 'field', field: 'id', operator: 'in', value: ['z'] },
      ] }], order: [{ field: 'count', direction: 'desc' }], limit: 2, offset: 1 },
      { filters: [{ type: 'field', field: 'id', operator: 'contains', value: '%' }], limit: 1 },
    ];
    for (const input of inputs) expect(f.context.db.find('_calendar_usage', input)).toEqual(f.writer.context.db.find('_calendar_usage', input));
    expect(f.context.db.find('_calendar_usage', inputs[0]!).map(row => row.id)).toEqual(['a', 'b', 'z']);
  } finally { f.close(); }
});

test('Calendar read identifiers, columns, bounds and hostile find records fail before SQL', () => {
  const f = fixture();
  try {
    for (const table of ['sqlite_schema', '_zero_receipts', '__proto__', '_calendar_usage; DELETE FROM _calendar_usage']) {
      rejects(() => f.context.db.hasTable(table), 'DATABASE_OPERATION_UNSUPPORTED');
      rejects(() => f.context.db.get(table, 'a'), 'DATABASE_OPERATION_UNSUPPORTED');
      rejects(() => f.context.db.find(table, { limit: 1 }), 'DATABASE_OPERATION_UNSUPPORTED');
    }
    for (const input of [{ limit: 0 }, { limit: DATABASE_FIND_MAX_ROWS + 1 }, { limit: 1, select: ['unknown'] },
      { limit: 1, order: [{ field: 'count; DELETE FROM x', direction: 'asc' }] }, { limit: 1, consistency: 'current' },
      { limit: 1, filters: [{ type: 'field', field: 'unknown', operator: 'eq', value: 'x' }] }]) {
      expect(() => f.context.db.find('_calendar_usage', input as DatabaseFindInput)).toThrow(DatabaseError);
    }
    let touched = false;
    const accessor = Object.defineProperty({}, 'limit', { enumerable: true, get() { touched = true; return 1; } });
    expect(() => f.context.db.find('_calendar_usage', accessor as DatabaseFindInput)).toThrow(DatabaseError); expect(touched).toBe(false);
    expect(() => f.context.db.find('_calendar_usage', new Proxy({ limit: 1 }, { ownKeys() { touched = true; return ['limit']; } }))).toThrow(DatabaseError);
    expect(touched).toBe(false);
  } finally { f.close(); }
});

test('fixed native catalog excludes TableSchema identity annotations from SQL projection', () => {
  const raw = new Database(':memory:');
  let copy: Database | undefined;
  try {
    raw.run('CREATE TABLE _calendar_availability_policy_windows(id TEXT PRIMARY KEY,scope_id TEXT,resource_id TEXT,history_id TEXT,ordinal INTEGER,start_ms INTEGER,end_ms INTEGER)');
    raw.run("INSERT INTO _calendar_availability_policy_windows VALUES('w','s','r','h',0,1,2)");
    copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
    const session = createDatabaseReadQuerySession(copy);
    try { expect(createCalendarReadContext(session.context).db.find('_calendar_availability_policy_windows', { limit: 1 })).toEqual([
      { id: 'w', scope_id: 's', resource_id: 'r', history_id: 'h', ordinal: 0, start_ms: 1, end_ms: 2 },
    ]); } finally { session.close(); }
  } finally { copy?.close(); raw.close(); }
});

test('damaged noncanonical SQLite cells cannot escape as structured Calendar rows', () => {
  const raw = new Database(':memory:'); let copy: Database | undefined;
  try {
    raw.run('CREATE TABLE _calendar_usage(id TEXT PRIMARY KEY,count INTEGER)');
    raw.run("INSERT INTO _calendar_usage VALUES('corrupt',X'0102')");
    const before = raw.serialize(); copy = Database.deserialize(before, { readonly: true, strict: true });
    const session = createDatabaseReadQuerySession(copy);
    try {
      const read = createCalendarReadContext(session.context);
      expect(() => read.db.get('_calendar_usage', 'corrupt')).toThrow(DatabaseError);
      expect(() => read.db.find('_calendar_usage', { limit: 1 })).toThrow(DatabaseError);
      expect(raw.serialize()).toEqual(before);
    } finally { session.close(); }
  } finally { copy?.close(); raw.close(); }
});
