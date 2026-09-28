/**
 * sync-snapshot-response.ts
 *
 * Builds authoritative, row-filtered table snapshots for the Sync protocol.
 */

import type { ServerWebSocket } from 'bun';
import { filterSyncRows } from './row-filter';
import type { ReactiveDB } from './reactive-db';
import { sendSyncWire } from './sync-wire-send';
import type {
  Row,
  SyncSnapshotMessage,
  SyncSocketData,
} from './types';

/** Send a cache-replacement snapshot and advance the socket cursor on success. */
export function sendSyncSnapshot(
  socket: ServerWebSocket<SyncSocketData>,
  tables: readonly string[],
  db: ReactiveDB,
  reset: NonNullable<SyncSnapshotMessage['reset']>,
): void {
  const snapshot = db.readAtCurrentSequence(() => {
    const tableData: Record<string, Record<string, Row>> = {};
    for (const table of tables) {
      const filter = socket.data.resourceRowFilters.get(table);
      const projector = socket.data.resourceRowProjectors?.get(table);
      const keyed: Record<string, Row> = {};
      for (const row of filterSyncRows(db.query(table), filter, projector)) {
        keyed[String(row[db.getPrimaryKey(table)])] = row;
      }
      tableData[table] = keyed;
    }
    return tableData;
  });
  const message: SyncSnapshotMessage = {
    type: 'sync.snapshot',
    tables: snapshot.value,
    seq: snapshot.seq,
    epoch: db.syncEpoch,
    scope: socket.data.authorizationScope,
    reset,
  };
  if (sendSyncWire(socket, message)) socket.data.lastSeq = snapshot.seq;
}
