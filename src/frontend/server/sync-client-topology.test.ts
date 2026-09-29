import { describe, expect, test } from 'bun:test';

import type {
  RegisteredResourceDefinition,
  ResourceRegistry,
} from '../../resources';
import { resolveBrowserSyncTablePlanes } from './sync-client-topology';

describe('browser Sync table topology', () => {
  test('routes Sync resources and excludes HTTP-only/internal resources', () => {
    const resources = new Map<string, RegisteredResourceDefinition>([
      ['tenant_documents', resource('tenant_documents', 'all', 'tenant-database')],
      ['tenant_http', resource('tenant_http', 'http', 'tenant-database')],
      ['global_settings', resource('global_settings', 'sync', 'global')],
      ['internal_jobs', resource('internal_jobs', 'internal', 'global')],
    ]);
    const registry = {
      getByTable: (table: string) => resources.get(table) ?? null,
    } as Pick<ResourceRegistry, 'getByTable'>;

    expect(resolveBrowserSyncTablePlanes([
      'tenant_http',
      'legacy_table',
      'tenant_documents',
      'internal_jobs',
      'global_settings',
    ], registry)).toEqual({
      global_settings: 'default',
      legacy_table: 'default',
      tenant_documents: 'tenant',
    });
  });
});

function resource(
  table: string,
  exposure: 'internal' | 'http' | 'sync' | 'all',
  storage: 'global' | 'tenant-database',
): RegisteredResourceDefinition {
  return {
    kind: 'resource',
    name: table,
    table,
    primaryKey: 'id',
    actions: ['list', 'get', 'create', 'update', 'delete'],
    policy: {},
    exposure: {
      kind: exposure,
      http: exposure === 'http' || exposure === 'all',
      sync: exposure === 'sync' || exposure === 'all',
    },
    realm: storage === 'global'
      ? { kind: 'global' }
      : { kind: 'tenant', field: 'tenant_id' },
    storage: storage === 'global'
      ? { kind: 'global' }
      : { kind: 'tenant', isolation: 'tenant-database' },
  } as unknown as RegisteredResourceDefinition;
}
