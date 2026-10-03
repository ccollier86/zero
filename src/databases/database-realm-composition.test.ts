import { describe, expect, test } from 'bun:test';

import type { Migration } from '../migrations/types';
import { defineTable, field, getGuardianTableReferences } from '../schema';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type SyncTableMutationValidator,
  type TableSchema,
} from '../sync/types';
import { DatabaseError } from './database-error';
import { composeDatabaseRealm } from './database-realm-composition';
import {
  databaseRealmContribution,
  defineDatabaseRealmContribution,
} from './database-realm-contribution';
import { defineDatabaseRealm } from './database-realm';

const coreMigration: Migration = {
  version: '010_core',
  description: 'install core records',
  up(database) {
    database.run('CREATE TABLE core_marker (id TEXT PRIMARY KEY)');
  },
};

const pluginMigration: Migration = {
  version: '020_plugin',
  description: 'install plugin records',
  up(database) {
    database.run('CREATE TABLE plugin_marker (id TEXT PRIMARY KEY)');
  },
};

function table(primaryKey = 'id'): TableSchema {
  return { [primaryKey]: 'text primary key' };
}

function expectConfigCollision(
  operation: () => unknown,
  fragments: readonly string[],
): void {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_CONFIG_INVALID');
    for (const fragment of fragments) {
      expect((error as DatabaseError).message).toContain(fragment);
    }
  }
}

function configCollisionMessage(operation: () => unknown): string {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_CONFIG_INVALID');
    return (error as DatabaseError).message;
  }
}

