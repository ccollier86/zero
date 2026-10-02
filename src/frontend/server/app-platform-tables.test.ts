import { describe, expect, test } from 'bun:test';

import {
  WORKFLOW_SERVER_TABLE_NAMES,
  WORKFLOW_TABLES,
} from '../../workflows/types';
import {
  addPlatformSnapshotTables,
  resolveGenericDataQueryableTables,
  resolvePlatformClientTables,
} from './app-platform-tables';
import { PLATFORM_SYNC_PRIVATE_TABLES } from './platform-sync-policy';

describe('platform system-plane client table catalog', () => {
  test('omits workflow system-plane and snapshot tables when workflows are disabled', () => {
    const tables = resolvePlatformClientTables(false);
    const snapshotTables = new Set<string>();
    addPlatformSnapshotTables(snapshotTables, false);

    for (const table of Object.keys(WORKFLOW_TABLES)) {
      expect(tables).not.toHaveProperty(table);
      expect(snapshotTables.has(table)).toBeFalse();
    }
    expect(tables).toHaveProperty('notifications');
    expect(tables).toHaveProperty('rooms');
    expect(tables).toHaveProperty('storage_objects');
  });

  test('includes workflow system-plane and snapshot tables when workflows are enabled', () => {
    const tables = resolvePlatformClientTables(true);
    const snapshotTables = new Set<string>();
    addPlatformSnapshotTables(snapshotTables, true);

    for (const table of Object.keys(WORKFLOW_TABLES)) {
      expect(tables).toHaveProperty(table);
      expect(snapshotTables.has(table)).toBeTrue();
    }
  });

  test('marks every non-client workflow table private at the generic Sync boundary', () => {
    for (const table of WORKFLOW_SERVER_TABLE_NAMES) {
      expect(PLATFORM_SYNC_PRIVATE_TABLES.has(table))
        .toBe(!Object.hasOwn(WORKFLOW_TABLES, table));
    }
  });

  test('reserves historical workflow names from generic lazy reads in every mode', () => {
    const lazyTables = new Set(['documents', ...WORKFLOW_SERVER_TABLE_NAMES]);
    const queryable = resolveGenericDataQueryableTables(lazyTables);

    expect(queryable).toEqual(new Set(['documents']));
    expect(lazyTables.has('workflow_instances')).toBeTrue();
  });
});
