/**
 * sync-subscription-selection.ts
 *
 * Resolves requested tables against live socket authorization and server-side
 * snapshot modes. It owns subscription bookkeeping, not response generation.
 */

import type { ServerWebSocket } from 'bun';
import type { ReactiveDB } from './reactive-db';
import type { SyncSocketData, SyncSubscribeMessage } from './types';

export interface SyncSubscriptionSelection {
  subscribed: string[];
  snapshot: string[];
}

/** Resolve and install one socket's current table selection. */
export function selectSyncSubscription(
  socket: ServerWebSocket<SyncSocketData>,
  message: SyncSubscribeMessage,
  db: ReactiveDB,
  snapshotTables?: Set<string>,
): SyncSubscriptionSelection {
  const requested = message.tables.filter(
    (table): table is string => typeof table === 'string',
  );
  const subscribed = requested.filter(
    (table) => socket.data.allowedTables.has(table) && db.hasTable(table),
  );
  socket.data.syncSubscribedTables = new Set(subscribed);
  socket.data.rowFilteredSubscribedTables = new Set(
    subscribed.filter((table) => socket.data.resourceRowFilters.has(table)),
  );
  const snapshot = (message.snapshot ?? []).filter(
    (table) => subscribed.includes(table)
      && (!snapshotTables || snapshotTables.has(table)),
  );
  return { subscribed, snapshot };
}
