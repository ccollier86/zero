import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { validateDatabaseActorExecutePayload } from './database-actor-protocol';
import { createDatabaseRef } from './database-file';
import { runDatabaseFind } from './database-find';
import { createDatabaseListQueryPlan } from './database-list-query';
import {
  validateDatabaseOperation,
  type DatabaseFindArrayOverlapFilter,
  type DatabaseFindFieldFilter,
  type DatabaseFindFilter,
} from './database-operations';

const catalog = {
  tables: ['records'],
  columns: { records: ['id', 'value', 'title'] },
  primaryKeys: { records: 'id' },
};
const overlap: DatabaseFindArrayOverlapFilter = {
  type: 'field', field: 'value', operator: 'arrayOverlaps', value: ['group_A'],
};

// Keep the original exported interface extensible by consuming applications.
interface AppFilter extends DatabaseFindFieldFilter { readonly label: string }
const existingScalar: AppFilter = {
  type: 'field', field: 'title', operator: 'eq', value: 'one', label: 'Existing',
};

// The new predicate is deliberately not widened to scalar or mixed operands.
const invalidOverlap: DatabaseFindArrayOverlapFilter = {
  type: 'field', field: 'value', operator: 'arrayOverlaps',
  // @ts-expect-error arrayOverlaps admits string arrays only.
  value: [1],
};

describe('database arrayOverlaps contract', () => {
  test('preserves existing extensible scalar interface and string-only overlap types', () => {
    expect(existingScalar.label).toBe('Existing');
    expect(() => validateDatabaseOperation({
      type: 'find', table: 'records', limit: 1, filters: [invalidOverlap],
    }, catalog)).toThrow('String-array overlap elements must be well-formed strings.');
  });
  test('freezes and round-trips string-array filters through find/list actor IPC admission', () => {
    for (const type of ['find', 'list'] as const) {
      const input = {
        type, table: 'records', limit: 2,
        filters: [{ type: 'allOf', filters: [overlap, {
          type: 'anyOf', filters: [
            { type: 'field', field: 'title', operator: 'eq', value: 'one' },
            { type: 'field', field: 'value', operator: 'arrayOverlaps', value: [] },
          ],
        }] }],
      } as const;
      const operation = validateDatabaseOperation(input, catalog);
      expect(operation).toEqual(input);
      expect(Object.isFrozen(operation)).toBe(true);
      const payload = validateDatabaseActorExecutePayload(structuredClone({
        databaseRef: createDatabaseRef('array-policy'), operation,
      }), catalog);
      expect(payload.operation).toEqual(input);
      expect(Object.isFrozen(payload.operation)).toBe(true);
      const filters = 'filters' in payload.operation ? payload.operation.filters : undefined;
      expect(Object.isFrozen(filters)).toBe(true);
      const root = filters?.[0];
      expect(root?.type).toBe('allOf');
      if (root?.type !== 'allOf') throw new Error('Expected allOf');
      const field = root.filters[0];
      expect(field?.type).toBe('field');
      if (field?.type !== 'field') throw new Error('Expected field');
      expect(Object.isFrozen(field.value)).toBe(true);
    }
  });

  test('rejects invalid overlap operands, modifiers, fields and getters before dispatch', () => {
    let calls = 0;
    const getter = ['group_A'];
    Object.defineProperty(getter, '0', {
      enumerable: true, get() { calls += 1; return 'group_A'; },
    });
    const operands: unknown[] = [
      undefined, null, {}, 'group_A', [1], [true], [null], [['group_A']],
      ['group_A', 1], new Array(1), getter,
      new Proxy(['group_A'], { get() { calls += 1; return 'group_A'; } }),
      ['\ud800'], ['\udc00'],
    ];
    for (const type of ['find', 'list'] as const) {
      for (const value of operands) {
        expect(() => validateDatabaseOperation({
          type, table: 'records', limit: 1,
          filters: [{ ...overlap, value }],
        }, catalog)).toThrow();
      }
      for (const patch of [
        { match: 'exact' }, { field: 'unregistered' }, { rawSql: '1=1' },
      ]) {
        expect(() => validateDatabaseOperation({
          type, table: 'records', limit: 1, filters: [{ ...overlap, ...patch }],
        }, catalog)).toThrow();
      }
    }
    expect(calls).toBe(0);
  });

  test('accounts for overlap binds in existing per-operation parameter budgets', () => {
    const fifty = { ...overlap, value: Array(50).fill('group_A') };
    const accepted: DatabaseFindFilter[] = [
      fifty, fifty, fifty, fifty, fifty,
      { type: 'field', field: 'id', operator: 'in', value: ['a', 'b', 'c', 'd'] },
    ];
    for (const type of ['find', 'list'] as const) {
      expect(validateDatabaseOperation({
        type, table: 'records', limit: 1, filters: accepted,
      }, catalog).type).toBe(type);
      expect(() => validateDatabaseOperation({
        type, table: 'records', limit: 1,
        filters: [...accepted, { type: 'field', field: 'title', operator: 'eq', value: 'extra' }],
      }, catalog)).toThrow('Database find parameter limit exceeded.');
      expect(() => validateDatabaseOperation({
        type, table: 'records', limit: 1,
        filters: [{ ...overlap, value: Array(51).fill('group_A') }],
      }, catalog)).toThrow('String-array overlap item limit exceeded.');
    }
  });

  test('filters before projection, offset, limit and BINARY keyset cursor with nested operators', () => {
    const db = new Database(':memory:');
    try {
      db.run('CREATE TABLE records (id TEXT PRIMARY KEY COLLATE NOCASE, value TEXT COLLATE NOCASE, title TEXT)');
      for (const [id, value, title] of [
        ['a', '["group_B"]', 'hidden'],
        ['b', '["group_A"]', 'one'],
        ['c', '["GROUP_A"]', 'hidden'],
        ['d', '["group_A", "group_A"]', 'two'],
        ['e', '["group_A", 1]', 'hidden'],
        ['f', 'malformed', 'hidden'],
        ['g', '["group_A", "Nڀ"]', 'three'],
      ]) db.query('INSERT INTO records VALUES (?, ?, ?)').run(id!, value!, title!);
      const find = validateDatabaseOperation({
        type: 'find', table: 'records', select: ['id'], limit: 1, offset: 1,
        filters: [{ type: 'allOf', filters: [overlap, {
          type: 'anyOf', filters: [
            { type: 'field', field: 'title', operator: 'eq', value: 'two' },
            { type: 'field', field: 'title', operator: 'eq', value: 'three' },
          ],
        }] }],
      }, catalog);
      if (find.type !== 'find') throw new Error('Expected find');
      expect(runDatabaseFind(db, find, catalog)).toEqual([{ id: 'g' }]);
      const list = validateDatabaseOperation({
        type: 'list', table: 'records', limit: 1, after: 'b', filters: [overlap],
      }, catalog);
      if (list.type !== 'list') throw new Error('Expected list');
      const plan = createDatabaseListQueryPlan(list, 'id');
      const rows = db.query(plan.sql).all(...plan.params) as Array<{ id: string }>;
      expect(rows.map((row) => row.id)).toEqual(['d', 'g']);
      expect(plan.params).toEqual(['group_A', 'b', 2]);
      const empty = validateDatabaseOperation({
        type: 'find', table: 'records', limit: 10,
        filters: [{ ...overlap, value: [] }],
      }, catalog);
      if (empty.type !== 'find') throw new Error('Expected find');
      expect(runDatabaseFind(db, empty, catalog)).toEqual([]);
    } finally { db.close(); }
  });
});
