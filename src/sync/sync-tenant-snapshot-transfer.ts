/**
 * Bounded snapshot transfer for the actor-backed tenant Sync plane.
 *
 * This module owns snapshot-session validation, page budgets, row projection,
 * chunked wire delivery, and mandatory session cleanup. Socket subscription
 * ordering and binding ownership remain with SyncTenantSocketBridge.
 */

import type { ServerWebSocket } from 'bun';
import {
  SyncSnapshotChunkWriter,
} from './sync-snapshot-chunks';
import { SyncTenantSnapshotBudget } from './sync-tenant-snapshot-budget';
import { sendSyncWire, waitForSyncDrain } from './sync-wire-send';
import type {
  SyncTenantDataPlaneBinding,
  SyncTenantDataPlaneSnapshotSession,
  SyncTenantDataPlaneTable,
} from './sync-tenant-data-plane-contract';
import type {
  Row,
  SyncSnapshotMessage,
  SyncSocketData,
} from './types';

interface TenantSnapshotTransferOptions {
  readonly socket: ServerWebSocket<SyncSocketData>;
  readonly binding: SyncTenantDataPlaneBinding;
  readonly selected: readonly string[];
  readonly reset: NonNullable<SyncSnapshotMessage['reset']>;
  readonly catalog: Readonly<Record<string, SyncTenantDataPlaneTable>>;
  readonly isCurrent: () => boolean;
  readonly assertCurrent: () => void;
  readonly acceptIdentity: (snapshot: SyncTenantDataPlaneSnapshotSession) => void;
  readonly acceptCursor: (sequence: number) => void;
  readonly onCleanupFailure: () => void;
}

const encoder = new TextEncoder();

