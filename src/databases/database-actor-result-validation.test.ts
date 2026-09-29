import { describe, expect, test } from 'bun:test';

import { DatabaseError, type DatabaseErrorCode } from './database-error';
import {
  DATABASE_OPERATION_MAX_STRING_BYTES,
  validateDatabaseOperation,
  type DatabaseOperation,
} from './database-operations';
import {
  validateDatabaseActorExecuteOutcome,
  validateDatabaseActorExecuteResult,
  validateDatabaseActorReplayResult,
} from './database-actor-result-validation';
import {
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
} from './database-writer-engine';

const catalog = {
  tables: ['todos'],
  columns: { todos: ['id', 'title'] },
  primaryKeys: { todos: 'id' },
  commands: ['todos.rename'],
};

const updateOperation = operation({
  type: 'mutate',
  idempotencyKey: 'update:1',
  mutation: { type: 'update', table: 'todos', id: 'a', patch: { title: 'A2' } },
});
const batchOperation = operation({
  type: 'batch',
  idempotencyKey: 'batch:1',
  mutations: [
    { type: 'create', table: 'todos', row: { id: 'a', title: 'A' } },
    { type: 'update', table: 'todos', id: 'missing', patch: { title: 'none' } },
    { type: 'delete', table: 'todos', id: 'b' },
  ],
});
const commandOperation = operation({
  type: 'command',
  name: 'todos.rename',
  input: { id: 'a', title: 'A2' },
  idempotencyKey: 'command:1',
});

