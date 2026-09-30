/** Shared framework-owned table catalogs used while composing a Zero app. */

import { IDENTITY_PROJECTION_TARGET_TABLES } from '../../auth/identity-projection-schema';
import { NOTIFICATION_TABLES } from '../../notifications/types';
import { ROOM_TABLES } from '../../rooms/types';
import { STORAGE_TABLES } from '../../storage/types';
import { WORKFLOW_TABLES } from '../../workflows/types';

export const PLATFORM_SYNC_WRITE_PROTECTED_TABLES = new Set([
  ...IDENTITY_PROJECTION_TARGET_TABLES,
  ...Object.keys(NOTIFICATION_TABLES),
  ...Object.keys(ROOM_TABLES),
  ...Object.keys(WORKFLOW_TABLES),
  ...Object.keys(STORAGE_TABLES),
]);

export const PLATFORM_CLIENT_TABLES = {
  ...NOTIFICATION_TABLES,
  ...ROOM_TABLES,
  ...WORKFLOW_TABLES,
  ...STORAGE_TABLES,
};

/** Include framework-owned full-sync tables in the websocket snapshot allow-list. */
export function addPlatformSnapshotTables(snapshotTables: Set<string>): void {
  for (const [table, definition] of Object.entries(PLATFORM_CLIENT_TABLES)) {
    if (definition._sync !== 'lazy') snapshotTables.add(table);
  }
}
