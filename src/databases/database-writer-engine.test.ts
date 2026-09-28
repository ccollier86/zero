import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPlatformSQLiteService } from '../persistence';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type TableSchema,
} from '../sync/types';
import { DatabaseError, type DatabaseErrorCode } from './database-error';
import type {
  DatabaseCommitResult,
  DatabaseReadResult,
} from './database-operations';
import {
  defineDatabaseRealm,
  type DatabaseWriteCommandContext,
  type DatabaseWriteCommandHandler,
} from './database-realm';
import { DatabaseRuntime } from './database-runtime';
import {
  DATABASE_WRITER_MAX_REPLAY_CHANGES,
  DatabaseWriterOperationEngine,
  type DatabaseWriterCommitValue,
} from './database-writer-engine';

const todoTables = {
  todos: {
    id: 'text primary key',
    title: 'text not null collate nocase',
  },
} satisfies Record<string, TableSchema>;

function expectDatabaseCode(operation: () => unknown, code: DatabaseErrorCode): void {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
  }
}

function asCommit(
  value: ReturnType<DatabaseWriterOperationEngine['execute']>,
): DatabaseCommitResult<DatabaseWriterCommitValue> {
  if (!('idempotencyKey' in value)) throw new Error('expected commit result');
  return value;
}

function asRead(
  value: ReturnType<DatabaseWriterOperationEngine['execute']>,
): DatabaseReadResult {
  if ('idempotencyKey' in value) throw new Error('expected read result');
  return value;
}

function createHarness(options: {
  path?: string;
  ringBufferDepth?: number;
  realm?: ReturnType<typeof defineDatabaseRealm>;
} = {}) {
  const realm = options.realm ?? defineDatabaseRealm({
    name: 'writer-tests',
    version: '1',
    tables: todoTables,
  });
  const sqlite = options.path
    ? createPlatformSQLiteService({ mode: 'file', path: options.path })
    : createPlatformSQLiteService({ mode: 'ephemeral' });
  const runtime = DatabaseRuntime.open({
    id: 'writer-tests',
    role: 'named',
    sqlite,
    ownsSQLite: true,
    reactive: options.ringBufferDepth === undefined
      ? undefined
      : { ringBufferDepth: options.ringBufferDepth },
    tables: realm.tables,
  });
  const engine = new DatabaseWriterOperationEngine({ runtime, realm });
  return {
    realm,
    runtime,
    engine,
    close() {
      engine.close();
      runtime.close();
    },
  };
}

