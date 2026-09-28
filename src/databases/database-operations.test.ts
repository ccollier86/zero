import { describe, expect, test } from 'bun:test';

import { DatabaseError, type DatabaseErrorCode } from './database-error';
import {
  DATABASE_OPERATION_MAX_DEPTH,
  DATABASE_OPERATION_MAX_STRING_BYTES,
  DATABASE_FIND_MAX_FILTER_DEPTH,
  DATABASE_FIND_MAX_OFFSET,
  DATABASE_FIND_MAX_PARAMETERS,
  DATABASE_FIND_MAX_ROWS,
  DATABASE_LIST_MAX_ROWS,
  cloneDatabaseSerializableValue,
  createDatabaseSequenceToken,
  isDatabaseIdempotencyKey,
  isDatabaseRegistryName,
  isDatabaseSerializableValue,
  isDatabaseTableName,
  validateDatabaseCommitResult,
  validateDatabaseOperation,
  validateDatabaseReadResult,
} from './database-operations';

function expectDatabaseCode(operation: () => unknown, code: DatabaseErrorCode): void {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
  }
}

describe('database operation contract', () => {
  const catalog = {
    tables: ['todos'],
    queries: ['todos.byOwner'],
    commands: ['todos.archive'],
    columns: { todos: ['id', 'title'] },
    primaryKeys: { todos: 'id' },
  };

  test('normalizes immutable built-in reads and explicit consistency', () => {
    const get = validateDatabaseOperation({
      type: 'get',
      table: 'todos',
      id: 'todo-1',
      consistency: {
        mode: 'read-your-writes',
        minSeq: { seq: 12 },
      },
    }, catalog);
    const list = validateDatabaseOperation({
      type: 'list',
      table: 'todos',
      limit: 50,
      after: 'todo-0',
      consistency: { mode: 'strong' },
    }, catalog);

    expect(get).toEqual({
      type: 'get',
      table: 'todos',
      id: 'todo-1',
      consistency: {
        mode: 'read-your-writes',
        minSeq: { seq: 12 },
      },
    });
    expect(list).toEqual({
      type: 'list',
      table: 'todos',
      limit: 50,
      after: 'todo-0',
      consistency: { mode: 'strong' },
    });
    expect(Object.isFrozen(get)).toBe(true);
    expect(get.type).toBe('get');
    if (get.type !== 'get') throw new Error('expected get operation');
    expect(Object.isFrozen(get.consistency)).toBe(true);
    expect(Object.isFrozen(get.consistency && 'minSeq' in get.consistency
      ? get.consistency.minSeq
      : null)).toBe(true);
    expect(structuredClone(get)).toEqual(get);
    expect(createDatabaseSequenceToken(0)).toEqual({ seq: 0 });
    expect(() => createDatabaseSequenceToken(-1)).toThrow();
  });

  test('validates named queries, writes, and atomic batch assertions', () => {
    const input = { owner: 'user-1', flags: ['open', { urgent: true }] };
    const query = validateDatabaseOperation({
      type: 'query',
      name: 'todos.byOwner',
      input,
    }, catalog);
    const command = validateDatabaseOperation({
      type: 'command',
      name: 'todos.archive',
      input: { before: 123 },
      idempotencyKey: 'req:command-1',
    }, catalog);
    const batch = validateDatabaseOperation({
      type: 'batch',
      idempotencyKey: 'req:batch-1',
      assertions: [
        { type: 'row-exists', table: 'todos', id: 'one' },
        { type: 'row-missing', table: 'todos', id: 'two' },
        {
          type: 'row-equals',
          table: 'todos',
          id: 'one',
          row: { id: 'one', title: 'Before' },
        },
        { type: 'sequence-equals', sequence: { seq: 4 } },
      ],
      mutations: [
        { type: 'create', table: 'todos', row: { id: 'two', title: 'New' } },
        { type: 'upsert', table: 'todos', row: { id: 'three', title: 'Third' } },
        { type: 'update', table: 'todos', id: 'one', patch: { title: 'After' } },
        { type: 'delete', table: 'todos', id: 'old' },
      ],
    }, catalog);

    input.flags[0] = 'changed';
    expect(query).toMatchObject({
      type: 'query',
      input: { owner: 'user-1', flags: ['open', { urgent: true }] },
    });
    expect(command).toMatchObject({
      type: 'command',
      idempotencyKey: 'req:command-1',
    });
    expect(batch).toMatchObject({
      type: 'batch',
      idempotencyKey: 'req:batch-1',
    });
    expect(batch.type === 'batch' && batch.mutations).toHaveLength(4);
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.type === 'batch' ? batch.mutations : null)).toBe(true);
    expect(Object.isFrozen(
      batch.type === 'batch' ? batch.mutations[0] : null,
    )).toBe(true);
    expect(structuredClone(batch)).toEqual(batch);
  });

  test('requires durable idempotency keys on every write operation', () => {
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'mutate',
      mutation: { type: 'delete', table: 'todos', id: 'one' },
    }, catalog), 'DATABASE_PAYLOAD_INVALID');

    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'command',
      name: 'todos.archive',
      input: null,
      idempotencyKey: ' spaces are unsafe ',
    }, catalog), 'DATABASE_PAYLOAD_INVALID');

    expect(isDatabaseIdempotencyKey('req:01J_TEST-1')).toBe(true);
    expect(isDatabaseIdempotencyKey('')).toBe(false);
  });

  test('requires bounded stable primary-key list pages', () => {
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'list',
      table: 'todos',
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'list',
      table: 'todos',
      limit: DATABASE_LIST_MAX_ROWS + 1,
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'list',
      table: 'todos',
      limit: 10,
      after: '',
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
  });

  test('normalizes a bounded immutable structured find contract', () => {
    const find = validateDatabaseOperation({
      type: 'find',
      table: 'todos',
      select: ['title', 'id'],
      filters: [
        { type: 'field', field: 'title', operator: 'contains', value: 'open' },
        {
          type: 'anyOf',
          filters: [
            {
              type: 'field', field: 'id', operator: 'eq', value: 'one',
              match: 'exact',
            },
            {
              type: 'allOf',
              filters: [
                { type: 'field', field: 'title', operator: 'like', value: 'Next%' },
                {
                  type: 'field', field: 'id', operator: 'in',
                  value: ['two', 'three', null],
                },
              ],
            },
          ],
        },
      ],
      order: [{ field: 'title', direction: 'desc' }],
      limit: DATABASE_FIND_MAX_ROWS,
      offset: DATABASE_FIND_MAX_OFFSET,
      consistency: { mode: 'snapshot' },
    }, catalog);

    expect(find).toMatchObject({
      type: 'find',
      table: 'todos',
      select: ['title', 'id'],
      limit: DATABASE_FIND_MAX_ROWS,
      offset: DATABASE_FIND_MAX_OFFSET,
    });
    expect(Object.isFrozen(find)).toBe(true);
    expect(find.type).toBe('find');
    if (find.type !== 'find') throw new Error('expected find operation');
    expect(Object.isFrozen(find.select)).toBe(true);
    expect(Object.isFrozen(find.filters)).toBe(true);
    expect(Object.isFrozen(find.filters?.[1])).toBe(true);
    expect(Object.isFrozen(find.order)).toBe(true);
    expect(structuredClone(find)).toEqual(find);
  });

  test('rejects unsafe, ambiguous, and unbounded structured finds', () => {
    const invalid: unknown[] = [
      { type: 'find', table: 'todos', limit: 0 },
      { type: 'find', table: 'todos', limit: DATABASE_FIND_MAX_ROWS + 1 },
      { type: 'find', table: 'todos', limit: 1, offset: DATABASE_FIND_MAX_OFFSET + 1 },
      { type: 'find', table: 'todos', limit: 1, select: [] },
      { type: 'find', table: 'todos', limit: 1, select: ['id', 'id'] },
      { type: 'find', table: 'todos', limit: 1, select: ['secret'] },
      { type: 'find', table: 'todos', limit: 1, filters: [] },
      {
        type: 'find', table: 'todos', limit: 1,
        filters: [{ type: 'anyOf', filters: [] }],
      },
      {
        type: 'find', table: 'todos', limit: 1,
        filters: [{ type: 'field', field: 'secret', operator: 'eq', value: 'x' }],
      },
      {
        type: 'find', table: 'todos', limit: 1,
        filters: [{
          type: 'field', field: 'title', operator: 'contains', value: 1,
        }],
      },
      {
        type: 'find', table: 'todos', limit: 1,
        filters: [{ type: 'field', field: 'title', operator: 'in', value: [] }],
      },
      {
        type: 'find', table: 'todos', limit: 1,
        filters: [{
          type: 'field', field: 'title', operator: 'like', value: '%',
          match: 'exact',
        }],
      },
      {
        type: 'find', table: 'todos', limit: 1,
        order: [{ field: 'id', direction: 'asc' }, { field: 'id', direction: 'desc' }],
      },
      {
        type: 'find', table: 'todos', limit: 1,
        order: [{ field: 'title', direction: 'sideways' }],
      },
      { type: 'find', table: 'todos', limit: 1, rawSql: 'SELECT * FROM secrets' },
    ];
    for (const value of invalid) {
      expectDatabaseCode(
        () => validateDatabaseOperation(value, catalog),
        'DATABASE_PAYLOAD_INVALID',
      );
    }

    let nested: unknown = {
      type: 'field', field: 'id', operator: 'eq', value: 'one',
    };
    for (let index = 0; index <= DATABASE_FIND_MAX_FILTER_DEPTH; index += 1) {
      nested = { type: 'allOf', filters: [nested] };
    }
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'find', table: 'todos', limit: 1, filters: [nested],
    }, catalog), 'DATABASE_PAYLOAD_LIMIT');

    const exactBooleans = Array.from(
      { length: Math.floor((DATABASE_FIND_MAX_PARAMETERS - 2) / 6) + 1 },
      () => ({
        type: 'field', field: 'id', operator: 'eq', value: true, match: 'exact',
      }),
    );
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'find', table: 'todos', limit: 1, filters: exactBooleans,
    }, catalog), 'DATABASE_PAYLOAD_LIMIT');
  });

  test('requires immutable realm columns and a primary key for find', () => {
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'find', table: 'todos', limit: 1,
    }, { tables: ['todos'] }), 'DATABASE_SCHEMA_MISMATCH');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'find', table: 'todos', limit: 1,
    }, { tables: ['todos'], columns: { todos: ['id', 'title'] } }),
    'DATABASE_SCHEMA_MISMATCH');

    const wideColumns = [
      'id',
      ...Array.from(
        { length: 128 },
        (_, index) => `field_${index}`,
      ),
    ];
    const wideCatalog = {
      tables: ['wide'],
      columns: { wide: wideColumns },
      primaryKeys: { wide: 'id' },
    };
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'find', table: 'wide', limit: 1,
    }, wideCatalog), 'DATABASE_PAYLOAD_LIMIT');
    expect(validateDatabaseOperation({
      type: 'find', table: 'wide', select: ['id'], limit: 1,
    }, wideCatalog)).toMatchObject({ select: ['id'] });
  });

  test('validates exact immutable read and commit result envelopes', () => {
    const read = validateDatabaseReadResult({
      value: [{ id: 'one', title: 'Read' }],
      sequence: { seq: 8 },
    });
    const commit = validateDatabaseCommitResult({
      value: { changed: true },
      sequence: { seq: 9 },
      idempotencyKey: 'req:commit-9',
      replayed: false,
    });

    expect(read).toEqual({
      value: [{ id: 'one', title: 'Read' }],
      sequence: { seq: 8 },
    });
    expect(commit).toEqual({
      value: { changed: true },
      sequence: { seq: 9 },
      idempotencyKey: 'req:commit-9',
      replayed: false,
    });
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.value)).toBe(true);
    expect(Object.isFrozen(commit.sequence)).toBe(true);
    expectDatabaseCode(() => validateDatabaseReadResult({
      value: null,
      sequence: { seq: 1 },
      path: '/private/database.sqlite',
    }), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseCommitResult({
      value: null,
      sequence: { seq: 1 },
      idempotencyKey: 'req:bad-result',
      replayed: 'false',
    }), 'DATABASE_PAYLOAD_INVALID');
  });

  test('rejects unknown fields and unknown catalog entries', () => {
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'get', table: 'todos', id: 'one', tenantId: 'must-not-cross',
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'get', table: 'unknown', id: 'one',
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'query', name: 'todos.missing', input: null,
    }, catalog), 'DATABASE_OPERATION_UNSUPPORTED');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'command',
      name: 'todos.missing',
      input: null,
      idempotencyKey: 'req:missing',
    }, catalog), 'DATABASE_OPERATION_UNSUPPORTED');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'mutate',
      idempotencyKey: 'req:unknown-column',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'one', not_a_column: true },
      },
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'mutate',
      idempotencyKey: 'req:primary-key-patch',
      mutation: {
        type: 'update',
        table: 'todos',
        id: 'one',
        patch: { id: 'two' },
      },
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'raw-sql', sql: 'select 1',
    }), 'DATABASE_OPERATION_UNSUPPORTED');
  });

  test('rejects accessors and proxies without invoking hostile getters', () => {
    let topGetterCalls = 0;
    const operation = { table: 'todos', id: 'one' } as Record<string, unknown>;
    Object.defineProperty(operation, 'type', {
      enumerable: true,
      get() {
        topGetterCalls += 1;
        return 'get';
      },
    });
    expectDatabaseCode(
      () => validateDatabaseOperation(operation, catalog),
      'DATABASE_PAYLOAD_INVALID',
    );
    expect(topGetterCalls).toBe(0);

    let nestedGetterCalls = 0;
    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, 'secret', {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return 'no';
      },
    });
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'query', name: 'todos.byOwner', input: nested,
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
    expect(nestedGetterCalls).toBe(0);

    expectDatabaseCode(() => validateDatabaseOperation(new Proxy({
      type: 'get', table: 'todos', id: 'one',
    }, {}), catalog), 'DATABASE_PAYLOAD_INVALID');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'query',
      name: 'todos.byOwner',
      input: new Proxy({ owner: 'one' }, {}),
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
  });

  test('rejects cyclic, malformed, lossy, non-cloneable, and exotic values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = new Array(2);
    sparse[1] = 'present';
    const malformed = '\ud800';

    for (const input of [
      cyclic,
      sparse,
      malformed,
      undefined,
      1n,
      Symbol('no'),
      () => 'no',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      new Date(),
      new Map(),
      new Uint8Array([1]),
      Object.create({ inherited: true }),
    ]) {
      expectDatabaseCode(() => validateDatabaseOperation({
        type: 'query', name: 'todos.byOwner', input,
      }, catalog), 'DATABASE_PAYLOAD_INVALID');
      expect(isDatabaseSerializableValue(input)).toBe(false);
    }
  });

  test('enforces depth, string-size, and dense-batch bounds', () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index <= DATABASE_OPERATION_MAX_DEPTH; index += 1) {
      nested = { nested };
    }
    expectDatabaseCode(
      () => cloneDatabaseSerializableValue(nested),
      'DATABASE_PAYLOAD_LIMIT',
    );
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'query',
      name: 'todos.byOwner',
      input: 'x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES + 1),
    }, catalog), 'DATABASE_PAYLOAD_LIMIT');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'batch',
      idempotencyKey: 'req:aggregate-limit',
      mutations: Array.from({ length: 5 }, (_, index) => ({
        type: 'upsert',
        table: 'todos',
        row: {
          id: `large-${index}`,
          title: 'x'.repeat(220_000),
        },
      })),
    }, catalog), 'DATABASE_PAYLOAD_LIMIT');
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'batch',
      idempotencyKey: 'req:empty',
      mutations: [],
    }, catalog), 'DATABASE_PAYLOAD_INVALID');

    const mutations = new Array(2);
    mutations[1] = { type: 'delete', table: 'todos', id: 'one' };
    expectDatabaseCode(() => validateDatabaseOperation({
      type: 'batch',
      idempotencyKey: 'req:sparse',
      mutations,
    }, catalog), 'DATABASE_PAYLOAD_INVALID');
  });

  test('uses strict portable names and excludes prototype-pollution keys', () => {
    expect(isDatabaseRegistryName('projects.byOwner-v2')).toBe(true);
    expect(isDatabaseRegistryName('2startsWrong')).toBe(false);
    expect(isDatabaseRegistryName('constructor')).toBe(false);
    expect(isDatabaseTableName('_zero_events')).toBe(true);
    expect(isDatabaseTableName('not-safe.table')).toBe(false);
    expect(isDatabaseTableName('__proto__')).toBe(false);

    const poisoned = JSON.parse('{"__proto__":{"polluted":true}}');
    expectDatabaseCode(
      () => cloneDatabaseSerializableValue(poisoned),
      'DATABASE_PAYLOAD_INVALID',
    );
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
