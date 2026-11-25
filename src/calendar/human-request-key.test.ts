/** Native MEMORY only. No paths, files, processes, application config or providers. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { CALENDAR_HUMAN_RECEIPT_FAMILIES, calendarHumanRequestId, readCalendarHumanKeyClaim } from './human-request-key';
import { calendarOperatorRequestId } from './integration-operator-request-model';
import { calendarHash } from './validation';

const scopeId = 'tenant:synthetic-calendar', principal = 'user:synthetic-user', requestId = 'synthetic-request';
const columns = { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL' };
function fixture(tables: readonly string[] = CALENDAR_HUMAN_RECEIPT_FAMILIES.map(row => row.table)) {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const name of tables) db.defineTable(name, columns);
  }
  catch (error) { db.dispose(); throw error; }
  return db;
}
function input(id = calendarHumanRequestId(scopeId, principal, requestId)) {
  return { id, scope_id: scopeId, principal, request_id: requestId, digest: 'synthetic-digest' };
}

for (const family of CALENDAR_HUMAN_RECEIPT_FAMILIES) test('human key finds only its canonical ' + family.family + ' family', () => {
  const db = fixture();
  try {
    const id = family.operator ? calendarOperatorRequestId(scopeId, principal, requestId) : calendarHumanRequestId(scopeId, principal, requestId);
    db.createStrict(family.table, input(id));
    const claim = readCalendarHumanKeyClaim(db, scopeId, principal, requestId);
    expect(claim?.family).toBe(family.family);
    expect(claim?.table).toBe(family.table);
    expect(claim?.row.id).toBe(id);
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim!.row)).toBe(true);
    expect(readCalendarHumanKeyClaim(db, 'tenant:other', principal, requestId)).toBeNull();
    expect(readCalendarHumanKeyClaim(db, scopeId, 'user:other', requestId)).toBeNull();
    expect(readCalendarHumanKeyClaim(db, scopeId, principal, 'other-request')).toBeNull();
  } finally { db.dispose(); }
});

test('old partial realms remain readable, missing families never create tables or changes', () => {
  const db = fixture(['_calendar_receipts']);
  try {
    const before = db.currentSeq;
    expect(readCalendarHumanKeyClaim(db, scopeId, principal, requestId)).toBeNull();
    expect(db.hasTable('_calendar_series_receipts')).toBe(false);
    expect(db.currentSeq).toBe(before);
    db.createStrict('_calendar_receipts', input());
    expect(readCalendarHumanKeyClaim(db, scopeId, principal, requestId)?.family).toBe('ordinary');
    expect(calendarHumanRequestId(scopeId, principal, requestId)).toBe(calendarHash([scopeId, principal, requestId]));
  } finally { db.dispose(); }
});

test('cross-family corrupt accepted keys fail closed; human/native namespaces stay separate', () => {
  const db = fixture([...CALENDAR_HUMAN_RECEIPT_FAMILIES.map(row => row.table), '_calendar_series_native_receipts']);
  try {
    const native = calendarHash(['calendar-series-native-v1', scopeId, 'owner', 'series', 1, 'prepare', requestId]);
    db.createStrict('_calendar_series_native_receipts', input(native));
    expect(readCalendarHumanKeyClaim(db, scopeId, principal, requestId)).toBeNull();
    db.createStrict('_calendar_series_receipts', input());
    db.createStrict('_calendar_integration_operator_requests', input(calendarOperatorRequestId(scopeId, principal, requestId)));
    expect(() => readCalendarHumanKeyClaim(db, scopeId, principal, requestId)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
  } finally { db.dispose(); }
});

test('a corrupt row under a canonical key never gets trusted by its primary key alone', () => {
  const db = fixture(['_calendar_series_receipts']);
  try {
    db.createStrict('_calendar_series_receipts', { ...input(), scope_id: 'tenant:other' });
    expect(() => readCalendarHumanKeyClaim(db, scopeId, principal, requestId)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
  } finally { db.dispose(); }
});

test('namespace resolution has eight fixed point probes and no retained-history query', () => {
  const db = fixture();
  try {
    const probes: string[] = [];
    const read = { hasTable: (table: string) => db.hasTable(table), get: (table: string, id: string) => { probes.push(table); return db.get(table, id); } };
    const before = db.currentSeq;
    expect(readCalendarHumanKeyClaim(read, scopeId, principal, requestId)).toBeNull();
    expect(probes).toEqual(CALENDAR_HUMAN_RECEIPT_FAMILIES.map(row => row.table));
    expect(db.currentSeq).toBe(before);
  } finally { db.dispose(); }
});