describe('DatabaseWriterOperationEngine writes', () => {
  test('fails closed when the durable receipt schema is incompatible', () => {
    const realm = defineDatabaseRealm({
      name: 'writer-receipt-schema',
      version: '1',
      tables: todoTables,
    });
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const runtime = DatabaseRuntime.open({
      id: 'writer-receipt-schema',
      role: 'named',
      sqlite,
      ownsSQLite: true,
      tables: realm.tables,
    });
    runtime.db.exec(`
      CREATE TABLE _zero_database_operation_receipts (
        receipt_key TEXT PRIMARY KEY,
        unsafe_extra TEXT
      )
    `);
    try {
      expectDatabaseCode(() => new DatabaseWriterOperationEngine({
        runtime,
        realm,
      }), 'DATABASE_SCHEMA_MISMATCH');
      expect(runtime.db.currentSeq).toBe(0);
    } finally {
      runtime.close();
    }
  });

  test('executes assertions and mutations atomically with ordered sequences', () => {
    const harness = createHarness();
    try {
      const ranges: Array<{ afterSeq: number; throughSeq: number }> = [];
      harness.engine.onChangesAvailable((range) => ranges.push({ ...range }));
      const committed = asCommit(harness.engine.execute({
        type: 'batch',
        idempotencyKey: 'batch:ordered-1',
        assertions: [
          { type: 'sequence-equals', sequence: { seq: 0 } },
          { type: 'row-missing', table: 'todos', id: 'b' },
        ],
        mutations: [
          { type: 'create', table: 'todos', row: { id: 'b', title: 'B1' } },
          { type: 'create', table: 'todos', row: { id: 'a', title: 'A1' } },
          { type: 'update', table: 'todos', id: 'b', patch: { title: 'B2' } },
        ],
      }));

      expect(committed).toMatchObject({
        idempotencyKey: 'batch:ordered-1',
        replayed: false,
        sequence: { seq: 3 },
        value: {
          kind: 'batch',
          mutations: [
            { type: 'create', rowId: 'b', changed: true, op: 'INSERT', sequence: { seq: 1 } },
            { type: 'create', rowId: 'a', changed: true, op: 'INSERT', sequence: { seq: 2 } },
            { type: 'update', rowId: 'b', changed: true, op: 'UPDATE', sequence: { seq: 3 } },
          ],
        },
      });
      expect(harness.runtime.db.get('todos', 'b')).toEqual({ id: 'b', title: 'B2' });
      expect(ranges).toEqual([{ afterSeq: 0, throughSeq: 3 }]);

      expectDatabaseCode(() => harness.engine.execute({
        type: 'batch',
        idempotencyKey: 'batch:assertion-fails',
        assertions: [{ type: 'row-missing', table: 'todos', id: 'b' }],
        mutations: [{ type: 'delete', table: 'todos', id: 'b' }],
      }), 'DATABASE_CONFLICT');
      expect(harness.runtime.db.get('todos', 'b')).toEqual({ id: 'b', title: 'B2' });
      expect(harness.runtime.db.currentSeq).toBe(3);

      expectDatabaseCode(() => harness.engine.execute({
        type: 'batch',
        idempotencyKey: 'batch:later-conflict',
        mutations: [
          { type: 'update', table: 'todos', id: 'b', patch: { title: 'rolled back' } },
          { type: 'create', table: 'todos', row: { id: 'a', title: 'duplicate' } },
        ],
      }), 'DATABASE_CONFLICT');
      expect(harness.runtime.db.get('todos', 'b')).toEqual({ id: 'b', title: 'B2' });
      expect(harness.runtime.db.currentSeq).toBe(3);
      expect(ranges).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  test('durably replays the same write across runtime reopen and rejects key reuse', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-writer-receipts-'));
    const path = join(root, 'writer.sqlite');
    const operation = {
      type: 'mutate',
      idempotencyKey: 'request:durable-1',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'one', title: 'Once' },
      },
    } as const;

    try {
      const firstHarness = createHarness({ path });
      const first = asCommit(firstHarness.engine.execute(operation));
      expect(first.replayed).toBe(false);
      expect(first.sequence.seq).toBe(1);
      firstHarness.close();

      const secondHarness = createHarness({ path });
      try {
        const replay = asCommit(secondHarness.engine.execute(operation));
        expect(replay.replayed).toBe(true);
        expect(replay.sequence).toEqual(first.sequence);
        expect(replay.value).toEqual(first.value);
        expect(secondHarness.runtime.db.list('todos')).toEqual([
          { id: 'one', title: 'Once' },
        ]);
        expect(secondHarness.runtime.db.currentSeq).toBe(1);

        expectDatabaseCode(() => secondHarness.engine.execute({
          type: 'mutate',
          idempotencyKey: 'request:durable-1',
          mutation: {
            type: 'update',
            table: 'todos',
            id: 'one',
            patch: { title: 'Different operation' },
          },
        }), 'DATABASE_CONFLICT');
        expect(secondHarness.runtime.db.get('todos', 'one')).toEqual({
          id: 'one', title: 'Once',
        });
      } finally {
        secondHarness.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rolls back commands with asynchronous or invalid results and saves no receipt', () => {
    const asyncResult = (({ db }: DatabaseWriteCommandContext) => {
      db.createStrict('todos', { id: 'async', title: 'rollback' });
      return Promise.resolve(null);
    }) as unknown as DatabaseWriteCommandHandler;
    const invalidResult = (({ db }: DatabaseWriteCommandContext) => {
      db.createStrict('todos', { id: 'invalid', title: 'rollback' });
      return new Date();
    }) as unknown as DatabaseWriteCommandHandler;
    const realm = defineDatabaseRealm({
      name: 'writer-commands',
      version: '1',
      tables: todoTables,
      commands: { asyncResult, invalidResult },
    });
    const harness = createHarness({ realm });
    try {
      expectDatabaseCode(() => harness.engine.execute({
        type: 'command',
        name: 'asyncResult',
        input: null,
        idempotencyKey: 'command:reusable-key',
      }), 'DATABASE_OPERATION_UNSUPPORTED');
      expect(harness.runtime.db.get('todos', 'async')).toBeNull();
      expect(harness.runtime.db.currentSeq).toBe(0);

      expectDatabaseCode(() => harness.engine.execute({
        type: 'command',
        name: 'invalidResult',
        input: null,
        idempotencyKey: 'command:invalid-result',
      }), 'DATABASE_PAYLOAD_INVALID');
      expect(harness.runtime.db.get('todos', 'invalid')).toBeNull();
      expect(harness.runtime.db.currentSeq).toBe(0);

      // A failed command has no durable receipt, so the key was not consumed.
      const committed = asCommit(harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'command:reusable-key',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'safe', title: 'committed' },
        },
      }));
      expect(committed.sequence.seq).toBe(1);
      expect(harness.runtime.db.get('todos', 'safe')).toEqual({
        id: 'safe', title: 'committed',
      });
    } finally {
      harness.close();
    }
  });

  test('applies realm logical row validation before managed mutations', () => {
    const validatedTables = {
      todos: {
        id: 'text primary key',
        title: 'text not null',
        [SYNC_TABLE_MUTATION_VALIDATOR]: {
          primaryKey: 'id',
          fieldNames: ['title'],
          decodeRow: (row: Record<string, unknown>) => ({ ...row }),
          encodeRow: (row: Record<string, unknown>) => ({ ...row }),
          validateRow: (row: Record<string, unknown>) =>
            typeof row.title === 'string' && row.title.trim().length > 0
              ? { success: true as const, output: row }
              : {
                success: false as const,
                issues: [{ path: 'title', message: 'required' }],
              },
        },
      },
    } satisfies Record<string, TableSchema>;
    const realm = defineDatabaseRealm({
      name: 'writer-logical-validation',
      version: '1',
      tables: validatedTables,
    });
    const harness = createHarness({ realm });
    try {
      expectDatabaseCode(() => harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'logical:reusable',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'invalid', title: '' },
        },
      }), 'DATABASE_PAYLOAD_INVALID');
      expect(harness.runtime.db.currentSeq).toBe(0);
      expect(harness.runtime.db.get('todos', 'invalid')).toBeNull();

      const committed = asCommit(harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'logical:reusable',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'valid', title: 'Valid' },
        },
      }));
      expect(committed.sequence.seq).toBe(1);
    } finally {
      harness.close();
    }
  });
});

