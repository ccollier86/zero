/** Query-only reads and bounded durable replay for a writer-owned runtime. */

import type { Change, Row } from '../sync/types';
import { DatabaseError } from './database-error';
import { runDatabaseFind } from './database-find';
import { createDatabaseListQuerySql } from './database-list-query';
import {
  openDatabaseWriterReadQuerySession,
  withDatabaseReadQuerySession,
} from './database-read-query-capability';
import { produceValidatedDatabaseReadResult } from './database-read-result-validation';
import {
  cloneDatabaseSerializableValue,
  createDatabaseSequenceToken,
  validateDatabaseReadResult,
  type DatabaseListOperation,
  type DatabaseListPage,
  type DatabaseOperationCatalog,
  type DatabaseOperationRow,
  type DatabaseReadOperation,
  type DatabaseReadResult,
} from './database-operations';
import { runDatabaseRealmQuery, type DatabaseRealm } from './database-realm';
import type { DatabaseRuntime } from './database-runtime';
import {
  DATABASE_WRITER_MAX_REPLAY_CHANGES,
  type DatabaseChangeReplayPage,
  type DatabaseChangeReplayResult,
  type DatabaseReplayChange,
} from './database-writer-contracts';

export function executeDatabaseWriterRead(
  runtime: DatabaseRuntime,
  realm: DatabaseRealm,
  catalog: DatabaseOperationCatalog,
  operation: DatabaseReadOperation,
): DatabaseReadResult {
  try {
    const previousQueryOnly = readQueryOnly(runtime);
    runtime.sqlite.raw.run('PRAGMA query_only = ON');
    try {
      return produceValidatedDatabaseReadResult(() => {
        const snapshot = runtime.db.readAtCurrentSequence(() => {
          switch (operation.type) {
            case 'get':
              return runtime.db.get(operation.table, operation.id);
            case 'list':
              return readListPage(runtime, catalog, operation);
            case 'find':
              return runDatabaseFind(runtime.sqlite.raw, operation, catalog);
            case 'query':
              return withDatabaseReadQuerySession(
                openDatabaseWriterReadQuerySession(runtime),
                (context) => runDatabaseRealmQuery(
                  realm,
                  context,
                  operation.name,
                  operation.input,
                ),
              );
          }
        });

        if (operation.consistency?.mode === 'read-your-writes'
          && snapshot.seq < operation.consistency.minSeq.seq) {
          throw new DatabaseError(
            'DATABASE_NOT_READY',
            'Database has not reached the requested sequence.',
            {
              details: {
                currentSeq: snapshot.seq,
                minSeq: operation.consistency.minSeq.seq,
              },
            },
          );
        }
        return {
          value: snapshot.value,
          sequence: createDatabaseSequenceToken(snapshot.seq),
        };
      });
    } finally {
      runtime.sqlite.raw.run(
        `PRAGMA query_only = ${previousQueryOnly ? 'ON' : 'OFF'}`,
      );
    }
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database read operation failed.',
      { cause: error, retryable: false, outcome: null },
    );
  }
}

export function replayDatabaseWriterChanges(
  runtime: DatabaseRuntime,
  afterSeq: number,
  limit: number,
): DatabaseChangeReplayResult {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database replay cursor must be a non-negative safe integer.',
    );
  }
  if (!Number.isSafeInteger(limit)
    || limit < 1
    || limit > DATABASE_WRITER_MAX_REPLAY_CHANGES) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database replay limit is invalid.',
    );
  }

  try {
    const page = runtime.db.getChangesPageAfter(afterSeq, limit + 1);
    if (!page) throw historyGap(afterSeq, runtime.db.currentSeq);
    const pageChanges = page.changes.slice(0, limit);
    const throughSeq = pageChanges.length === 0
      ? afterSeq
      : pageChanges[pageChanges.length - 1]!.seq;
    const value: DatabaseChangeReplayPage = {
      afterSeq,
      throughSeq,
      nextAfterSeq: page.changes.length > pageChanges.length || page.hasMore
        ? throughSeq
        : null,
      changes: pageChanges.map(toReplayChange),
    };
    return validateDatabaseReadResult({
      value,
      sequence: createDatabaseSequenceToken(page.headSeq),
    }) as DatabaseChangeReplayResult;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database change replay failed.',
      { cause: error, retryable: false, outcome: null },
    );
  }
}

function readListPage(
  runtime: DatabaseRuntime,
  catalog: DatabaseOperationCatalog,
  operation: DatabaseListOperation,
): DatabaseListPage {
  const primaryKey = catalog.primaryKeys?.[operation.table];
  if (!primaryKey) {
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database table primary key is unavailable.',
    );
  }
  const statement = runtime.db.prepare(createDatabaseListQuerySql(
    operation.table,
    primaryKey,
    operation.after !== undefined,
  ));
  try {
    const requested = operation.limit + 1;
    const rows = (operation.after === undefined
      ? statement.all(requested)
      : statement.all(operation.after, requested)) as Row[];
    const hasMore = rows.length > operation.limit;
    const pageRows = hasMore ? rows.slice(0, operation.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? String(last[primaryKey]) : null;
    return { rows: pageRows as DatabaseOperationRow[], nextCursor };
  } finally {
    statement.finalize();
  }
}

function toReplayChange(change: Change): DatabaseReplayChange {
  return cloneDatabaseSerializableValue({
    seq: change.seq,
    table: change.table,
    op: change.op,
    rowId: change.rowId,
    row: change.row,
    previousRow: change.previousRow ?? null,
    ts: change.ts,
  }) as DatabaseReplayChange;
}

function historyGap(afterSeq: number, currentSeq: number): DatabaseError {
  return new DatabaseError(
    'DATABASE_HISTORY_GAP',
    'Database change history cannot satisfy the requested cursor.',
    { details: { afterSeq, currentSeq } },
  );
}

function readQueryOnly(runtime: DatabaseRuntime): boolean {
  const row = runtime.sqlite.raw.query('PRAGMA query_only').get() as Record<
    string,
    unknown
  > | null;
  const value = row ? Object.values(row)[0] : null;
  if (value !== 0 && value !== 1) {
    throw new Error('SQLite query_only state is unavailable');
  }
  return value === 1;
}
