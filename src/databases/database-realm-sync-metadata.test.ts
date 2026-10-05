/** Synthetic schema admission and in-memory SQLite regressions; no app or live files. */

import { describe, expect, test } from 'bun:test';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { defineTable, field, schema } from '../schema';
import { GUARDIAN_TABLE_REFERENCES, getGuardianTableReferences } from '../schema/guardian-references';
import { DECLARED_TABLE_SYNC_MODE, getDeclaredTableSyncMode } from '../schema/table-sync-metadata';
import { resolveConfig } from '../frontend/server/types';
import { createReactiveDB } from '../sync/reactive-db';
import { SYNC_TABLE_MUTATION_VALIDATOR, type DeclaredSyncMode, type TableSchema } from '../sync/types';
import { DatabaseError } from './database-error';
import { createDatabaseRealmOperationCatalog, defineDatabaseRealm } from './database-realm';
import { composeDatabaseRealm } from './database-realm-composition';
import { databaseRealmContribution, defineDatabaseRealmContribution } from './database-realm-contribution';

const modes: readonly (DeclaredSyncMode | undefined)[] = ['full', 'lazy', 'auto', undefined];

function taskTable(mode?: DeclaredSyncMode): TableSchema {
  return defineTable('tasks', { title: field.text() }, { pk: 'id', sync: mode }).serverTable;
}

function realmFor(table: TableSchema) {
  return defineDatabaseRealm({ name: 'repro', version: '1', tables: { tasks: table } });
}

function expectConfigInvalid(operation: () => unknown): void {
  expect(operation).toThrow(DatabaseError);
  try { operation(); } catch (error) {
    expect((error as DatabaseError).code).toBe('DATABASE_CONFIG_INVALID');
  }
}