describe('DatabaseWriterOperationEngine reads and replay', () => {
  test('returns bounded primary-key pages and the represented snapshot sequence', () => {
    const harness = createHarness();
    try {
      for (const id of ['b', 'a', 'c']) {
        harness.engine.execute({
          type: 'mutate',
          idempotencyKey: `seed:${id}`,
          mutation: { type: 'create', table: 'todos', row: { id, title: id } },
        });
      }

      const first = asRead(harness.engine.execute({
        type: 'list', table: 'todos', limit: 2,
      }));
      expect(first).toEqual({
        value: {
          rows: [
            { id: 'a', title: 'a' },
            { id: 'b', title: 'b' },
          ],
          nextCursor: 'b',
        },
        sequence: { seq: 3 },
      });
      const second = asRead(harness.engine.execute({
        type: 'list', table: 'todos', limit: 2, after: 'b',
      }));
      expect(second).toEqual({
        value: { rows: [{ id: 'c', title: 'c' }], nextCursor: null },
        sequence: { seq: 3 },
      });
      expect(asRead(harness.engine.execute({
        type: 'get',
        table: 'todos',
        id: 'a',
        consistency: { mode: 'strong' },
      }))).toEqual({
        value: { id: 'a', title: 'a' },
        sequence: { seq: 3 },
      });

      expectDatabaseCode(() => harness.engine.execute({
        type: 'get',
        table: 'todos',
        id: 'a',
        consistency: {
          mode: 'read-your-writes',
          minSeq: { seq: 4 },
        },
      }), 'DATABASE_NOT_READY');
    } finally {
      harness.close();
    }
  });

  test('executes the same bounded structured find semantics on the writer lane', () => {
    const harness = createHarness();
    try {
      for (const [id, title] of [
        ['b', 'Same'],
        ['a', 'Same'],
        ['c', 'Different'],
      ] as const) {
        harness.engine.execute({
          type: 'mutate',
          idempotencyKey: `find-seed:${id}`,
          mutation: { type: 'create', table: 'todos', row: { id, title } },
        });
      }

      expect(asRead(harness.engine.execute({
        type: 'find',
        table: 'todos',
        select: ['id'],
        filters: [{
          type: 'allOf',
          filters: [
            { type: 'field', field: 'title', operator: 'ne', value: 'different' },
            { type: 'field', field: 'id', operator: 'in', value: ['a', 'b', null] },
          ],
        }],
        order: [{ field: 'title', direction: 'asc' }],
        limit: 1,
        offset: 1,
        consistency: { mode: 'strong' },
      }))).toEqual({
        value: [{ id: 'b' }],
        sequence: { seq: 3 },
      });

      expect(asRead(harness.engine.execute({
        type: 'find', table: 'todos', limit: 10,
        filters: [{
          type: 'field', field: 'title', operator: 'ne', value: 'different',
          match: 'exact',
        }],
      })).value).toEqual([
        { id: 'a', title: 'Same' },
        { id: 'b', title: 'Same' },
        { id: 'c', title: 'Different' },
      ]);

      const ranges = [
        ['gt', 'Different', ['a', 'b']],
        ['gte', 'Same', ['a', 'b']],
        ['lt', 'Same', ['c']],
        ['lte', 'Different', ['c']],
      ] as const;
      for (const [operator, value, ids] of ranges) {
        expect(asRead(harness.engine.execute({
          type: 'find', table: 'todos', select: ['id'], limit: 10,
          filters: [{ type: 'field', field: 'title', operator, value }],
        })).value).toEqual(ids.map((id) => ({ id })));
      }
    } finally {
      harness.close();
    }
  });

  test('makes registered writer-side queries read-only and exposes no raw SQL operation', () => {
    const realm = defineDatabaseRealm({
      name: 'writer-query-only',
      version: '1',
      tables: todoTables,
      queries: {
        unsafeWrite: ({ database }) => {
          database.run("INSERT INTO todos (id, title) VALUES ('raw', 'unsafe')");
          return null;
        },
      },
    });
    const harness = createHarness({ realm });
    try {
      expectDatabaseCode(() => harness.engine.execute({
        type: 'query', name: 'unsafeWrite', input: null,
      }), 'DATABASE_EXECUTOR_FAILED');
      expect(harness.runtime.db.get('todos', 'raw')).toBeNull();
      expect(harness.runtime.db.currentSeq).toBe(0);

      expectDatabaseCode(() => harness.engine.execute({
        type: 'raw-sql',
        sql: "INSERT INTO todos VALUES ('raw', 'unsafe')",
      }), 'DATABASE_OPERATION_UNSUPPORTED');
      expect(harness.runtime.db.get('todos', 'raw')).toBeNull();
    } finally {
      harness.close();
    }
  });

  test('returns contiguous durable changes or a stable history gap', () => {
    const harness = createHarness({ ringBufferDepth: 2 });
    try {
      for (const id of ['one', 'two', 'three']) {
        harness.engine.execute({
          type: 'mutate',
          idempotencyKey: `history:${id}`,
          mutation: { type: 'create', table: 'todos', row: { id, title: id } },
        });
      }

      expectDatabaseCode(
        () => harness.engine.replayChanges(0, 2),
        'DATABASE_HISTORY_GAP',
      );
      const replay = harness.engine.replayChanges(1, 2);
      expect(replay.sequence).toEqual({ seq: 3 });
      expect(replay.value.afterSeq).toBe(1);
      expect(replay.value.throughSeq).toBe(3);
      expect(replay.value.nextAfterSeq).toBeNull();
      expect(replay.value.changes.map((change) => change.seq)).toEqual([2, 3]);
      expect(replay.value.changes.map((change) => change.rowId)).toEqual([
        'two', 'three',
      ]);
      expect(harness.engine.replayChanges(3, 2)).toEqual({
        value: {
          afterSeq: 3,
          throughSeq: 3,
          nextAfterSeq: null,
          changes: [],
        },
        sequence: { seq: 3 },
      });
    } finally {
      harness.close();
    }
  });

  test('returns bounded contiguous replay pages with an explicit continuation cursor', () => {
    const harness = createHarness({ ringBufferDepth: 8 });
    try {
      for (const id of ['one', 'two', 'three', 'four']) {
        harness.engine.execute({
          type: 'mutate',
          idempotencyKey: `page:${id}`,
          mutation: { type: 'create', table: 'todos', row: { id, title: id } },
        });
      }

      const first = harness.engine.replayChanges(0, 2);
      expect(first).toEqual({
        value: {
          afterSeq: 0,
          throughSeq: 2,
          nextAfterSeq: 2,
          changes: expect.any(Array),
        },
        sequence: { seq: 4 },
      });
      expect(first.value.changes.map((change) => change.seq)).toEqual([1, 2]);

      const second = harness.engine.replayChanges(first.value.nextAfterSeq!, 2);
      expect(second.value.afterSeq).toBe(2);
      expect(second.value.throughSeq).toBe(4);
      expect(second.value.nextAfterSeq).toBeNull();
      expect(second.value.changes.map((change) => change.seq)).toEqual([3, 4]);
      expect(second.sequence).toEqual({ seq: 4 });

      for (const invalidLimit of [0, -1, 1.5, DATABASE_WRITER_MAX_REPLAY_CHANGES + 1]) {
        expectDatabaseCode(
          () => harness.engine.replayChanges(0, invalidLimit),
          'DATABASE_PAYLOAD_INVALID',
        );
      }
    } finally {
      harness.close();
    }
  });
});
