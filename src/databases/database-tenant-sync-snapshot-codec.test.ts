import { describe, expect, test } from 'bun:test';

import { DatabaseError } from './database-error';
import {
  encodeDatabaseTenantSyncSourceRow,
  validateDatabaseTenantSyncStoredPageRow,
} from './database-tenant-sync-snapshot-codec';
import { normalizeDatabaseTenantSyncSnapshotLimits } from './database-tenant-sync-snapshot-limits';

const limits = normalizeDatabaseTenantSyncSnapshotLimits(undefined);

describe('database tenant Sync snapshot row codec', () => {
  test('rejects fractional, unsafe, and non-serializable source row identities', () => {
    for (const id of [1.5, Number.MAX_SAFE_INTEGER + 1, 1n]) {
      expectSchemaMismatch(() => encodeDatabaseTenantSyncSourceRow(
        { id, title: 'invalid' },
        ['id', 'title'],
        'id',
        limits,
      ));
    }
  });

  test('rejects non-canonical identities read from retained snapshot storage', () => {
    for (const rowId of [1.5, Number.MAX_SAFE_INTEGER + 1, 1n, null]) {
      expectSchemaMismatch(() => validateDatabaseTenantSyncStoredPageRow({
        ordinal: 0,
        table_index: 0,
        row_id: rowId,
        row_json: '{"id":"valid","title":"row"}',
        source_bytes: 28,
        node_count: 3,
      }, 0));
    }
  });
});

function expectSchemaMismatch(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_SCHEMA_MISMATCH');
    return;
  }
  throw new Error('Expected snapshot row identity to fail closed.');
}
