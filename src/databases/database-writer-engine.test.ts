import { describe, expect, spyOn, test } from 'bun:test';
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
  DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
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

const LEGACY_RECEIPT_TABLE_SQL = `
  CREATE TABLE _zero_database_operation_receipts (
    receipt_key TEXT PRIMARY KEY,
    realm_fingerprint TEXT NOT NULL,
    operation_fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    final_seq INTEGER NOT NULL CHECK (final_seq >= 0),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
  ) STRICT, WITHOUT ROWID
`;

function rewriteReceiptLedgerAsV1(
  path: string,
  replacement?: Readonly<{
    key: string;
    result: unknown;
    realmFingerprint?: string;
  }>,
): void {
  const sqlite = createPlatformSQLiteService({ mode: 'file', path });
  try {
    sqlite.raw.transaction(() => {
      sqlite.raw.run(`
        ALTER TABLE _zero_database_operation_receipts
        RENAME TO _zero_database_operation_receipts_v2_fixture
      `);
      sqlite.raw.run(LEGACY_RECEIPT_TABLE_SQL);
      sqlite.raw.run(`
        INSERT INTO _zero_database_operation_receipts (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          result_json,
          final_seq,
          schema_version,
          created_at
        )
        SELECT
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          result_json,
          final_seq,
          1,
          created_at
        FROM _zero_database_operation_receipts_v2_fixture
        WHERE receipt_state = 'retained'
      `);
      if (replacement) {
        const replace = sqlite.raw.prepare(`
          UPDATE _zero_database_operation_receipts
          SET
            result_json = ?,
            realm_fingerprint = COALESCE(?, realm_fingerprint)
          WHERE receipt_key = ?
        `);
        try {
          replace.run(
            JSON.stringify(replacement.result),
            replacement.realmFingerprint ?? null,
            replacement.key,
          );
        } finally {
          replace.finalize();
        }
      }
      sqlite.raw.run('DROP TABLE _zero_database_operation_receipts_v2_fixture');
    })();
  } finally {
    sqlite.close();
  }
}

