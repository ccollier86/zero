/** Shared framework-owned table catalogs used while composing a Zero app. */

import { IDENTITY_PROJECTION_TARGET_TABLES } from '../../auth/identity-projection-schema';
import { NOTIFICATION_TABLES } from '../../notifications/types';
import { ROOM_TABLES } from '../../rooms/types';
import { STORAGE_TABLES } from '../../storage/types';
import type { ClientTableDef } from '../../sync/types';
import {
  WORKFLOW_SERVER_TABLE_NAMES,
  WORKFLOW_TABLES,
} from '../../workflows/types';

export const PLATFORM_SYNC_WRITE_PROTECTED_TABLES = new Set([
  ...IDENTITY_PROJECTION_TARGET_TABLES,
  ...Object.keys(NOTIFICATION_TABLES),
  ...Object.keys(ROOM_TABLES),
  ...WORKFLOW_SERVER_TABLE_NAMES,
  ...Object.keys(STORAGE_TABLES),
]);

export const PLATFORM_CLIENT_TABLES = {
  ...NOTIFICATION_TABLES,
  ...ROOM_TABLES,
  ...WORKFLOW_TABLES,
  ...STORAGE_TABLES,
};

const WORKFLOW_CLIENT_TABLE_NAMES = new Set(Object.keys(WORKFLOW_TABLES));

/** Resolve the client-visible system-plane catalog for enabled platform services. */
export function resolvePlatformClientTables(
  workflowsEnabled = true,
): Readonly<Record<string, ClientTableDef>> {
  if (workflowsEnabled) return PLATFORM_CLIENT_TABLES;
  return Object.fromEntries(
    Object.entries(PLATFORM_CLIENT_TABLES).filter(
      ([table]) => !WORKFLOW_CLIENT_TABLE_NAMES.has(table),
    ),
  );
}

/** Include framework-owned full-sync tables in the websocket snapshot allow-list. */
export function addPlatformSnapshotTables(
  snapshotTables: Set<string>,
  workflowsEnabled = true,
): void {
  for (const [table, definition] of Object.entries(
    resolvePlatformClientTables(workflowsEnabled),
  )) {
    if (definition._sync !== 'lazy') snapshotTables.add(table);
  }
}

/**
 * Generic lazy reads cannot enforce parent-derived workflow ownership. Keep
 * every reserved workflow table on its dedicated authorized transport, even
 * when an older application still declares a table with the same name while
 * workflows are disabled.
 */
export function resolveGenericDataQueryableTables(
  lazyTables: ReadonlySet<string>,
): Set<string> {
  const queryable = new Set(lazyTables);
  for (const table of WORKFLOW_SERVER_TABLE_NAMES) queryable.delete(table);
  return queryable;
}