/** Transfer one exact actor snapshot and always release its server session. */
export async function sendTenantSnapshot(
  options: TenantSnapshotTransferOptions,
): Promise<boolean> {
  const budget = new SyncTenantSnapshotBudget();
  const snapshot = await options.binding.beginSnapshot(options.selected);
  let hasPrimaryFailure = false;
  try {
    budget.assertWithinDeadline();
    if (!options.isCurrent()) return false;
    options.assertCurrent();
    validateSnapshotSession(snapshot, options.binding.databaseRef, options.selected);
    options.acceptIdentity(snapshot);
    if (options.selected.length === 0) {
      const message: SyncSnapshotMessage = {
        type: 'sync.snapshot',
        plane: 'tenant',
        tables: {},
        seq: snapshot.sequence.seq,
        epoch: snapshot.syncEpoch,
        scope: options.socket.data.authorizationScope,
        reset: options.reset,
      };
      if (!sendSyncWire(options.socket, message)) return false;
      await waitForSyncDrain(options.socket);
      options.assertCurrent();
      options.acceptCursor(snapshot.sequence.seq);
      return true;
    }

    const writer = await SyncSnapshotChunkWriter.start(options.socket, {
      plane: 'tenant',
      tables: options.selected,
      seq: snapshot.sequence.seq,
      epoch: snapshot.syncEpoch,
      scope: options.socket.data.authorizationScope,
      reset: options.reset,
    }, () => {
      budget.assertWithinDeadline();
      options.assertCurrent();
    });
    let cursor = 0;
    while (true) {
      budget.beginPageRequest();
      const page = await snapshot.page(cursor);
      budget.assertWithinDeadline();
      if (!options.isCurrent()) return false;
      options.assertCurrent();
      validateSnapshotPage(page, snapshot, cursor, options.catalog);
      budget.observePage(page.rows.map((entry) => entry.row));
      for (const entry of page.rows) {
        const table = options.selected[entry.tableIndex];
        const definition = table === undefined ? undefined : options.catalog[table];
        if (!table || !definition) throw terminalSnapshotError();
        const row = entry.row as Row;
        const id = row[definition.primaryKey];
        if (!validRowIdentity(id) || String(id) !== entry.rowId) {
          throw terminalSnapshotError();
        }
        const filter = options.socket.data.resourceRowFilters.get(table);
        const projector = options.socket.data.resourceRowProjectors?.get(table);
        if (filter && !filter.matches(row)) continue;
        const projected = projector?.project(row) ?? row;
        budget.observeProjectedRow(projected);
        if (!(await writer.add(table, String(id), projected))) return false;
      }
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    if (!(await writer.finish())) return false;
    options.assertCurrent();
    options.acceptCursor(snapshot.sequence.seq);
    return true;
  } catch (error) {
    hasPrimaryFailure = true;
    throw error;
  } finally {
    try {
      await snapshot.abort();
    } catch {
      options.onCleanupFailure();
      if (!hasPrimaryFailure) throw snapshotCleanupError();
    }
  }
}

function validateSnapshotSession(
  session: SyncTenantDataPlaneSnapshotSession,
  databaseRef: string,
  selected: readonly string[],
): void {
  if (!plainRecord(session)
    || session.databaseRef !== databaseRef
    || !Number.isSafeInteger(session.generation)
    || session.generation < 1
    || typeof session.syncEpoch !== 'string'
    || !Number.isSafeInteger(session.sequence?.seq)
    || session.sequence.seq < 0
    || !Array.isArray(session.tables)
    || session.tables.length !== selected.length
    || session.tables.some((table, index) => table !== selected[index])
    || !Number.isSafeInteger(session.totalRows)
    || session.totalRows < 0
    || session.totalRows > 50_000
    || (selected.length === 0 && session.totalRows !== 0)
    || !Number.isSafeInteger(session.totalSourceBytes)
    || session.totalSourceBytes < 0
    || session.totalSourceBytes > 67_108_864
    || !Number.isSafeInteger(session.expiresAt)
    || session.expiresAt < 0
    || session.aborted !== false
    || typeof session.page !== 'function'
    || typeof session.abort !== 'function') {
    throw terminalSnapshotError();
  }
}

function validateSnapshotPage(
  page: Awaited<ReturnType<SyncTenantDataPlaneSnapshotSession['page']>>,
  session: SyncTenantDataPlaneSnapshotSession,
  cursor: number,
  catalog: Readonly<Record<string, SyncTenantDataPlaneTable>>,
): void {
  if (!plainRecord(page)
    || page.cursor !== cursor
    || !Array.isArray(page.rows)
    || page.rows.length > 100
    || (page.nextCursor !== null
      && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor < 0))) {
    throw terminalSnapshotError();
  }
  let ordinal = cursor;
  let bytes = 0;
  let nodes = 4;
  for (const entry of page.rows) {
    if (!plainRecord(entry)
      || Object.keys(entry).length !== 4
      || entry.ordinal !== ordinal
      || !Number.isSafeInteger(entry.tableIndex)
      || entry.tableIndex < 0
      || entry.tableIndex >= session.tables.length
      || typeof entry.rowId !== 'string'
      || !plainRecord(entry.row)) throw terminalSnapshotError();
    const table = session.tables[entry.tableIndex];
    const definition = table === undefined ? undefined : catalog[table];
    if (!definition
      || Object.keys(entry.row).length !== definition.columns.length
      || Object.keys(entry.row).some((field) => !definition.columns.includes(field))
      || !validRowIdentity(entry.row[definition.primaryKey])
      || String(entry.row[definition.primaryKey]) !== entry.rowId) {
      throw terminalSnapshotError();
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(entry.row);
    } catch {
      throw terminalSnapshotError();
    }
    const rowBytes = encoder.encode(serialized).byteLength;
    if (rowBytes > 1_048_576) throw terminalSnapshotError();
    bytes += rowBytes;
    nodes += countValueNodes(entry.row) + 5;
    if (bytes > 4_194_304 || nodes > 18_000) throw terminalSnapshotError();
    ordinal += 1;
  }
  const expectedNext = ordinal === session.totalRows ? null : ordinal;
  if (cursor > session.totalRows
    || ordinal > session.totalRows
    || page.nextCursor !== expectedNext
    || (page.rows.length === 0 && cursor !== session.totalRows)) {
    throw terminalSnapshotError();
  }
}

function countValueNodes(value: unknown): number {
  let count = 0;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    count += 1;
    if (Array.isArray(current)) pending.push(...current);
    else if (plainRecord(current)) pending.push(...Object.values(current));
  }
  return count;
}

function validRowIdentity(value: unknown): boolean {
  return (typeof value === 'string' && value.length > 0)
    || (typeof value === 'number' && Number.isSafeInteger(value));
}

function plainRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function terminalSnapshotError(): Error & { code: string } {
  return Object.assign(
    new Error('Tenant Sync snapshot does not satisfy its transport contract'),
    { code: 'SYNC_TENANT_SNAPSHOT_INVALID' },
  );
}

function snapshotCleanupError(): Error & { code: string } {
  return Object.assign(
    new Error('Tenant Sync snapshot cleanup failed'),
    { code: 'SYNC_TENANT_SNAPSHOT_CLEANUP_FAILED' },
  );
}
