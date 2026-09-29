import { describe, expect, test } from 'bun:test';

import { DatabaseError } from './database-error';
import {
  createDatabaseRealmOperationCatalog,
  defineDatabaseRealm,
} from './database-realm';
import type { DatabaseRuntime } from './database-runtime';
import { assertDatabaseWriterRealmMatchesRuntime } from './database-writer-realm-validation';

const realm = defineDatabaseRealm({
  name: 'physical-realm-validation',
  version: '1',
  tables: {
    records: {
      id: 'text primary key',
      value: 'text',
    },
  },
});
const catalog = createDatabaseRealmOperationCatalog(realm);

describe('database writer physical realm validation', () => {
  test('retains hidden/generated-column defense independently of realm admission', () => {
    for (const hidden of [2, 3]) {
      expectSchemaMismatch(createRuntime([
        { name: 'id', type: 'TEXT', hidden: 0 },
        { name: 'value', type: 'TEXT', hidden },
      ]));
    }
  });

  test('retains BLOB and typeless affinity defense independently of realm admission', () => {
    for (const type of ['BLOB', '']) {
      expectSchemaMismatch(createRuntime([
        { name: 'id', type: 'TEXT', hidden: 0 },
        { name: 'value', type, hidden: 0 },
      ]));
    }
  });

  test('admits ordinary physical columns with portable affinities', () => {
    expect(() => assertDatabaseWriterRealmMatchesRuntime(
      createRuntime([
        { name: 'id', type: 'TEXT', hidden: 0 },
        { name: 'value', type: 'NUMERIC', hidden: 0 },
      ]),
      realm,
      catalog,
    )).not.toThrow();
  });
});

function expectSchemaMismatch(runtime: DatabaseRuntime): void {
  try {
    assertDatabaseWriterRealmMatchesRuntime(runtime, realm, catalog);
    throw new Error('Expected schema mismatch');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_SCHEMA_MISMATCH');
  }
}

function createRuntime(
  columns: Array<{ name: string; type: string; hidden: number }>,
): DatabaseRuntime {
  return {
    db: {
      hasTable: () => true,
      getColumns: () => ['id', 'value'],
      getPrimaryKey: () => 'id',
      prepare: () => ({
        all: () => columns,
        finalize: () => undefined,
      }),
    },
  } as unknown as DatabaseRuntime;
}