describe('Fabric framework-owned declared sync metadata', () => {
  for (const mode of modes) {
    test(`admits ${mode ?? 'omitted'} mode from both schema builders and object spreads`, () => {
      const projected = schema({ tasks: { fields: { title: field.text() }, sync: mode } }).serverTables.tasks;
      for (const table of [taskTable(mode), projected, { ...taskTable(mode) }, { ...projected }]) {
        const realm = realmFor(table);
        const admitted = realm.tables.tasks!;
        expect(getDeclaredTableSyncMode(admitted)).toBe(mode);
        expect(Object.keys(admitted)).toEqual(['id', 'title']);
        expect(JSON.parse(JSON.stringify(admitted))).toEqual({ id: 'text primary key', title: 'text' });
        expect(createDatabaseRealmOperationCatalog(realm).columns?.tasks).toEqual(['id', 'title']);
        expect(Object.isFrozen(admitted)).toBe(true);
        if (mode === undefined) {
          expect(Object.getOwnPropertyDescriptor(admitted, DECLARED_TABLE_SYNC_MODE)).toBeUndefined();
        } else {
          expect(Object.getOwnPropertyDescriptor(admitted, DECLARED_TABLE_SYNC_MODE)).toEqual({
            value: mode, enumerable: true, writable: false, configurable: false,
          });
        }
      }
    });

    test(`preserves ${mode ?? 'omitted'} through contributions, composition and config normalization`, () => {
      const source = { ...taskTable(mode) };
      const contribution = defineDatabaseRealmContribution({
        name: 'tasks-fragment', version: '1', tables: { tasks: source },
      });
      const contributionFromRealm = databaseRealmContribution(realmFor(source));
      for (const fragment of [contribution, contributionFromRealm]) {
        expect(getDeclaredTableSyncMode(fragment.tables.tasks!)).toBe(mode);
        const composed = composeDatabaseRealm({
          name: 'composed', version: '1', contributions: [fragment],
        });
        expect(getDeclaredTableSyncMode(composed.tables.tasks!)).toBe(mode);
        const resolved = resolveConfig({
          db: { mode: 'memory' }, auth: { tenancy: 'multi' },
          tables: composed.tables,
          databaseTopology: {
            mode: 'multiple', tenantIsolation: 'tenant-database',
            rootDirectory: '/Volumes/code-bank/tmp/scratch/zero-platform/sync-metadata-unused',
            realm: composed,
            actors: { launch: { kind: 'source', entrypoint: import.meta.path } },
          },
        });
        expect(resolved.declaredSyncModes.get('tasks')).toBe(mode ?? 'auto');
        expect(getDeclaredTableSyncMode(resolved.tables.tasks!)).toBe(mode);
        expect(resolved.tableColumns.get('tasks')).toEqual(['id', 'title']);
        expect(resolved.databaseTopology.mode).toBe('multiple');
      }
    });
  }

  test('keeps loading policy out of SQL checksums and existing durable realm identities', () => {
    const original = realmFor(taskTable());
    expect(original.fingerprint).toBe('sha256:a6f1f0cb05f95c3ecc5c17b7c60668e8bbc27cf5e15b2812a98a8a8aea8ba08d');
    for (const mode of modes) {
      const realm = realmFor(taskTable(mode));
      expect(realm.fingerprint).toBe(original.fingerprint);
      expect(realm.schemaChecksum).toBe(original.schemaChecksum);
      // Metadata insertion order is not SQL presentation or realm identity.
      const metadataFirst = Object.assign({}, mode === undefined ? {} : { [DECLARED_TABLE_SYNC_MODE]: mode }, taskTable(mode));
      expect(realmFor(metadataFirst).fingerprint).toBe(original.fingerprint);
      const first = composeDatabaseRealm({ name: 'joined', version: '1', contributions: [
        { name: 'tasks-fragment', version: '1', tables: { tasks: taskTable(mode) } },
        { name: 'notes-fragment', version: '1', tables: { notes: { id: 'text primary key' } } },
      ] });
      const second = composeDatabaseRealm({ name: 'joined', version: '1', contributions: [
        { name: 'notes-fragment', version: '1', tables: { notes: { id: 'text primary key' } } },
        { name: 'tasks-fragment', version: '1', tables: { tasks: { ...taskTable(mode) } } },
      ] });
      expect(second.fingerprint).toBe(first.fingerprint);
    }
  });

  test('preserves logical mutation validation and Guardian reference admission together', () => {
    const original = defineTable('tasks', {
      title: field.text({ required: true }), owner_id: field.guardianUser(),
    }, { sync: 'lazy' }).serverTable;
    const realm = realmFor(original);
    const admitted = realm.tables.tasks!;
    const validator = admitted[SYNC_TABLE_MUTATION_VALIDATOR]!;
    expect(validator).not.toBe(original[SYNC_TABLE_MUTATION_VALIDATOR]);
    expect(Object.isFrozen(validator)).toBe(true);
    expect(validator.validateRow({ owner_id: 'user-one' }).success).toBe(false);
    expect(validator.validateRow({ title: 'Valid title', owner_id: 'user-one' }).success).toBe(true);
    expect(getGuardianTableReferences(admitted)).toEqual(getGuardianTableReferences(original));
    expect(Object.getOwnPropertyDescriptor(admitted, GUARDIAN_TABLE_REFERENCES)?.enumerable).toBe(false);
    expect(getDeclaredTableSyncMode(admitted)).toBe('lazy');
    expect(realm.guardianAnchorRequirements).toEqual(['user']);

    original.owner_id = 'text';
    expectConfigInvalid(() => realmFor(original));
    const invalidValidator = { ...taskTable('full'), [SYNC_TABLE_MUTATION_VALIDATOR]: {
      ...taskTable()[SYNC_TABLE_MUTATION_VALIDATOR]!, primaryKey: 'not_the_primary_key',
    } };
    expectConfigInvalid(() => realmFor(invalidValidator));
  });

  test('rejects invalid modes and non-enumerable metadata rather than silently inheriting defaults', () => {
    for (const value of [undefined, null, true, 1, 'FULL', 'snapshot', {}, ['lazy']]) {
      const malformed = { id: 'text primary key', title: 'text' };
      Object.defineProperty(malformed, DECLARED_TABLE_SYNC_MODE, { value, enumerable: true });
      expectConfigInvalid(() => realmFor(malformed));
      expectConfigInvalid(() => resolveConfig({ db: { mode: 'memory' }, tables: { tasks: malformed } }));
      expectConfigInvalid(() => resolveConfig({
        db: { mode: 'memory' }, tables: { tasks: malformed },
        syncDefaults: { defaultMode: 'full', tables: { tasks: 'lazy' } },
      }));
    }
    const hidden = { id: 'text primary key', title: 'text' };
    Object.defineProperty(hidden, DECLARED_TABLE_SYNC_MODE, { value: 'full', enumerable: false });
    expectConfigInvalid(() => realmFor(hidden));
    expectConfigInvalid(() => resolveConfig({ db: { mode: 'memory' }, tables: { tasks: hidden } }));
  });

  test('rejects unknown symbols, identity lookalikes and accessors without invoking getters', () => {
    for (const key of [
      DECLARED_TABLE_SYNC_MODE, GUARDIAN_TABLE_REFERENCES, SYNC_TABLE_MUTATION_VALIDATOR,
      Symbol('unknown'), Symbol('@zero/framework/schema-declared-sync-mode'),
    ]) {
      const accessor = { id: 'text primary key', title: 'text' };
      let calls = 0;
      Object.defineProperty(accessor, key, { enumerable: true, get() { calls += 1; return 'full'; } });
      expectConfigInvalid(() => realmFor(accessor));
      expectConfigInvalid(() => composeDatabaseRealm({
        name: 'invalid', version: '1', contributions: [{ name: 'fragment', version: '1', tables: { tasks: accessor } }],
      }));
      if (key === DECLARED_TABLE_SYNC_MODE) {
        expectConfigInvalid(() => resolveConfig({ db: { mode: 'memory' }, tables: { tasks: accessor } }));
      }
      expect(calls).toBe(0);
    }
    let columnGetterCalls = 0;
    const columnAccessor = Object.defineProperty({ id: 'text primary key' }, 'title', {
      enumerable: true, get() { columnGetterCalls += 1; return 'text'; },
    });
    expectConfigInvalid(() => realmFor(columnAccessor));
    expect(columnGetterCalls).toBe(0);
    for (const key of [Symbol('unknown'), Symbol('@zero/framework/schema-declared-sync-mode')]) {
      const unknown = { ...taskTable('full'), [key]: 'lazy' };
      expectConfigInvalid(() => realmFor(unknown));
    }
    const wrapped = defineTable('tasks', { title: field.text() }, { sync: 'full' });
    const malformedServerTable = Object.defineProperty({ id: 'text primary key', title: 'text' }, DECLARED_TABLE_SYNC_MODE, {
      enumerable: true, get() { throw new Error('Getter must not execute'); },
    });
    expectConfigInvalid(() => resolveConfig({
      db: { mode: 'memory' }, tables: { tasks: { ...wrapped, serverTable: malformedServerTable } },
    }));
  });

  test('never creates SQL metadata columns or schema drift when loading mode changes', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.defineTable('tasks', realmFor(taskTable('full')).tables.tasks!);
      db.insert('tasks', { id: 'task-one', title: 'Task one' });
      expect(db.getColumns('tasks')).toEqual(['id', 'title']);
      const actual = inspectDatabaseSchema(db.getRawDatabase(), { includeInternal: false });
      expect(Object.keys(actual.tables.tasks!.columns)).toEqual(['id', 'title']);
      for (const mode of modes) {
        const realm = realmFor(taskTable(mode));
        expect(diffSchemaSnapshots(snapshotDeclaredTables(realm.tables), actual)).toEqual([]);
      }
      expect(db.get('tasks', 'task-one')).toEqual({ id: 'task-one', title: 'Task one' });
    } finally { db.dispose(); }
  });
});