function expectDatabaseCode(operation: () => unknown, code: DatabaseErrorCode): void {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
  }
}

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
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
  test('seals admission while retrying failed receipt-ledger cleanup', () => {
    const harness = createHarness();
    const receipts = (harness.engine as unknown as {
      receipts: { close(): void };
    }).receipts;
    const closeReceipts = receipts.close.bind(receipts);
    let attempts = 0;
    receipts.close = () => {
      attempts += 1;
      if (attempts === 1) throw new Error('injected receipt close failure');
      closeReceipts();
    };
    try {
      expect(() => harness.engine.close()).toThrow('injected receipt close failure');
      expectDatabaseCode(
        () => harness.engine.replayChanges(0, 1),
        'DATABASE_CLOSED',
      );

      harness.engine.close();
      expect(attempts).toBe(2);
    } finally {
      harness.close();
    }
  });

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

  test('fails closed when private receipt statistics or triggers are incomplete', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-writer-receipt-metadata-'));
    const path = join(root, 'writer.sqlite');
    try {
      const seed = createHarness({ path });
      const realm = seed.realm;
      seed.close();

      const sqlite = createPlatformSQLiteService({ mode: 'file', path });
      sqlite.raw.run('DROP TRIGGER _zero_database_receipt_insert_guard_v1');
      sqlite.close();

      const reopenedSQLite = createPlatformSQLiteService({ mode: 'file', path });
      const runtime = DatabaseRuntime.open({
        id: 'writer-tests',
        role: 'named',
        sqlite: reopenedSQLite,
        ownsSQLite: true,
        tables: realm.tables,
      });
      try {
        expectDatabaseCode(() => new DatabaseWriterOperationEngine({
          runtime,
          realm,
        }), 'DATABASE_SCHEMA_MISMATCH');
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
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

  test('persists the hard key quota without blocking replay or expired lookup', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-writer-receipt-quota-'));
    const path = join(root, 'writer.sqlite');
    const expiredOperation = {
      type: 'mutate',
      idempotencyKey: 'quota:expired',
      mutation: {
        type: 'create', table: 'todos', row: { id: 'expired', title: 'expired' },
      },
    } as const;
    const replayOperation = {
      type: 'mutate',
      idempotencyKey: 'quota:replay',
      mutation: {
        type: 'create', table: 'todos', row: { id: 'replay', title: 'replay' },
      },
    } as const;
    const unseenOperation = {
      type: 'mutate',
      idempotencyKey: 'quota:unseen',
      mutation: {
        type: 'create', table: 'todos', row: { id: 'unseen', title: 'unseen' },
      },
    } as const;
    try {
      const seed = createHarness({ path });
      seed.engine.execute(expiredOperation);
      const firstReplay = asCommit(seed.engine.execute(replayOperation));
      seed.runtime.db.exec(`
        UPDATE _zero_database_operation_receipts
        SET receipt_state = 'expired', result_json = NULL, final_seq = NULL
        WHERE receipt_key = 'quota:expired'
      `);
      // Simulate an already-full permanent tombstone population without
      // allocating a million fixture rows. Production mutators cannot update
      // this private stats table; exact triggers maintain it transactionally.
      seed.runtime.db.exec(`
        UPDATE _zero_database_receipt_stats_v1
        SET total_keys = ${DATABASE_WRITER_MAX_RECEIPT_KEYS}
        WHERE singleton = 1
      `);
      expect(() => seed.runtime.db.exec(`
        UPDATE _zero_database_receipt_stats_v1
        SET total_keys = ${DATABASE_WRITER_MAX_RECEIPT_KEYS + 1}
        WHERE singleton = 1
      `)).toThrow();

      expect(asCommit(seed.engine.execute(replayOperation))).toEqual({
        ...firstReplay,
        replayed: true,
      });
      const expired = captureDatabaseError(
        () => seed.engine.execute(expiredOperation),
      );
      expect(expired).toMatchObject({
        code: 'DATABASE_OUTCOME_UNKNOWN',
        retryable: false,
        outcome: 'unknown',
        details: { receiptState: 'expired' },
      });
      const rejected = captureDatabaseError(
        () => seed.engine.execute(unseenOperation),
      );
      expect(rejected).toMatchObject({
        code: 'DATABASE_CAPACITY_EXHAUSTED',
        retryable: false,
        outcome: 'not-started',
        details: {
          capacityType: 'receipts',
          capacityLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
        },
      });
      expect(seed.runtime.db.get('todos', 'unseen')).toBeNull();
      expect(seed.runtime.db.currentSeq).toBe(2);

      expect(() => seed.runtime.db.exec(`
        INSERT INTO _zero_database_operation_receipts (
          receipt_key, realm_fingerprint, operation_fingerprint,
          receipt_state, result_json, final_seq, result_version,
          schema_version, created_at, insertion_ordinal
        ) VALUES (
          'quota:bypass', '${seed.realm.fingerprint}',
          'sha256:${'f'.repeat(64)}', 'expired', NULL, NULL, 2,
          ${DATABASE_WRITER_RECEIPT_SCHEMA_VERSION}, 0, 3
        )
      `)).toThrow();
      seed.close();

      const reopened = createHarness({ path });
      try {
        expect(asCommit(reopened.engine.execute(replayOperation))).toMatchObject({
          replayed: true,
          sequence: firstReplay.sequence,
        });
        expect(captureDatabaseError(
          () => reopened.engine.execute(unseenOperation),
        )).toMatchObject({
          code: 'DATABASE_CAPACITY_EXHAUSTED',
          retryable: false,
          outcome: 'not-started',
          details: {
            capacityType: 'receipts',
            capacityLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
          },
        });
        expect(reopened.runtime.db.get('todos', 'unseen')).toBeNull();
        expect(reopened.runtime.db.currentSeq).toBe(2);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('uses a trusted logical receipt across reconstructed CAS operations', () => {
    const harness = createHarness();
    const fingerprint = `sha256:${'a'.repeat(64)}` as const;
    const anotherFingerprint = `sha256:${'b'.repeat(64)}` as const;
    try {
      harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'seed:logical-receipt',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'one', title: 'old' },
        },
      });
      expect(harness.engine.findReceipt('resource:update:one', fingerprint))
        .toEqual({ status: 'miss' });

      const first = asCommit(harness.engine.execute({
        type: 'batch',
        idempotencyKey: 'resource:update:one',
        assertions: [{
          type: 'row-equals',
          table: 'todos',
          id: 'one',
          row: { id: 'one', title: 'old' },
        }],
        mutations: [{
          type: 'update', table: 'todos', id: 'one', patch: { title: 'new' },
        }],
      }, fingerprint));
      expect(first.value).toMatchObject({
        kind: 'batch',
        mutations: [{
          row: { id: 'one', title: 'new' },
          previousRow: { id: 'one', title: 'old' },
        }],
      });

      const lookup = harness.engine.findReceipt(
        'resource:update:one',
        fingerprint,
      );
      expect(lookup).toMatchObject({
        status: 'hit',
        result: { replayed: true, sequence: first.sequence, value: first.value },
      });
      const replay = asCommit(harness.engine.execute({
        type: 'batch',
        idempotencyKey: 'resource:update:one',
        assertions: [{
          type: 'row-equals',
          table: 'todos',
          id: 'one',
          row: { id: 'one', title: 'different-reconstruction' },
        }],
        mutations: [{
          type: 'update',
          table: 'todos',
          id: 'one',
          patch: { title: 'must-not-run' },
        }],
      }, fingerprint));
      expect(replay.replayed).toBe(true);
      expect(replay.value).toEqual(first.value);
      expect(harness.runtime.db.get('todos', 'one')).toEqual({
        id: 'one', title: 'new',
      });

      try {
        harness.engine.findReceipt('resource:update:one', anotherFingerprint);
        throw new Error('Expected receipt fingerprint conflict.');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe('DATABASE_CONFLICT');
        expect((error as DatabaseError).details.conflictType).toBe(
          'idempotency-key-reused',
        );
      }
    } finally {
      harness.close();
    }
  });

  test('prunes the oldest full result to a compact tombstone and retains the key', () => {
    const harness = createHarness();
    try {
      harness.runtime.db.exec(`
        WITH RECURSIVE receipt_numbers(value) AS (
          SELECT 0
          UNION ALL
          SELECT value + 1 FROM receipt_numbers
          WHERE value + 1 < ${DATABASE_WRITER_MAX_RECEIPTS}
        )
        INSERT INTO _zero_database_operation_receipts (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          receipt_state,
          result_json,
          final_seq,
          result_version,
          schema_version,
          created_at,
          insertion_ordinal
        )
        SELECT
          printf('seed:%05d', value),
          '${harness.realm.fingerprint}',
          'sha256:${'f'.repeat(64)}',
          'retained',
          '{}',
          0,
          2,
          ${DATABASE_WRITER_RECEIPT_SCHEMA_VERSION},
          value,
          value + 1
        FROM receipt_numbers
      `);
      harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'receipt:newest',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'one', title: 'one' },
        },
      });
      const count = harness.runtime.db.prepare(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE receipt_state = 'retained') AS retained,
          COUNT(*) FILTER (WHERE receipt_state = 'expired') AS expired
        FROM _zero_database_operation_receipts`,
      );
      const oldest = harness.runtime.db.prepare(`
        SELECT receipt_key, receipt_state, result_json, final_seq
        FROM _zero_database_operation_receipts
        ORDER BY insertion_ordinal ASC
        LIMIT 1
      `);
      try {
        expect(count.get()).toEqual({
          total: DATABASE_WRITER_MAX_RECEIPTS + 1,
          retained: DATABASE_WRITER_MAX_RECEIPTS,
          expired: 1,
        });
        expect(harness.engine.receiptRetentionCounts()).toMatchObject({
          totalKeys: DATABASE_WRITER_MAX_RECEIPTS + 1,
          retainedResults: DATABASE_WRITER_MAX_RECEIPTS,
          expiredTombstones: 1,
          keyLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
          retainedLimit: DATABASE_WRITER_MAX_RECEIPTS,
          retainedByteLimit: DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
          resultByteLimit: DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
        });
        expect(harness.engine.takeReceiptCompaction()).toMatchObject({
          totalKeys: DATABASE_WRITER_MAX_RECEIPTS + 1,
          retainedResults: DATABASE_WRITER_MAX_RECEIPTS,
          expiredTombstones: 1,
          prunedCount: 1,
          prunedResultBytes: 2,
          keyLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
          retainedLimit: DATABASE_WRITER_MAX_RECEIPTS,
          retainedByteLimit: DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
          resultByteLimit: DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
        });
        expect(harness.engine.takeReceiptCompaction()).toBeNull();
        expect(oldest.get()).toEqual({
          receipt_key: 'seed:00000',
          receipt_state: 'expired',
          result_json: null,
          final_seq: null,
        });
      } finally {
        count.finalize();
        oldest.finalize();
      }
    } finally {
      harness.close();
    }
  });

  test('derives compaction counts without scanning a large permanent tombstone ledger', () => {
    const harness = createHarness();
    const expiredBefore = DATABASE_WRITER_MAX_RECEIPTS * 2;
    try {
      harness.runtime.db.exec(`
        WITH RECURSIVE receipt_numbers(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM receipt_numbers
          WHERE value < ${expiredBefore}
        )
        INSERT INTO _zero_database_operation_receipts (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          receipt_state,
          result_json,
          final_seq,
          result_version,
          schema_version,
          created_at,
          insertion_ordinal
        )
        SELECT
          printf('expired:%05d', value),
          '${harness.realm.fingerprint}',
          'sha256:${'e'.repeat(64)}',
          'expired',
          NULL,
          NULL,
          2,
          ${DATABASE_WRITER_RECEIPT_SCHEMA_VERSION},
          value,
          value
        FROM receipt_numbers
      `);
      harness.runtime.db.exec(`
        WITH RECURSIVE receipt_numbers(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM receipt_numbers
          WHERE value < ${DATABASE_WRITER_MAX_RECEIPTS}
        )
        INSERT INTO _zero_database_operation_receipts (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          receipt_state,
          result_json,
          final_seq,
          result_version,
          schema_version,
          created_at,
          insertion_ordinal
        )
        SELECT
          printf('retained:%05d', value),
          '${harness.realm.fingerprint}',
          'sha256:${'f'.repeat(64)}',
          'retained',
          '{}',
          0,
          2,
          ${DATABASE_WRITER_RECEIPT_SCHEMA_VERSION},
          ${expiredBefore} + value,
          ${expiredBefore} + value
        FROM receipt_numbers
      `);

      const aggregateDiagnostics = spyOn(
        harness.engine,
        'receiptRetentionCounts',
      ).mockImplementation(() => {
        throw new Error('Compaction must not scan aggregate receipt diagnostics');
      });
      expect(asCommit(harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'receipt:large-tombstone-trigger',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'large', title: 'large' },
        },
      }))).toMatchObject({ replayed: false, sequence: { seq: 1 } });
      expect(aggregateDiagnostics).not.toHaveBeenCalled();
      expect(harness.engine.takeReceiptCompaction()).toMatchObject({
        totalKeys: expiredBefore + DATABASE_WRITER_MAX_RECEIPTS + 1,
        retainedResults: DATABASE_WRITER_MAX_RECEIPTS,
        expiredTombstones: expiredBefore + 1,
        prunedCount: 1,
        prunedResultBytes: 2,
        keyLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
        retainedLimit: DATABASE_WRITER_MAX_RECEIPTS,
        retainedByteLimit: DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
        resultByteLimit: DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
      });
      aggregateDiagnostics.mockRestore();
      expect(harness.engine.receiptRetentionCounts()).toMatchObject({
        totalKeys: expiredBefore + DATABASE_WRITER_MAX_RECEIPTS + 1,
        retainedResults: DATABASE_WRITER_MAX_RECEIPTS,
        expiredTombstones: expiredBefore + 1,
        keyLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
        retainedLimit: DATABASE_WRITER_MAX_RECEIPTS,
        retainedByteLimit: DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
        resultByteLimit: DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
      });
    } finally {
      harness.close();
    }
  });

  test('never re-executes a matching key after its full receipt is pruned', () => {
    const harness = createHarness();
    const fingerprint = `sha256:${'a'.repeat(64)}` as const;
    const mismatchedFingerprint = `sha256:${'b'.repeat(64)}` as const;
    const operation = {
      type: 'mutate',
      idempotencyKey: 'receipt:must-never-run-twice',
      mutation: {
        type: 'upsert',
        table: 'todos',
        row: { id: 'once', title: 'committed once' },
      },
    } as const;
    try {
      expect(asCommit(harness.engine.execute(operation, fingerprint))).toMatchObject({
        replayed: false,
        sequence: { seq: 1 },
      });
      harness.runtime.db.exec(`
        WITH RECURSIVE receipt_numbers(value) AS (
          SELECT 2
          UNION ALL
          SELECT value + 1 FROM receipt_numbers
          WHERE value < ${DATABASE_WRITER_MAX_RECEIPTS}
        )
        INSERT INTO _zero_database_operation_receipts (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          receipt_state,
          result_json,
          final_seq,
          result_version,
          schema_version,
          created_at,
          insertion_ordinal
        )
        SELECT
          printf('seed:no-reexecute:%05d', value),
          '${harness.realm.fingerprint}',
          'sha256:${'f'.repeat(64)}',
          'retained',
          '{}',
          0,
          2,
          ${DATABASE_WRITER_RECEIPT_SCHEMA_VERSION},
          42,
          value
        FROM receipt_numbers
      `);
      expect(asCommit(harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'receipt:eviction-trigger',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'other', title: 'other' },
        },
      })).sequence.seq).toBe(2);

      for (const retry of [
        () => harness.engine.execute(operation, fingerprint),
        () => harness.engine.findReceipt(operation.idempotencyKey, fingerprint),
      ]) {
        try {
          retry();
          throw new Error('Expected an expired receipt outcome.');
        } catch (error) {
          expect(error).toBeInstanceOf(DatabaseError);
          expect((error as DatabaseError).code).toBe('DATABASE_OUTCOME_UNKNOWN');
          expect((error as DatabaseError).outcome).toBe('unknown');
          expect((error as DatabaseError).retryable).toBe(false);
          expect((error as DatabaseError).details).toEqual({
            receiptState: 'expired',
          });
        }
      }
      expect(harness.runtime.db.currentSeq).toBe(2);
      expect(harness.runtime.db.get('todos', 'once')).toEqual({
        id: 'once', title: 'committed once',
      });

      try {
        harness.engine.findReceipt(
          operation.idempotencyKey,
          mismatchedFingerprint,
        );
        throw new Error('Expected a receipt fingerprint conflict.');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe('DATABASE_CONFLICT');
        expect((error as DatabaseError).details).toEqual({
          conflictType: 'idempotency-key-reused',
        });
      }
      expect(harness.runtime.db.currentSeq).toBe(2);
    } finally {
      harness.close();
    }
  });

  test('uses insertion ordinals for true FIFO pruning at the same timestamp', () => {
    const harness = createHarness();
    try {
      harness.runtime.db.exec(`
        WITH RECURSIVE receipt_numbers(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM receipt_numbers
          WHERE value < ${DATABASE_WRITER_MAX_RECEIPTS}
        )
        INSERT INTO _zero_database_operation_receipts (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          receipt_state,
          result_json,
          final_seq,
          result_version,
          schema_version,
          created_at,
          insertion_ordinal
        )
        SELECT
          CASE value
            WHEN 1 THEN 'seed:z-oldest'
            WHEN 2 THEN 'seed:a-newer'
            ELSE printf('seed:m:%05d', value)
          END,
          '${harness.realm.fingerprint}',
          'sha256:${'f'.repeat(64)}',
          'retained',
          '{}',
          0,
          2,
          ${DATABASE_WRITER_RECEIPT_SCHEMA_VERSION},
          100,
          value
        FROM receipt_numbers
      `);
      harness.engine.execute({
        type: 'mutate',
        idempotencyKey: 'receipt:same-ms-trigger',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'same-ms', title: 'same-ms' },
        },
      });
      const rows = harness.runtime.db.prepare(`
        SELECT receipt_key, receipt_state, insertion_ordinal
        FROM _zero_database_operation_receipts
        WHERE receipt_key IN ('seed:z-oldest', 'seed:a-newer')
        ORDER BY insertion_ordinal ASC
      `);
      try {
        expect(rows.all()).toEqual([
          {
            receipt_key: 'seed:z-oldest',
            receipt_state: 'expired',
            insertion_ordinal: 1,
          },
          {
            receipt_key: 'seed:a-newer',
            receipt_state: 'retained',
            insertion_ordinal: 2,
          },
        ]);
      } finally {
        rows.finalize();
      }
    } finally {
      harness.close();
    }
  });

  test('migrates exact v1 receipts and preserves their replay result', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-writer-receipt-v1-'));
    const path = join(root, 'writer.sqlite');
    const fingerprint = `sha256:${'c'.repeat(64)}` as const;
    const operation = {
      type: 'mutate',
      idempotencyKey: 'receipt:v1-replay',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'legacy', title: 'legacy result' },
      },
    } as const;
    try {
      const seed = createHarness({ path });
      const first = asCommit(seed.engine.execute(operation, fingerprint));
      if (first.value.kind !== 'mutation') {
        throw new Error('Expected mutation receipt fixture.');
      }
      const effect = first.value.mutation;
      const legacyResult = {
        ...first,
        value: {
          kind: 'mutation' as const,
          mutation: {
            type: effect.type,
            table: effect.table,
            rowId: effect.rowId,
            changed: effect.changed,
            op: effect.op,
            sequence: effect.sequence,
          },
        },
      };
      seed.close();
      rewriteReceiptLedgerAsV1(path, {
        key: operation.idempotencyKey,
        result: legacyResult,
      });

      const migrated = createHarness({ path });
      try {
        const replay = asCommit(migrated.engine.execute(operation, fingerprint));
        expect(replay as unknown).toEqual({ ...legacyResult, replayed: true });
        expect(migrated.runtime.db.currentSeq).toBe(1);
        const stored = migrated.runtime.db.prepare(`
          SELECT
            schema_version,
            result_version,
            receipt_state,
            insertion_ordinal,
            typeof(result_json) AS result_json_type
          FROM _zero_database_operation_receipts
          WHERE receipt_key = ?
        `);
        try {
          expect(stored.get(operation.idempotencyKey)).toEqual({
            schema_version: DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
            result_version: 1,
            receipt_state: 'retained',
            insertion_ordinal: 1,
            result_json_type: 'text',
          });
        } finally {
          stored.finalize();
        }
      } finally {
        migrated.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('tombstones a foreign-realm v1 receipt without parsing its removed-table payload', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-writer-receipt-v1-foreign-'));
    const path = join(root, 'writer.sqlite');
    const fingerprint = `sha256:${'7'.repeat(64)}` as const;
    const foreignRealmFingerprint = `sha256:${'9'.repeat(64)}` as const;
    const operation = {
      type: 'mutate',
      idempotencyKey: 'receipt:v1-foreign',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'foreign', title: 'foreign realm result' },
      },
    } as const;
    try {
      const seed = createHarness({ path });
      const first = asCommit(seed.engine.execute(operation, fingerprint));
      const receiptIdentity = seed.runtime.db.prepare(`
        SELECT operation_fingerprint
        FROM _zero_database_operation_receipts
        WHERE receipt_key = ?
      `);
      let operationFingerprint: string;
      try {
        operationFingerprint = (receiptIdentity.get(operation.idempotencyKey) as {
          operation_fingerprint: string;
        }).operation_fingerprint;
      } finally {
        receiptIdentity.finalize();
      }
      seed.close();
      rewriteReceiptLedgerAsV1(path, {
        key: operation.idempotencyKey,
        realmFingerprint: foreignRealmFingerprint,
        // This nested result is deliberately invalid for the current catalog
        // and names a table removed with the old realm.
        result: {
          ...first,
          value: {
            kind: 'mutation',
            mutation: { table: 'removed_todos' },
          },
        },
      });

      const migrated = createHarness({ path });
      try {
        const stored = migrated.runtime.db.prepare(`
          SELECT
            receipt_key,
            realm_fingerprint,
            operation_fingerprint,
            receipt_state,
            result_json,
            final_seq,
            result_version,
            insertion_ordinal
          FROM _zero_database_operation_receipts
          WHERE receipt_key = ?
        `);
        try {
          expect(stored.get(operation.idempotencyKey)).toEqual({
            receipt_key: operation.idempotencyKey,
            realm_fingerprint: foreignRealmFingerprint,
            operation_fingerprint: operationFingerprint,
            receipt_state: 'expired',
            result_json: null,
            final_seq: null,
            result_version: 1,
            insertion_ordinal: 1,
          });
        } finally {
          stored.finalize();
        }
        expectDatabaseCode(
          () => migrated.engine.execute(operation, fingerprint),
          'DATABASE_CONFLICT',
        );
        expect(migrated.runtime.db.currentSeq).toBe(1);
        expect(migrated.runtime.db.get('todos', 'foreign')).toEqual({
          id: 'foreign', title: 'foreign realm result',
        });
      } finally {
        migrated.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails atomically and leaves v1 intact for a same-realm malformed result', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-writer-receipt-v1-invalid-'));
    const path = join(root, 'writer.sqlite');
    const fingerprint = `sha256:${'d'.repeat(64)}` as const;
    const operation = {
      type: 'mutate',
      idempotencyKey: 'receipt:v1-invalid',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'invalid-legacy', title: 'invalid legacy' },
      },
    } as const;
    try {
      const seed = createHarness({ path });
      const first = asCommit(seed.engine.execute(operation, fingerprint));
      seed.close();
      rewriteReceiptLedgerAsV1(path, {
        key: operation.idempotencyKey,
        result: {
          ...first,
          value: { kind: 'mutation', mutation: { table: 'todos' } },
        },
      });

      const sqlite = createPlatformSQLiteService({ mode: 'file', path });
      const runtime = DatabaseRuntime.open({
        id: 'writer-tests',
        role: 'named',
        sqlite,
        ownsSQLite: true,
        tables: seed.realm.tables,
      });
      try {
        expectDatabaseCode(() => new DatabaseWriterOperationEngine({
          runtime,
          realm: seed.realm,
        }), 'DATABASE_SCHEMA_MISMATCH');
        const schema = runtime.db.prepare(`
          SELECT sql
          FROM sqlite_schema
          WHERE name = '_zero_database_operation_receipts'
        `);
        try {
          expect((schema.get() as { sql: string }).sql).toContain(
            'schema_version = 1',
          );
        } finally {
          schema.finalize();
        }
      } finally {
        runtime.close();
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

  test('fails startup for BLOB-affinity application columns', () => {
    const realm = defineDatabaseRealm({
      name: 'writer-blob-rejected',
      version: '1',
      tables: {
        files: {
          id: 'text primary key',
          body: 'blob not null',
        },
      },
    });
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const runtime = DatabaseRuntime.open({
      id: 'writer-blob-rejected',
      role: 'named',
      sqlite,
      ownsSQLite: true,
      tables: realm.tables,
    });
    try {
      expectDatabaseCode(() => new DatabaseWriterOperationEngine({
        runtime,
        realm,
      }), 'DATABASE_SCHEMA_MISMATCH');
    } finally {
      runtime.close();
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
