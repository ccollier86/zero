/**
 * database-find-page.test.ts
 *
 * Qualifies structured exact-total reads at contract, executor and actor-result
 * boundaries. Fixtures are disposable; no application config or live data is used.
 */

import { describe, expect, test } from 'bun:test';
import type { DatabaseFindPage, DatabaseFindPageOperation as PublicFindPageOperation } from '@zero/framework/server';
import { createPlatformSQLiteService } from '../persistence';
import { createAsyncDatabaseClient } from './database-client';
import { DatabaseError } from './database-error';
import { validateDatabaseActorExecuteResult } from './database-actor-result-validation';
import {
  validateDatabaseOperation,
  type AsyncDatabaseOperationExecutor,
  type DatabaseFindPageOperation,
  type DatabaseOperationExecutionOptions,
  type DatabaseReadOperation,
} from './database-operations';
import { createDatabaseRealmOperationCatalog, defineDatabaseRealm } from './database-realm';
import { DatabaseRuntime } from './database-runtime';
import { DatabaseWriterOperationEngine } from './database-writer-engine';

const realm = defineDatabaseRealm({
  name: 'find-page-tests', version: '1',
  tables: {
    records: {
      record_id: 'text primary key',
      title: 'text not null collate nocase',
      status: 'text',
      groups: 'text',
    },
  },
});
const catalog = createDatabaseRealmOperationCatalog(realm);
const visible = [{ type: 'allOf', filters: [
  { type: 'field', field: 'groups', operator: 'arrayOverlaps', value: ['group_A'] },
  { type: 'anyOf', filters: [
    { type: 'field', field: 'status', operator: 'eq', value: 'open', match: 'exact' },
    { type: 'field', field: 'status', operator: 'eq', value: null },
  ] },
] }] as const;

function page(overrides: Partial<DatabaseFindPageOperation> = {}): PublicFindPageOperation {
  const operation = validateDatabaseOperation({
    type: 'find-page', table: 'records', limit: 2, filters: visible, ...overrides,
  }, catalog);
  if (operation.type !== 'find-page') throw new Error('Expected exact-total page');
  return operation;
}

function harness() {
  const runtime = DatabaseRuntime.open({
    id: 'find-page-tests', role: 'named',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }),
    ownsSQLite: true, tables: realm.tables,
  });
  const engine = new DatabaseWriterOperationEngine({ runtime, realm });
  const rows = [
    { record_id: 'a', title: 'Other group', status: 'open', groups: '["group_B"]' },
    { record_id: 'b', title: 'First', status: 'open', groups: '["group_A"]' },
    { record_id: 'c', title: 'Case excluded', status: 'OPEN', groups: '["group_A"]' },
    { record_id: 'd', title: 'Second', status: null, groups: '["group_A", "group_A"]' },
    { record_id: 'e', title: 'Malformed excluded', status: 'open', groups: '["group_A", 1]' },
    { record_id: 'f', title: 'Third', status: 'open', groups: '["group_A"]' },
  ];
  for (const row of rows) runtime.db.createStrict('records', row);
  return { runtime, engine, close() { engine.close(); runtime.close(); } };
}

