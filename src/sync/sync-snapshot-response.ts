/**
 * sync-snapshot-response.ts
 *
 * Builds authoritative, row-filtered table snapshots for the Sync protocol.
 */

import type { ServerWebSocket } from 'bun';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { filterSyncRows } from './row-filter';
import { flushDeferredSyncChanges } from './sync-change-delivery';
import type { ReactiveDB } from './reactive-db';
import { sendSyncWire, waitForSyncDrain } from './sync-wire-send';
import {
  SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES,
  SyncSnapshotChunkLimitError,
  SyncSnapshotChunkWriter,
} from './sync-snapshot-chunks';
import type {
  Row,
  SyncSnapshotMessage,
  SyncSocketData,
} from './types';
import { SYNC_TERMINAL_DATA_CLOSE_CODE } from './types';

const encoder = new TextEncoder();
const snapshotTransfers = new WeakMap<
  ServerWebSocket<SyncSocketData>,
  Promise<void>
>();

/** Send a cache-replacement snapshot and advance the socket cursor on success. */
export function sendSyncSnapshot(
  socket: ServerWebSocket<SyncSocketData>,
  tables: readonly string[],
  db: ReactiveDB,
  reset: NonNullable<SyncSnapshotMessage['reset']>,
  observability?: PlatformObservabilityRuntime | null,
  assertCurrentAuthority: () => void = () => undefined,
): Promise<void> {
  const previous = snapshotTransfers.get(socket) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => sendSyncSnapshotAsync(
    socket,
    tables,
    db,
    reset,
    observability,
    assertCurrentAuthority,
  ));
  snapshotTransfers.set(socket, task);
  void task.finally(() => {
    if (snapshotTransfers.get(socket) === task) snapshotTransfers.delete(socket);
  }).catch(() => undefined);
  return task;
}

async function sendSyncSnapshotAsync(
  socket: ServerWebSocket<SyncSocketData>,
  tables: readonly string[],
  db: ReactiveDB,
  reset: NonNullable<SyncSnapshotMessage['reset']>,
  observability?: PlatformObservabilityRuntime | null,
  assertCurrentAuthority: () => void = () => undefined,
): Promise<void> {
  socket.data.syncSnapshotInFlight = true;
  socket.data.syncDeferredChanges ??= [];
  let completed = false;
  try {
    assertCurrentAuthority();
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
      ...(socket.data.syncMultiplexed ? { plane: 'default' as const } : {}),
      tables: snapshot.value,
      seq: snapshot.seq,
      epoch: db.syncEpoch,
      scope: socket.data.authorizationScope,
      reset,
    };
    if (encoder.encode(JSON.stringify(message)).byteLength
      <= SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES) {
      assertCurrentAuthority();
      if (sendSyncWire(socket, message)) {
        socket.data.lastSeq = snapshot.seq;
        await waitForSyncDrain(socket);
        assertCurrentAuthority();
        completed = await flushDeferredSyncChanges(
          socket,
          assertCurrentAuthority,
        );
      }
      return;
    }

    try {
      const writer = await SyncSnapshotChunkWriter.start(socket, {
        ...(socket.data.syncMultiplexed ? { plane: 'default' as const } : {}),
        tables,
        seq: snapshot.seq,
        epoch: db.syncEpoch,
        scope: socket.data.authorizationScope,
        reset,
      }, assertCurrentAuthority);
      for (const table of tables) {
        const rows = snapshot.value[table] ?? {};
        for (const [rowId, row] of Object.entries(rows)) {
          if (!(await writer.add(table, rowId, row))) return;
        }
      }
      if (await writer.finish()) {
        socket.data.lastSeq = snapshot.seq;
        assertCurrentAuthority();
        completed = await flushDeferredSyncChanges(
          socket,
          assertCurrentAuthority,
        );
      }
    } catch (error) {
      if (!(error instanceof SyncSnapshotChunkLimitError)) throw error;
      const options = { metadata: { plane: 'default-database' } };
      if (observability) {
        emitPlatformCodeTo(
          observability,
          OBS_CODES.SYNC_SNAPSHOT_TRANSPORT_REJECTED,
          options,
        );
      } else {
        emitPlatformCode(OBS_CODES.SYNC_SNAPSHOT_TRANSPORT_REJECTED, options);
      }
      socket.close(
        SYNC_TERMINAL_DATA_CLOSE_CODE,
        'Sync snapshot row cannot fit the transport contract',
      );
    }
  } finally {
    if (!completed) socket.data.syncDeferredChanges = [];
    socket.data.syncSnapshotInFlight = false;
  }
}