describe('database realm composition', () => {
  test('merges contributions into one canonical immutable realm', () => {
    const pluginQuery = () => ({ count: 0 });
    const coreCommand = () => ({ changed: false });
    const realm = composeDatabaseRealm({
      name: 'composed-realm',
      version: '1',
      contributions: [{
        name: 'plugin',
        version: '1',
        tables: { z_plugin_records: table() },
        migrations: [pluginMigration],
        queries: { 'plugin.count': pluginQuery },
      }, {
        name: 'core',
        version: '1',
        tables: { a_core_records: table() },
        migrations: [coreMigration],
        commands: { 'core.noop': coreCommand },
      }],
    });

    expect(Object.keys(realm.tables)).toEqual([
      'a_core_records',
      'z_plugin_records',
    ]);
    expect(realm.migrations.map((migration) => migration.version)).toEqual([
      '010_core',
      '020_plugin',
    ]);
    expect(Object.keys(realm.queries)).toEqual(['plugin.count']);
    expect(Object.keys(realm.commands)).toEqual(['core.noop']);
    expect(realm.queries['plugin.count']).toBe(pluginQuery);
    expect(realm.commands['core.noop']).toBe(coreCommand);
    expect(Object.isFrozen(realm)).toBe(true);
    expect(Object.isFrozen(realm.tables)).toBe(true);
    expect(Object.isFrozen(realm.migrations)).toBe(true);
  });

  test('produces the same fingerprint regardless of contribution order', () => {
    const core = {
      name: 'core',
      version: '1',
      tables: { core_records: table() },
      migrations: [coreMigration],
      queries: { 'core.read': () => null },
    };
    const plugin = {
      name: 'plugin',
      version: '1',
      tables: { plugin_records: table() },
      migrations: [pluginMigration],
      commands: { 'plugin.write': () => null },
    };
    const first = composeDatabaseRealm({
      name: 'order-independent',
      version: '1',
      contributions: [core, plugin],
    });
    const second = composeDatabaseRealm({
      name: 'order-independent',
      version: '1',
      contributions: [plugin, core],
    });

    expect(second.schemaChecksum).toBe(first.schemaChecksum);
    expect(second.migrationChecksums).toEqual(first.migrationChecksums);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(Object.keys(second.tables)).toEqual(Object.keys(first.tables));
  });

  test('orders foreign-key parents before dependants with stable lexical ties', () => {
    const parent = { id: 'text primary key' } satisfies TableSchema;
    const child = {
      id: 'text primary key',
      parent_id: 'text references z_parents(id) on delete restrict not null',
    } satisfies TableSchema;
    const first = composeDatabaseRealm({
      name: 'foreign-key-order',
      version: '1',
      contributions: [{
        name: 'children',
        version: '1',
        tables: { a_children: child },
      }, {
        name: 'parents',
        version: '1',
        tables: { z_parents: parent, m_independent: table() },
      }],
    });
    const second = composeDatabaseRealm({
      name: 'foreign-key-order',
      version: '1',
      contributions: [{
        name: 'parents',
        version: '1',
        tables: { m_independent: table(), z_parents: parent },
      }, {
        name: 'children',
        version: '1',
        tables: { a_children: child },
      }],
    });

    expect(Object.keys(first.tables)).toEqual([
      'm_independent',
      'z_parents',
      'a_children',
    ]);
    expect(Object.keys(second.tables)).toEqual(Object.keys(first.tables));
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  test('leaves external foreign-key dependencies to runtime schema verification', () => {
    const realm = composeDatabaseRealm({
      name: 'external-foreign-key-parent',
      version: '1',
      contributions: [{
        name: 'records',
        version: '1',
        tables: {
          records: {
            id: 'text primary key',
            parent_id: 'text references missing_parents(id) on delete restrict',
          },
        },
      }],
    });

    expect(Object.keys(realm.tables)).toEqual(['records']);
  });

  test('rejects cross-table foreign-key cycles while allowing self references', () => {
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'foreign-key-cycle',
      version: '1',
      contributions: [{
        name: 'cycle',
        version: '1',
        tables: {
          first: {
            id: 'text primary key',
            second_id: 'text references second(id) on delete restrict',
          },
          second: {
            id: 'text primary key',
            first_id: 'text references first(id) on delete restrict',
          },
        },
      }],
    }), ['foreign-key cycle', 'first', 'second']);

    const selfReferential = composeDatabaseRealm({
      name: 'self-reference',
      version: '1',
      contributions: [{
        name: 'tree',
        version: '1',
        tables: {
          nodes: {
            id: 'text primary key',
            parent_id: 'text references nodes(id) on delete restrict',
          },
        },
      }],
    });
    expect(Object.keys(selfReferential.tables)).toEqual(['nodes']);
  });

  test('includes the sorted contribution version manifest in the fingerprint', () => {
    const versionOne = composeDatabaseRealm({
      name: 'versioned-composition',
      version: '1',
      contributions: [{
        name: 'plugin',
        version: '1',
        queries: { 'plugin.read': () => null },
      }],
    });
    const versionTwo = composeDatabaseRealm({
      name: 'versioned-composition',
      version: '1',
      contributions: [{
        name: 'plugin',
        version: '2',
        queries: { 'plugin.read': () => null },
      }],
    });

    expect(versionTwo.schemaChecksum).toBe(versionOne.schemaChecksum);
    expect(versionTwo.migrationChecksums).toEqual(versionOne.migrationChecksums);
    expect(versionTwo.fingerprint).not.toBe(versionOne.fingerprint);
  });

  test('adapts an existing realm without rewriting its base definition', () => {
    const base = defineDatabaseRealm({
      name: 'existing-app-realm',
      version: 'previous-version',
      tables: { app_records: table() },
      migrations: [coreMigration],
      queries: { 'app.read': () => null },
    });
    const composed = composeDatabaseRealm({
      name: 'upgraded-app-realm',
      version: 'next-version',
      contributions: [databaseRealmContribution(base), {
        name: 'plugin',
        version: '1',
        tables: { plugin_records: table() },
        migrations: [pluginMigration],
      }],
    });

    expect(Object.keys(composed.tables)).toEqual(['app_records', 'plugin_records']);
    expect(Object.keys(composed.queries)).toEqual(['app.read']);
    expect(composed.migrations.map((migration) => migration.version)).toEqual([
      '010_core',
      '020_plugin',
    ]);

    expectConfigCollision(() => composeDatabaseRealm({
      name: 'upgraded-app-realm',
      version: 'next-version',
      contributions: [databaseRealmContribution(base), {
        name: 'plugin',
        version: '1',
        tables: { app_records: table() },
      }],
    }), ['table', 'app_records', 'existing-app-realm', 'plugin']);
  });

  test('includes an adapted base realm version in the fingerprint', () => {
    const baseDefinition = {
      name: 'versioned-base',
      tables: { app_records: table() },
      queries: { 'app.read': () => null },
    };
    const first = composeDatabaseRealm({
      name: 'adapted-version-composition',
      version: '1',
      contributions: [databaseRealmContribution(defineDatabaseRealm({
        ...baseDefinition,
        version: '1',
      }))],
    });
    const second = composeDatabaseRealm({
      name: 'adapted-version-composition',
      version: '1',
      contributions: [databaseRealmContribution(defineDatabaseRealm({
        ...baseDefinition,
        version: '2',
      }))],
    });

    expect(second.schemaChecksum).toBe(first.schemaChecksum);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  test('preserves Guardian reference metadata and its fingerprint semantics', () => {
    const records = defineTable('guardian_records', {
      owner_user_id: field.guardianUser(),
      owner_membership_id: field.guardianMembership(),
    }, { pk: 'record_id' });
    const direct = defineDatabaseRealm({
      name: 'guardian-composed',
      version: '1',
      tables: { guardian_records: records.serverTable },
    });
    const composed = composeDatabaseRealm({
      name: 'guardian-composed',
      version: '1',
      contributions: [{
        name: 'guardian-plugin',
        version: '1',
        tables: { guardian_records: records.serverTable },
      }],
    });

    expect(getGuardianTableReferences(composed.tables.guardian_records!)).toEqual([
      expect.objectContaining({ field: 'owner_user_id', kind: 'user' }),
      expect.objectContaining({ field: 'owner_membership_id', kind: 'membership' }),
    ]);
    expect(composed.guardianAnchorRequirements).toEqual(['user', 'membership']);
    const descriptor = Object.getOwnPropertyDescriptor(
      composed.tables.guardian_records!,
      Symbol.for('@zero/schema/guardian-table-references'),
    );
    expect(descriptor).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
    });
    expect(composed.schemaChecksum).toBe(direct.schemaChecksum);
    expect(composed.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('preserves logical table mutation validator metadata', () => {
    const validator: SyncTableMutationValidator = {
      primaryKey: 'id',
      fieldNames: ['title'],
      decodeRow: (row) => ({ ...row }),
      encodeRow: (row) => ({ ...row }),
      validateRow: (row) => ({ success: true, output: row }),
    };
    const schema: TableSchema = {
      id: 'text primary key',
      title: 'text not null',
      [SYNC_TABLE_MUTATION_VALIDATOR]: validator,
    };
    const composed = composeDatabaseRealm({
      name: 'validator-composition',
      version: '1',
      contributions: [{
        name: 'validated-plugin',
        version: '1',
        tables: { records: schema },
      }],
    });
    const preserved = composed.tables.records?.[SYNC_TABLE_MUTATION_VALIDATOR];

    expect(preserved).not.toBe(validator);
    expect(preserved?.primaryKey).toBe('id');
    expect(preserved?.fieldNames).toEqual(['title']);
    expect(preserved?.decodeRow).toBe(validator.decodeRow);
    expect(Object.isFrozen(preserved)).toBe(true);
    expect(Object.isFrozen(preserved?.fieldNames)).toBe(true);
  });

  test('detaches reusable contribution definitions from later mutation', () => {
    const sourceTables: Record<string, TableSchema> = {
      records: {
        id: 'text primary key',
        title: 'text not null',
      },
    };
    const sourceMigrations = [{ ...coreMigration }];
    const contribution = defineDatabaseRealmContribution({
      name: 'detached',
      version: '1',
      tables: sourceTables,
      migrations: sourceMigrations,
    });

    sourceTables.records!.title = 'integer not null';
    sourceMigrations[0]!.description = 'mutated';

    expect(contribution.tables.records?.title).toBe('text not null');
    expect(contribution.migrations[0]?.description).toBe('install core records');
    expect(Object.isFrozen(contribution)).toBe(true);
    expect(Object.isFrozen(contribution.tables.records)).toBe(true);
  });

  test('preserves complete migration metadata and handler references', () => {
    const up: Migration['up'] = (database) => {
      database.run('CREATE TABLE metadata_marker (id TEXT PRIMARY KEY)');
    };
    const down: NonNullable<Migration['down']> = (database) => {
      database.run('DROP TABLE metadata_marker');
    };
    const realm = composeDatabaseRealm({
      name: 'migration-metadata-composition',
      version: '1',
      contributions: [{
        name: 'migration-plugin',
        version: '1',
        migrations: [{
          version: '100_metadata',
          description: 'preserve all migration metadata',
          safety: 'guarded',
          downSafety: 'destructive',
          backupRequired: true,
          up,
          down,
        }],
      }],
    });

    expect(realm.migrations[0]).toMatchObject({
      version: '100_metadata',
      description: 'preserve all migration metadata',
      safety: 'guarded',
      downSafety: 'destructive',
      backupRequired: true,
    });
    expect(realm.migrations[0]?.up).toBe(up);
    expect(realm.migrations[0]?.down).toBe(down);
  });

  test('rejects table collisions including case-insensitive names', () => {
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'table-collision',
      version: '1',
      contributions: [{
        name: 'core',
        version: '1',
        tables: { Records: table() },
      }, {
        name: 'plugin',
        version: '1',
        tables: { records: table() },
      }],
    }), ['table', 'records', 'core', 'plugin', 'ignoring case']);
  });

  test('rejects migration, query, command, and cross-kind handler collisions', () => {
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'migration-collision',
      version: '1',
      contributions: [{ name: 'core', version: '1', migrations: [coreMigration] }, {
        name: 'plugin',
        version: '1',
        migrations: [{ ...coreMigration, description: 'different migration' }],
      }],
    }), ['migration', coreMigration.version, 'core', 'plugin']);

    expectConfigCollision(() => composeDatabaseRealm({
      name: 'query-collision',
      version: '1',
      contributions: [{ name: 'core', version: '1', queries: { 'records.read': () => null } }, {
        name: 'plugin',
        version: '1',
        queries: { 'records.read': () => [] },
      }],
    }), ['query', 'records.read', 'core', 'plugin']);

    expectConfigCollision(() => composeDatabaseRealm({
      name: 'command-collision',
      version: '1',
      contributions: [{ name: 'core', version: '1', commands: { 'records.write': () => null } }, {
        name: 'plugin',
        version: '1',
        commands: { 'records.write': () => ({ ok: true }) },
      }],
    }), ['command', 'records.write', 'core', 'plugin']);

    expectConfigCollision(() => composeDatabaseRealm({
      name: 'handler-collision',
      version: '1',
      contributions: [{ name: 'core', version: '1', queries: { 'records.shared': () => null } }, {
        name: 'plugin',
        version: '1',
        commands: { 'records.shared': () => null },
      }],
    }), ['handler', 'records.shared', 'query', 'command', 'core', 'plugin']);
  });

  test('rejects duplicate contribution identities even when registries do not overlap', () => {
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'contribution-name-collision',
      version: '1',
      contributions: [{
        name: 'plugin',
        version: '1',
        tables: { first_records: table() },
      }, {
        name: 'plugin',
        version: '2',
        tables: { second_records: table() },
      }],
    }), ['contribution name', 'plugin', 'duplicated']);
  });

  test('reports handler collisions consistently in either contribution order', () => {
    const query = {
      name: 'query-plugin',
      version: '1',
      queries: { 'records.shared': () => null },
    };
    const command = {
      name: 'command-plugin',
      version: '1',
      commands: { 'records.shared': () => null },
    };
    const forward = configCollisionMessage(() => composeDatabaseRealm({
      name: 'stable-handler-collision',
      version: '1',
      contributions: [query, command],
    }));
    const reversed = configCollisionMessage(() => composeDatabaseRealm({
      name: 'stable-handler-collision',
      version: '1',
      contributions: [command, query],
    }));

    expect(reversed).toBe(forward);
  });

  test('runs cross-contribution schema admission after merging tables', () => {
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'generated-index-collision',
      version: '1',
      contributions: [{
        name: 'core',
        version: '1',
        tables: {
          documents: {
            id: 'text primary key',
            owner_id: 'text not null',
            _identity: ['owner_id'],
          },
        },
      }, {
        name: 'plugin',
        version: '1',
        tables: { IDX_DOCUMENTS_IDENTITY: table() },
      }],
    }), ['collides with the generated identity index']);
  });

  test('rejects malformed composition and contribution objects', () => {
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'unknown-composition-field',
      version: '1',
      contributions: [],
      unexpected: true,
    } as never), ['composition', 'unknown field']);

    expectConfigCollision(() => composeDatabaseRealm({
      name: 'unknown-contribution-field',
      version: '1',
      contributions: [{ name: 'plugin', version: '1', unexpected: true } as never],
    }), ['contribution', 'unknown field']);
  });

  test('rejects accessors, proxies, symbols, and sparse contribution arrays', () => {
    let getterCalled = false;
    const accessorComposition = {
      get name() {
        getterCalled = true;
        return 'accessor-composition';
      },
      version: '1',
      contributions: [],
    };
    expectConfigCollision(
      () => composeDatabaseRealm(accessorComposition),
      ['composition', 'data properties'],
    );
    expect(getterCalled).toBe(false);

    const proxiedContribution = new Proxy({
      name: 'proxy-plugin',
      version: '1',
    }, {});
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'proxy-composition',
      version: '1',
      contributions: [proxiedContribution],
    }), ['contribution', 'plain object']);

    const symbolContribution = {
      name: 'symbol-plugin',
      version: '1',
      [Symbol('unsupported')]: true,
    };
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'symbol-composition',
      version: '1',
      contributions: [symbolContribution],
    }), ['contribution', 'symbol fields']);

    const sparse = new Array(1) as unknown as readonly [{
      name: string;
      version: string;
    }];
    expectConfigCollision(() => composeDatabaseRealm({
      name: 'sparse-composition',
      version: '1',
      contributions: sparse,
    }), ['contributions', 'dense']);
  });
});
