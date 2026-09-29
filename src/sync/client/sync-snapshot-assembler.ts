/** Assemble bounded snapshot frames before one atomic store replacement. */

import type {
  ClientTableDef,
  Row,
  SyncDataPlaneName,
  SyncSnapshotBeginMessage,
  SyncSnapshotChunkMessage,
  SyncSnapshotEndMessage,
  SyncSnapshotMessage,
} from '../types';
import {
  messageSyncDataPlane,
  syncDataPlaneForTable,
} from './sync-data-planes';

const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SNAPSHOT_MAX_ROWS = 50_000;
const SNAPSHOT_MAX_ROW_BYTES = 67_108_864;
const SNAPSHOT_MAX_CHUNKS = 512;
const encoder = new TextEncoder();

interface PendingSnapshot {
  readonly snapshotId: string;
  readonly plane: SyncDataPlaneName;
  readonly tables: Record<string, Record<string, Row>>;
  readonly selected: ReadonlySet<string>;
  readonly seq: number;
  readonly epoch?: string;
  readonly scope?: string | null;
  readonly reset: 'preserve-pending' | 'purge';
  rowCount: number;
  rowBytes: number;
  chunkCount: number;
}

export type SyncSnapshotAssemblyResult =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'complete'; message: SyncSnapshotMessage }>;

export class SyncSnapshotAssembler {
  #pending: PendingSnapshot | null = null;

  constructor(
    private readonly definitions: Readonly<Record<string, ClientTableDef>>,
    private readonly tablePlanes: Readonly<Record<string, SyncDataPlaneName>>,
  ) {}

  reset(): void {
    this.#pending = null;
  }

  accept(
    message:
      | SyncSnapshotBeginMessage
      | SyncSnapshotChunkMessage
      | SyncSnapshotEndMessage,
  ): SyncSnapshotAssemblyResult {
    switch (message.type) {
      case 'sync.snapshot.begin':
        return this.#begin(message);
      case 'sync.snapshot.chunk':
        return this.#chunk(message);
      case 'sync.snapshot.end':
        return this.#end(message);
    }
  }

  #begin(message: SyncSnapshotBeginMessage): SyncSnapshotAssemblyResult {
    const plane = messageSyncDataPlane(message);
    if (plane === null
      || !validSnapshotId(message.snapshotId)
      || !Number.isSafeInteger(message.seq)
      || message.seq < 0
      || (message.epoch !== undefined && typeof message.epoch !== 'string')
      || (message.scope !== undefined && message.scope !== null
        && typeof message.scope !== 'string')
      || (message.reset !== 'preserve-pending' && message.reset !== 'purge')
      || !Array.isArray(message.tables)) return invalid(this);

    const selected = new Set<string>();
    const tables: Record<string, Record<string, Row>> = Object.create(null);
    for (const table of message.tables) {
      if (typeof table !== 'string'
        || selected.has(table)
        || !Object.hasOwn(this.definitions, table)
        || syncDataPlaneForTable(this.tablePlanes, table) !== plane) {
        return invalid(this);
      }
      selected.add(table);
      tables[table] = Object.create(null);
    }
    this.#pending = {
      snapshotId: message.snapshotId,
      plane,
      tables,
      selected,
      seq: message.seq,
      ...(message.epoch === undefined ? {} : { epoch: message.epoch }),
      ...(message.scope === undefined ? {} : { scope: message.scope }),
      reset: message.reset,
      rowCount: 0,
      rowBytes: 0,
      chunkCount: 0,
    };
    return { status: 'pending' };
  }

  #chunk(message: SyncSnapshotChunkMessage): SyncSnapshotAssemblyResult {
    const pending = this.#pending;
    const plane = messageSyncDataPlane(message);
    if (!pending
      || plane !== pending.plane
      || message.snapshotId !== pending.snapshotId
      || !pending.selected.has(message.table)
      || !plainRecord(message.rows)) return invalid(this);

    const target = pending.tables[message.table]!;
    const primaryKey = this.definitions[message.table]?._pk;
    if (!primaryKey) return invalid(this);
    const entries = Object.entries(message.rows);
    const boundedTenantTransfer = pending.plane === 'tenant';
    if (entries.length === 0
      || (boundedTenantTransfer && (
        pending.chunkCount >= SNAPSHOT_MAX_CHUNKS
        || entries.length > SNAPSHOT_MAX_ROWS - pending.rowCount
      ))) {
      return invalid(this);
    }
    let addedBytes = 0;
    for (const [rowId, value] of entries) {
      if (Object.hasOwn(target, rowId)
        || !plainRecord(value)
        || !validRowIdentity(value[primaryKey], rowId)) return invalid(this);
      if (boundedTenantTransfer) {
        let serialized: string;
        try {
          serialized = JSON.stringify(value);
        } catch {
          return invalid(this);
        }
        addedBytes += encoder.encode(serialized).byteLength;
        if (addedBytes > SNAPSHOT_MAX_ROW_BYTES - pending.rowBytes) {
          return invalid(this);
        }
      }
      target[rowId] = value;
    }
    if (boundedTenantTransfer) {
      pending.rowCount += entries.length;
      pending.rowBytes += addedBytes;
      pending.chunkCount += 1;
    }
    return { status: 'pending' };
  }

  #end(message: SyncSnapshotEndMessage): SyncSnapshotAssemblyResult {
    const pending = this.#pending;
    const plane = messageSyncDataPlane(message);
    if (!pending
      || plane !== pending.plane
      || message.snapshotId !== pending.snapshotId) return invalid(this);
    this.#pending = null;
    return {
      status: 'complete',
      message: {
        type: 'sync.snapshot',
        ...(pending.plane === 'default' ? {} : { plane: pending.plane }),
        tables: pending.tables,
        seq: pending.seq,
        ...(pending.epoch === undefined ? {} : { epoch: pending.epoch }),
        ...(pending.scope === undefined ? {} : { scope: pending.scope }),
        reset: pending.reset,
      },
    };
  }
}

function invalid(assembler: SyncSnapshotAssembler): SyncSnapshotAssemblyResult {
  assembler.reset();
  return { status: 'invalid' };
}

function validSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && SNAPSHOT_ID_PATTERN.test(value);
}

function validRowIdentity(value: unknown, rowId: string): boolean {
  return (typeof value === 'string'
    || (typeof value === 'number' && Number.isSafeInteger(value)))
    && String(value) === rowId;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
