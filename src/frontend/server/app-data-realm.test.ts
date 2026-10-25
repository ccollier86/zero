import { describe, expect, test } from 'bun:test';
import { defineDatabaseRealm } from '../../databases/database-realm';
import { resolveConfig } from './types';

const tables = { notes: { id: 'text primary key', title: 'text not null' } };
const realm = defineDatabaseRealm({ name: 'notes', version: '1', tables,
  queries: { 'notes.count': () => 0 }, commands: { 'notes.clear': () => null },
});

describe('app-data realm configuration', () => {
  test('omitted registry leaves existing configuration and nonportable legacy tables unchanged', () => {
    expect(resolveConfig({ db: { mode: 'memory' }, tables }).dataRealm).toBeUndefined();
    expect(resolveConfig({ db: { mode: 'memory' }, tables: { binary_notes: { id: 'text primary key', payload: 'blob' } } }).dataRealm).toBeUndefined();
  });
  test('admits one versioned schema-identical app registry without enabling Fabric or changing auth', () => {
    const resolved = resolveConfig({ db: { mode: 'memory' }, tables, dataRealm: realm });
    expect(resolved.dataRealm?.fingerprint).toBe(realm.fingerprint);
    expect(resolved.databaseTopology.mode).toBe('single');
    expect(Object.isFrozen(resolved.dataRealm)).toBe(true);
    expect(() => resolveConfig({ db: { mode: 'memory' }, tables: {}, dataRealm: realm })).toThrow('dataRealm contains tables not declared');
    expect(() => resolveConfig({ db: { mode: 'memory' }, tables: { notes: { id: 'text primary key' } }, dataRealm: realm })).toThrow('dataRealm table schemas must match');
    expect(() => resolveConfig({ db: { mode: 'memory' }, tables, dataRealm: { ...realm, fingerprint: 'forged' } })).toThrow('dataRealm must be created with defineDatabaseRealm');
  });
  test('keeps named Fabric registries independent but requires tenant-file registries to match', () => {
    const actorRealm = defineDatabaseRealm({ name: 'isolated', version: '1', tables });
    const databaseTopology = { mode: 'multiple' as const, rootDirectory: './data/isolated', realm: actorRealm,
      actors: { launch: { kind: 'source' as const, entrypoint: import.meta.path } } };
    expect(resolveConfig({ db: { mode: 'memory' }, tables, dataRealm: realm, databaseTopology }).dataRealm?.fingerprint).toBe(realm.fingerprint);
    expect(() => resolveConfig({ db: { mode: 'memory' }, tables, dataRealm: realm,
      auth: { tenancy: 'multi' }, databaseTopology: { ...databaseTopology, tenantIsolation: 'tenant-database' } })).toThrow('dataRealm must match');
    expect(resolveConfig({ db: { mode: 'memory' }, tables, dataRealm: actorRealm,
      auth: { tenancy: 'multi' }, databaseTopology: { ...databaseTopology, tenantIsolation: 'tenant-database' } }).dataRealm?.fingerprint).toBe(actorRealm.fingerprint);
  });
});
