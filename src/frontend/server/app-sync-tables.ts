import { NOTIFICATION_TABLES } from '../../notifications/types';
import { ROOM_TABLES } from '../../rooms/types';
import {
  WORKFLOW_SERVER_TABLE_NAMES,
  WORKFLOW_TABLES,
} from '../../workflows/types';
import { STORAGE_TABLES } from '../../storage/types';

/** Framework-owned tables that clients must never mutate through generic Sync writes. */
export const PLATFORM_SYNC_WRITE_PROTECTED_TABLES = new Set([
  'users',
  ...Object.keys(NOTIFICATION_TABLES),
  ...Object.keys(ROOM_TABLES),
  ...WORKFLOW_SERVER_TABLE_NAMES,
  ...Object.keys(STORAGE_TABLES),
]);

const PLATFORM_CLIENT_TABLES = {
  ...NOTIFICATION_TABLES,
  ...ROOM_TABLES,
  ...WORKFLOW_TABLES,
  ...STORAGE_TABLES,
};
const WORKFLOW_CLIENT_TABLE_NAMES = new Set(Object.keys(WORKFLOW_TABLES));

/** Include enabled framework-owned full-sync tables in the snapshot allow-list. */
export function addPlatformSnapshotTables(
  snapshotTables: Set<string>,
  workflowsEnabled: boolean,
): void {
  for (const [table, definition] of Object.entries(PLATFORM_CLIENT_TABLES)) {
    if (!workflowsEnabled && WORKFLOW_CLIENT_TABLE_NAMES.has(table)) continue;
    if (definition._sync !== 'lazy') snapshotTables.add(table);
  }
}