describe('database actor execute result validation', () => {
  test('accepts generic reads and enforces read-your-writes sequence correlation', () => {
    const read = operation({
      type: 'query',
      name: 'anything',
      input: null,
      consistency: { mode: 'read-your-writes', minSeq: { seq: 4 } },
    });
    const result = validateDatabaseActorExecuteResult({
      value: { arbitrary: ['query', 1, true] },
      sequence: { seq: 4 },
    }, read);
    expect(result).toEqual({
      value: { arbitrary: ['query', 1, true] },
      sequence: { seq: 4 },
    });
    expect(Object.isFrozen(result)).toBe(true);

    expectFailure(() => validateDatabaseActorExecuteResult({
      value: null,
      sequence: { seq: 3 },
    }, read), 'DATABASE_PROTOCOL_ERROR', null);
    expectFailure(() => validateDatabaseActorExecuteResult({
      value: null,
      sequence: { seq: 4 },
      extra: true,
    }, read), 'DATABASE_RESULT_LIMIT', null);
    expectFailure(() => validateDatabaseActorExecuteResult({
      value: 'x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES + 1),
      sequence: { seq: 4 },
    }, read), 'DATABASE_RESULT_LIMIT', null);
    expectFailure(() => validateDatabaseActorExecuteResult({
      value: undefined,
      sequence: { seq: 4 },
    }, read), 'DATABASE_RESULT_LIMIT', null);
  });

  test('correlates bounded find rows with the requested projection', () => {
    const find = operation({
      type: 'find',
      table: 'todos',
      select: ['title'],
      filters: [{ type: 'field', field: 'title', operator: 'contains', value: 'A' }],
      limit: 2,
    });
    expect(validateDatabaseActorExecuteResult({
      value: [{ title: 'A' }, { title: 'AA' }],
      sequence: { seq: 3 },
    }, find, catalog)).toEqual({
      value: [{ title: 'A' }, { title: 'AA' }],
      sequence: { seq: 3 },
    });

    for (const value of [
      { title: 'A' },
      [{ id: 'a', title: 'A' }],
      [{ title: 'A', secret: 'leak' }],
      [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
    ]) {
      expectFailure(() => validateDatabaseActorExecuteResult({
        value,
        sequence: { seq: 3 },
      }, find, catalog), 'DATABASE_PROTOCOL_ERROR', null);
    }

    const allColumns = operation({
      type: 'find', table: 'todos', limit: 1,
    });
    expectFailure(() => validateDatabaseActorExecuteResult({
      value: [{ id: 'a' }], sequence: { seq: 1 },
    }, allColumns, catalog), 'DATABASE_PROTOCOL_ERROR', null);
  });

  test('correlates mutation receipts and effect coherence exactly', () => {
    const valid = mutationResult();
    expect(validateDatabaseActorExecuteResult(valid, updateOperation, catalog))
      .toEqual(valid);

    const hostile = [
      { ...valid, idempotencyKey: 'another-key' },
      { ...valid, value: { kind: 'batch', mutations: [] } },
      mutationResult({ type: 'delete' }),
      mutationResult({ table: 'other' }),
      mutationResult({ rowId: 'b' }),
      mutationResult({ changed: false, op: 'UPDATE', sequence: { seq: 4 } }),
      mutationResult({ changed: true, op: null, sequence: null }),
      mutationResult({ changed: true, op: 'INSERT', sequence: { seq: 4 } }),
      mutationResult({ changed: true, op: 'UPDATE', sequence: { seq: 3 } }),
      mutationResult({ unexpected: true }),
    ];
    for (const candidate of hostile) {
      expectFailure(
        () => validateDatabaseActorExecuteResult(candidate, updateOperation),
        'DATABASE_PROTOCOL_ERROR',
        'unknown',
      );
    }

    const create = operation({
      type: 'mutate',
      idempotencyKey: 'create:1',
      mutation: { type: 'create', table: 'todos', row: { id: 'a', title: 'A' } },
    });
    expectFailure(() => validateDatabaseActorExecuteResult({
      value: {
        kind: 'mutation',
        mutation: {
          type: 'create', table: 'todos', rowId: 'a',
          changed: false, op: null, sequence: null,
          row: null, previousRow: null,
        },
      },
      sequence: { seq: 0 },
      idempotencyKey: 'create:1',
      replayed: false,
    }, create, catalog), 'DATABASE_PROTOCOL_ERROR', 'unknown');

    const validCreate = {
      value: {
        kind: 'mutation',
        mutation: {
          type: 'create', table: 'todos', rowId: 'a',
          changed: true, op: 'INSERT', sequence: { seq: 1 },
          row: { id: 'a', title: 'A' }, previousRow: null,
        },
      },
      sequence: { seq: 1 },
      idempotencyKey: 'create:1',
      replayed: false,
    };
    expect(validateDatabaseActorExecuteResult(validCreate, create, catalog))
      .toEqual(validCreate);
    expectFailure(() => validateDatabaseActorExecuteResult({
      ...validCreate,
      value: {
        kind: 'mutation',
        mutation: { ...validCreate.value.mutation, rowId: 'forged' },
      },
    }, create, catalog), 'DATABASE_PROTOCOL_ERROR', 'unknown');

    for (const [submittedRow, committedId] of [
      [{ id: 42, title: 'numeric' }, 42],
      [{ title: 'generated' }, 7],
    ] as const) {
      const numericOrGenerated = operation({
        type: 'mutate',
        idempotencyKey: `create:${committedId}`,
        mutation: { type: 'create', table: 'todos', row: submittedRow },
      });
      expect(validateDatabaseActorExecuteResult({
        value: {
          kind: 'mutation',
          mutation: {
            type: 'create', table: 'todos', rowId: String(committedId),
            changed: true, op: 'INSERT', sequence: { seq: 2 },
            row: { id: committedId, title: submittedRow.title },
            previousRow: null,
          },
        },
        sequence: { seq: 2 },
        idempotencyKey: `create:${committedId}`,
        replayed: false,
      }, numericOrGenerated, catalog)).toMatchObject({
        value: { mutation: { rowId: String(committedId) } },
      });
    }

    const generated = operation({
      type: 'mutate',
      idempotencyKey: 'create:invalid-generated-id',
      mutation: { type: 'create', table: 'todos', row: { title: 'invalid' } },
    });
    for (const committedId of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expectFailure(() => validateDatabaseActorExecuteResult({
        value: {
          kind: 'mutation',
          mutation: {
            type: 'create', table: 'todos', rowId: String(committedId),
            changed: true, op: 'INSERT', sequence: { seq: 3 },
            row: { id: committedId, title: 'invalid' }, previousRow: null,
          },
        },
        sequence: { seq: 3 },
        idempotencyKey: 'create:invalid-generated-id',
        replayed: false,
      }, generated, catalog), 'DATABASE_PROTOCOL_ERROR', 'unknown');
    }
    expectFailure(() => validateDatabaseActorExecuteResult({
      value: {
        kind: 'mutation',
        mutation: {
          type: 'create', table: 'todos', rowId: '1',
          changed: true, op: 'INSERT', sequence: { seq: 3 },
          row: { id: 1n, title: 'invalid' }, previousRow: null,
        },
      },
      sequence: { seq: 3 },
      idempotencyKey: 'create:invalid-generated-id',
      replayed: false,
    }, generated, catalog), 'DATABASE_RESULT_LIMIT', 'unknown');
  });

  test('detaches only aggregate receipt compaction telemetry', () => {
    const result = mutationResult();
    const receiptCompaction = {
      totalKeys: 10_001,
      retainedResults: 10_000,
      expiredTombstones: 1,
      retainedResultBytes: 20_000,
      keyLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
      prunedCount: 1,
      prunedResultBytes: 2,
      retainedLimit: DATABASE_WRITER_MAX_RECEIPTS,
      retainedByteLimit: DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
      resultByteLimit: DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
    };
    expect(validateDatabaseActorExecuteOutcome({
      result,
      receiptCompaction,
    }, updateOperation, catalog)).toEqual({ result, receiptCompaction });

    for (const invalid of [
      { ...receiptCompaction, receiptKey: 'private' },
      { ...receiptCompaction, prunedCount: 0 },
      { ...receiptCompaction, totalKeys: 10_002 },
      { ...receiptCompaction, retainedLimit: 9_999 },
      { ...receiptCompaction, keyLimit: 999_999 },
      { ...receiptCompaction, retainedResultBytes: 67_108_865 },
      { ...receiptCompaction, prunedResultBytes: 0 },
    ]) {
      expectFailure(() => validateDatabaseActorExecuteOutcome({
        result,
        receiptCompaction: invalid,
      }, updateOperation, catalog), 'DATABASE_PROTOCOL_ERROR', 'unknown');
    }
    expectFailure(() => validateDatabaseActorExecuteOutcome({
      result: { ...result, replayed: true },
      receiptCompaction,
    }, updateOperation, catalog), 'DATABASE_PROTOCOL_ERROR', 'unknown');
  });

  test('accepts the exact v1 mutation effect only for a replayed receipt', () => {
    const legacy = {
      value: {
        kind: 'mutation',
        mutation: {
          type: 'update',
          table: 'todos',
          rowId: 'a',
          changed: true,
          op: 'UPDATE',
          sequence: { seq: 4 },
        },
      },
      sequence: { seq: 4 },
      idempotencyKey: 'update:1',
      replayed: true,
    };
    expect(validateDatabaseActorExecuteResult(legacy, updateOperation, catalog))
      .toEqual(legacy);
    expectWriteProtocol({ ...legacy, replayed: false }, updateOperation);
    expectWriteProtocol({
      ...legacy,
      value: {
        kind: 'mutation',
        mutation: { ...legacy.value.mutation, privateField: 'must-fail' },
      },
    }, updateOperation);
  });

  test('correlates ordered batch effects and their final durable sequence', () => {
    const valid = batchResult();
    expect(validateDatabaseActorExecuteResult(valid, batchOperation, catalog))
      .toEqual(valid);

    const tooShort = batchResult();
    tooShort.value.mutations.pop();
    expectWriteProtocol(tooShort, batchOperation);

    const gap = batchResult();
    gap.value.mutations[2]!.sequence = { seq: 12 };
    gap.sequence = { seq: 12 };
    expectWriteProtocol(gap, batchOperation);

    const wrongFinal = batchResult();
    wrongFinal.sequence = { seq: 11 };
    expectWriteProtocol(wrongFinal, batchOperation);

    const wrongNoChange = batchResult();
    wrongNoChange.value.mutations[1]!.rowId = 'another';
    expectWriteProtocol(wrongNoChange, batchOperation);
  });

  test('validates command kind/name/output and classifies bounded write failures unknown', () => {
    const valid = {
      value: {
        kind: 'command',
        name: 'todos.rename',
        output: { renamed: true },
      },
      sequence: { seq: 8 },
      idempotencyKey: 'command:1',
      replayed: false,
    };
    expect(validateDatabaseActorExecuteResult(valid, commandOperation)).toEqual(valid);
    expectWriteProtocol({
      ...valid,
      value: { ...valid.value, name: 'todos.other' },
    }, commandOperation);
    expectWriteProtocol({
      ...valid,
      value: { kind: 'mutation', mutation: null },
    }, commandOperation);
    expectFailure(() => validateDatabaseActorExecuteResult({
      ...valid,
      value: {
        ...valid.value,
        output: 'x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES + 1),
      },
    }, commandOperation), 'DATABASE_RESULT_LIMIT', 'unknown');
    expectFailure(() => validateDatabaseActorExecuteResult({
      ...valid,
      value: { ...valid.value, output: undefined },
    }, commandOperation), 'DATABASE_RESULT_LIMIT', 'unknown');
  });
});

describe('database actor replay result validation', () => {
  test('accepts a bounded partial page and an empty page only at the durable head', () => {
    const partial = replayResult({
      head: 10,
      throughSeq: 2,
      nextAfterSeq: 2,
      changes: [insertChange(1), updateChange(2)],
    });
    const partialResult: unknown = validateDatabaseActorReplayResult(partial, {
      afterSeq: 0,
      limit: 5,
    });
    expect(partialResult).toEqual(partial);

    const empty = replayResult({
      head: 10,
      afterSeq: 10,
      throughSeq: 10,
      nextAfterSeq: null,
      changes: [],
    });
    const emptyResult: unknown = validateDatabaseActorReplayResult(empty, {
      afterSeq: 10,
      limit: 5,
    });
    expect(emptyResult).toEqual(empty);
  });

  test('rejects stale correlation, gaps, non-progress, bad cursors, and unsafe change shapes', () => {
    const valid = replayResult({
      head: 3,
      throughSeq: 2,
      nextAfterSeq: 2,
      changes: [insertChange(1), updateChange(2)],
    });
    const hostile = [
      { ...valid, value: { ...valid.value, afterSeq: 1 } },
      { ...valid, value: { ...valid.value, throughSeq: 1 } },
      { ...valid, value: { ...valid.value, nextAfterSeq: null } },
      replayResult({ head: 3, throughSeq: 0, nextAfterSeq: 0, changes: [] }),
      replayResult({
        head: 3,
        throughSeq: 3,
        nextAfterSeq: null,
        changes: [insertChange(1), updateChange(3), deleteChange(4)],
      }),
      replayResult({
        head: 2,
        throughSeq: 2,
        nextAfterSeq: null,
        changes: [insertChange(1), { ...updateChange(2), previousRow: null }],
      }),
      replayResult({
        head: 1,
        throughSeq: 1,
        nextAfterSeq: null,
        changes: [{ ...insertChange(1), previousRow: { id: 'old' } }],
      }),
      replayResult({
        head: 1,
        throughSeq: 1,
        nextAfterSeq: null,
        changes: [{ ...deleteChange(1), row: { id: 'still-present' } }],
      }),
      replayResult({
        head: 1,
        throughSeq: 1,
        nextAfterSeq: null,
        changes: [{ ...insertChange(1), extra: true }],
      }),
    ];
    for (const candidate of hostile) {
      expectFailure(() => validateDatabaseActorReplayResult(candidate, {
        afterSeq: 0,
        limit: 5,
      }), 'DATABASE_PROTOCOL_ERROR', null);
    }

    expectFailure(() => validateDatabaseActorReplayResult(valid, {
      afterSeq: 0,
      limit: 1,
    }), 'DATABASE_PROTOCOL_ERROR', null);
    expectFailure(() => validateDatabaseActorReplayResult(replayResult({
      head: 1,
      throughSeq: 1,
      nextAfterSeq: null,
      changes: [{
        ...insertChange(1),
        row: { id: 'a', title: 'x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES + 1) },
      }],
    }), { afterSeq: 0, limit: 1 }), 'DATABASE_RESULT_LIMIT', null);
  });
});

function operation(value: unknown): DatabaseOperation {
  return validateDatabaseOperation(value, catalog);
}

function mutationResult(effect: Record<string, unknown> = {}) {
  return {
    value: {
      kind: 'mutation',
      mutation: {
        type: 'update',
        table: 'todos',
        rowId: 'a',
        changed: true,
        op: 'UPDATE',
        sequence: { seq: 4 },
        row: { id: 'a', title: 'new' },
        previousRow: { id: 'a', title: 'old' },
        ...effect,
      },
    },
    sequence: { seq: 4 },
    idempotencyKey: 'update:1',
    replayed: false,
  };
}

function batchResult() {
  return {
    value: {
      kind: 'batch',
      mutations: [
        {
          type: 'create', table: 'todos', rowId: 'a',
          changed: true, op: 'INSERT', sequence: { seq: 9 },
          row: { id: 'a', title: 'A' }, previousRow: null,
        },
        {
          type: 'update', table: 'todos', rowId: 'missing',
          changed: false, op: null, sequence: null,
          row: null, previousRow: null,
        },
        {
          type: 'delete', table: 'todos', rowId: 'b',
          changed: true, op: 'DELETE', sequence: { seq: 10 },
          row: null, previousRow: { id: 'b', title: 'B' },
        },
      ],
    },
    sequence: { seq: 10 },
    idempotencyKey: 'batch:1',
    replayed: false,
  };
}

function replayResult(options: {
  head: number;
  afterSeq?: number;
  throughSeq: number;
  nextAfterSeq: number | null;
  changes: Array<Record<string, unknown>>;
}) {
  return {
    value: {
      afterSeq: options.afterSeq ?? 0,
      throughSeq: options.throughSeq,
      nextAfterSeq: options.nextAfterSeq,
      changes: options.changes,
    },
    sequence: { seq: options.head },
  };
}

function insertChange(seq: number): Record<string, unknown> {
  return {
    seq, table: 'todos', op: 'INSERT', rowId: `row-${seq}`,
    row: { id: `row-${seq}`, title: 'new' }, previousRow: null, ts: 1_000 + seq,
  };
}

function updateChange(seq: number): Record<string, unknown> {
  return {
    seq, table: 'todos', op: 'UPDATE', rowId: `row-${seq}`,
    row: { id: `row-${seq}`, title: 'new' },
    previousRow: { id: `row-${seq}`, title: 'old' }, ts: 1_000 + seq,
  };
}

function deleteChange(seq: number): Record<string, unknown> {
  return {
    seq, table: 'todos', op: 'DELETE', rowId: `row-${seq}`,
    row: null, previousRow: { id: `row-${seq}`, title: 'old' }, ts: 1_000 + seq,
  };
}

function expectWriteProtocol(value: unknown, submitted: DatabaseOperation): void {
  expectFailure(
    () => validateDatabaseActorExecuteResult(value, submitted, catalog),
    'DATABASE_PROTOCOL_ERROR',
    'unknown',
  );
}

function expectFailure(
  operation: () => unknown,
  code: DatabaseErrorCode,
  outcome: DatabaseError['outcome'],
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
    expect((error as DatabaseError).outcome).toBe(outcome);
    return;
  }
  throw new Error('Expected a DatabaseError.');
}
