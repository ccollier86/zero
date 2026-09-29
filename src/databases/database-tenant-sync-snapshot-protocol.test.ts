import { describe, expect, test } from 'bun:test';

import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';
import {
  validateDatabaseActorTenantSyncSnapshotAbortPayload,
  validateDatabaseActorTenantSyncSnapshotAbortResult,
  validateDatabaseActorTenantSyncSnapshotBeginPayload,
  validateDatabaseActorTenantSyncSnapshotBeginResult,
  validateDatabaseActorTenantSyncSnapshotPagePayload,
  validateDatabaseActorTenantSyncSnapshotPageResult,
} from './database-tenant-sync-snapshot-protocol';

const databaseRef = createDatabaseRef('snapshot-protocol');
const ownerToken = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const catalog = {
  tables: ['todos'],
  columns: { todos: ['id', 'title'] },
  primaryKeys: { todos: 'id' },
  queries: [],
  commands: [],
};

describe('database tenant Sync snapshot-session protocol', () => {
  test('validates exact generation/owner-bound request and result envelopes', () => {
    const begin = validateDatabaseActorTenantSyncSnapshotBeginPayload({
      databaseRef,
      generation: 4,
      ownerToken,
      tables: ['todos'],
    }, catalog);
    expect(begin).toEqual({ databaseRef, generation: 4, ownerToken, tables: ['todos'] });
    expect(Object.isFrozen(begin.tables)).toBe(true);

    const result = validateDatabaseActorTenantSyncSnapshotBeginResult({
      sessionId,
      syncEpoch: 'epoch-4',
      sequence: { seq: 9 },
      tables: ['todos'],
      totalRows: 1,
      totalSourceBytes: 28,
      expiresAt: 30_000,
    }, begin.tables, catalog);
    expect(result).toMatchObject({ sessionId, sequence: { seq: 9 }, totalRows: 1 });

    expect(validateDatabaseActorTenantSyncSnapshotPagePayload({
      ...begin,
      sessionId,
      cursor: 0,
    }, catalog)).toMatchObject({ sessionId, cursor: 0 });
    expect(validateDatabaseActorTenantSyncSnapshotAbortPayload({
      ...begin,
      sessionId,
    }, catalog)).toMatchObject({ sessionId, tables: ['todos'] });
    expect(validateDatabaseActorTenantSyncSnapshotAbortResult({ aborted: true }))
      .toEqual({ aborted: true });
  });

  test('validates ordered page identity and exact continuation', () => {
    const value = {
      sessionId,
      cursor: 0,
      rows: [{
        ordinal: 0,
        tableIndex: 0,
        rowId: 'one',
        row: { id: 'one', title: 'One' },
      }],
      nextCursor: null,
    };
    const expected = { sessionId, cursor: 0, totalRows: 1, tables: ['todos'] };
    const first = validateDatabaseActorTenantSyncSnapshotPageResult(
      value,
      expected,
      catalog,
    );
    expect(first).toMatchObject({ rows: [{ rowId: 'one' }], nextCursor: null });
    expect(validateDatabaseActorTenantSyncSnapshotPageResult(value, expected, catalog))
      .toEqual(first);

    for (const invalid of [
      { ...value, nextCursor: 1 },
      { ...value, rows: [{ ...value.rows[0], ordinal: 1 }] },
      { ...value, rows: [{ ...value.rows[0], rowId: 'other' }] },
      { ...value, rows: [{ ...value.rows[0], row: {
        id: 'one', title: 'One', secret: true,
      } }] },
      { ...value, privatePath: '/private/database.sqlite' },
    ]) expectProtocolError(() => validateDatabaseActorTenantSyncSnapshotPageResult(
      invalid,
      expected,
      catalog,
    ));
  });

  test('rejects extensions, duplicate tables, malformed tokens, and unknown tables', () => {
    for (const invalid of [
      { databaseRef, generation: 4, ownerToken, tables: ['todos'], extra: true },
      { databaseRef, generation: 0, ownerToken, tables: ['todos'] },
      { databaseRef, generation: 4, ownerToken: 'caller-token', tables: ['todos'] },
      { databaseRef, generation: 4, ownerToken, tables: ['todos', 'todos'] },
    ]) expectPayloadError(() => validateDatabaseActorTenantSyncSnapshotBeginPayload(
      invalid,
      catalog,
    ));
    try {
      validateDatabaseActorTenantSyncSnapshotBeginPayload({
        databaseRef,
        generation: 4,
        ownerToken,
        tables: ['unknown'],
      }, catalog);
      throw new Error('Expected unsupported table.');
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).code).toBe('DATABASE_OPERATION_UNSUPPORTED');
    }
  });
});

function expectPayloadError(run: () => unknown): void {
  try {
    run();
    throw new Error('Expected payload failure.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_PAYLOAD_INVALID');
  }
}

function expectProtocolError(run: () => unknown): void {
  try {
    run();
    throw new Error('Expected protocol failure.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_PROTOCOL_ERROR');
  }
}