describe('structured filtered pages with exact totals', () => {
  test('retains immutable bounded find admission without raw SQL or extra total fields', () => {
    const input = page({ select: ['record_id'], offset: 1 });
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.filters)).toBe(true);
    expect(input).toEqual({
      type: 'find-page', table: 'records', limit: 2, filters: visible,
      select: ['record_id'], offset: 1,
    });
    for (const patch of [
      { sql: 'SELECT * FROM records' }, { total: 100 }, { tenantId: 'other' },
      { limit: 0 }, { limit: 1002 }, { offset: -1 }, { offset: 1_000_001 },
      { select: ['unregistered'] }, { filters: [{ type: 'field', field: 'bad', operator: 'eq', value: 1 }] },
    ]) expect(() => page(patch as Partial<DatabaseFindPageOperation>)).toThrow(DatabaseError);
    let accessed = 0;
    expect(() => validateDatabaseOperation({
      type: 'find-page', table: 'records', limit: 1,
      get filters() { accessed++; return []; },
    }, catalog)).toThrow(DatabaseError);
    expect(accessed).toBe(0);
  });

  test('counts precisely the same nested predicates before projection and pagination', () => {
    const fixture = harness();
    try {
      const result = fixture.engine.execute(page({
        select: ['record_id', 'title'], order: [{ field: 'title', direction: 'desc' }],
        limit: 1, offset: 1, consistency: { mode: 'strong' },
      }));
      const expected: DatabaseFindPage = { rows: [{ record_id: 'd', title: 'Second' }], total: 3 };
      expect(result).toEqual({
        value: expected, sequence: { seq: 6 },
      });
      expect(fixture.engine.execute(page({ offset: 1_000_000 })).value)
        .toEqual({ rows: [], total: 3 });
      expect(fixture.engine.execute(page({
        filters: [{ type: 'field', field: 'title', operator: 'contains', value: "%_' OR 1=1 --" }],
      })).value).toEqual({ rows: [], total: 0 });
      // Existing find stays an array; callers do not pay for COUNT by default.
      expect(Array.isArray(fixture.engine.execute({
        ...page({ select: ['record_id'] }), type: 'find',
      }).value)).toBe(true);
    } finally { fixture.close(); }
  });

  test('returns current matching totals after insert, filter-changing update and deletion', () => {
    const fixture = harness();
    try {
      expect(fixture.engine.execute(page()).value).toMatchObject({ total: 3 });
      fixture.runtime.db.createStrict('records', {
        record_id: 'g', title: 'New', status: 'open', groups: '["group_A"]',
      });
      expect(fixture.engine.execute(page())).toMatchObject({
        value: { total: 4 }, sequence: { seq: 7 },
      });
      fixture.runtime.db.update('records', 'b', { status: 'closed' });
      expect(fixture.engine.execute(page())).toMatchObject({
        value: { total: 3 }, sequence: { seq: 8 },
      });
      fixture.runtime.db.delete('records', 'g');
      expect(fixture.engine.execute(page())).toMatchObject({
        value: { total: 2 }, sequence: { seq: 9 },
      });
    } finally { fixture.close(); }
  });

  test('rejects invalid actor totals, projection leaks and impossible page-count combinations', () => {
    const operation = page({ select: ['record_id'], offset: 1, limit: 2 });
    const valid = { value: { rows: [{ record_id: 'd' }, { record_id: 'f' }], total: 3 }, sequence: { seq: 6 } };
    expect(validateDatabaseActorExecuteResult(valid, operation, catalog)).toEqual(valid);
    expect(validateDatabaseActorExecuteResult({
      value: { rows: [], total: 3 }, sequence: { seq: 6 },
    }, page({ offset: 100, select: ['record_id'] }), catalog).value).toEqual({ rows: [], total: 3 });
    for (const total of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3', null]) {
      expect(() => validateDatabaseActorExecuteResult({
        ...valid, value: { ...valid.value, total },
      }, operation, catalog)).toThrow(DatabaseError);
    }
    for (const value of [
      { rows: valid.value.rows, total: 0 },
      { rows: [], total: 3 },
      { rows: valid.value.rows, total: 3, secret: 'not public' },
      { rows: [{ record_id: 'd', title: 'projection leak' }, { record_id: 'f' }], total: 3 },
      { rows: [{ record_id: 'd' }, { record_id: 'f' }, { record_id: 'g' }], total: 4 },
    ]) expect(() => validateDatabaseActorExecuteResult({ ...valid, value }, operation, catalog)).toThrow(DatabaseError);
  });

  test('findPage retains pre/post read-authority fences and forwards cancellation metadata', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    let admitted: DatabaseReadOperation | undefined;
    const client = createAsyncDatabaseClient({
      executor: { async execute(operation: DatabaseReadOperation, options?: DatabaseOperationExecutionOptions) {
        calls.push('dispatch'); admitted = operation;
        expect(options?.signal).toBe(controller.signal);
        return { value: { rows: [{ record_id: 'a' }], total: 1 }, sequence: { seq: 1 } };
      } } as unknown as AsyncDatabaseOperationExecutor,
      assertReadAuthority() { calls.push('authority'); return undefined; },
    });
    const result = await client.findPage('records', { limit: 2 }, { signal: controller.signal });
    expect(result.value.total).toBe(1);
    expect(admitted).toEqual({ type: 'find-page', table: 'records', limit: 2 });
    expect(calls).toEqual(['authority', 'dispatch', 'authority']);

    let checks = 0;
    const revoked = createAsyncDatabaseClient({
      executor: { async execute() {
        return { value: { rows: [], total: 123 }, sequence: { seq: 1 } };
      } } as unknown as AsyncDatabaseOperationExecutor,
      assertReadAuthority() { if (++checks === 2) throw new Error('revoked private scope'); return undefined; },
    });
    let failure: unknown;
    try { await revoked.findPage('records', { limit: 1 }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DatabaseError);
    expect((failure as DatabaseError).code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect((failure as DatabaseError).outcome).toBeNull();
    expect((failure as DatabaseError).cause).toBeUndefined();
  });
});
