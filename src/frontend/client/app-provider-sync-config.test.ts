import { describe, expect, test } from 'bun:test';

import { resolveProviderSyncConfig } from './app-provider-sync-config';

const tables = {
  projects: { _pk: 'id', id: 'text', name: 'text' },
  imports: { clientTable: { _pk: 'id', id: 'text', state: 'text' } },
};

describe('AppProvider Sync config projection', () => {
  test('preserves the legacy table set when no server plane catalog exists', () => {
    expect(resolveProviderSyncConfig(
      tables,
      { projects: 'lazy', imports: 'full' },
      undefined,
      undefined,
    )).toEqual({
      tables: {
        projects: { _pk: 'id', id: 'text', name: 'text', _sync: 'lazy' },
        imports: { _pk: 'id', id: 'text', state: 'text', _sync: 'full' },
      },
    });
  });

  test('keeps Sync tables and removes known HTTP-only resources', () => {
    expect(resolveProviderSyncConfig(
      tables,
      { projects: 'full', imports: 'lazy' },
      { projects: 'tenant' },
      ['projects', 'imports'],
    )).toEqual({
      tables: {
        projects: { _pk: 'id', id: 'text', name: 'text', _sync: 'full' },
      },
      tableSyncPlanes: { projects: 'tenant' },
    });
  });

  test('rejects a local table absent from the server schema', () => {
    expect(() => resolveProviderSyncConfig(
      { typo: { _pk: 'id', id: 'text' } },
      {},
      {},
      ['projects'],
    )).toThrow('AppProvider table "typo" is not declared by the running Zero server');
  });
});
