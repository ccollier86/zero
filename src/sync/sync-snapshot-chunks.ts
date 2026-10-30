/**
 * Bounded-frame snapshot writer shared by durable Sync data planes.
 *
 * The client stages these frames and applies them only after the matching end
 * frame, so UI state never observes a partially replaced table set.
 */

import type { ServerWebSocket } from 'bun';
import { sendSyncWire, waitForSyncDrain } from './sync-wire-send';
import { prepareSyncReadResult } from './sync-read-results';
import type {
  Row,
  SyncDataPlaneName,
  SyncSnapshotBeginMessage,
  SyncSnapshotChunkMessage,
  SyncSnapshotEndMessage,
  SyncSocketData,
} from './types';

/** Leaves headroom below Zero's one-MiB WebSocket transport ceiling. */
export const SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES = 900 * 1_024;

const encoder = new TextEncoder();

export interface SyncSnapshotChunkHeader {
  readonly plane?: SyncDataPlaneName;
  readonly tables: readonly string[];
  readonly seq: number;
  readonly epoch?: string;
  readonly scope?: string | null;
  readonly reset: 'preserve-pending' | 'purge';
}

/** A projected row cannot fit safely in one bounded snapshot frame. */
export class SyncSnapshotChunkLimitError extends Error {
  constructor() {
    super('A Sync snapshot row exceeds the bounded transport frame.');
    this.name = 'SyncSnapshotChunkLimitError';
  }
}

/** Stateful writer for one non-interleaved socket snapshot transfer. */
export class SyncSnapshotChunkWriter {
  readonly snapshotId = crypto.randomUUID();
  readonly #socket: ServerWebSocket<SyncSocketData>;
  readonly #plane?: SyncDataPlaneName;
  readonly #assertCurrentAuthority?: () => void;
  readonly #header: SyncSnapshotChunkHeader;
  readonly #sentTables = new Set<string>();
  #table: string | null = null;
  #rows: Record<string, Row> = Object.create(null);
  #rowWireBytes = 0;
  #finished = false;
  #writable: boolean;

  private constructor(
    socket: ServerWebSocket<SyncSocketData>,
    header: SyncSnapshotChunkHeader,
    assertCurrentAuthority?: () => void,
  ) {
    this.#socket = socket;
    this.#header = header;
    this.#plane = header.plane;
    this.#assertCurrentAuthority = assertCurrentAuthority;
    const begin: SyncSnapshotBeginMessage = {
      type: 'sync.snapshot.begin',
      snapshotId: this.snapshotId,
      ...(header.plane ? { plane: header.plane } : {}),
      tables: [...header.tables],
      seq: header.seq,
      ...(header.epoch === undefined ? {} : { epoch: header.epoch }),
      ...(header.scope === undefined ? {} : { scope: header.scope }),
      reset: header.reset,
    };
    if (wireBytes(begin) > SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES) {
      throw new SyncSnapshotChunkLimitError();
    }
    this.#assertCurrentAuthority?.();
    this.#writable = sendSyncWire(socket, begin);
  }

  /** Start a transfer and honor backpressure on its begin frame. */
  static async start(
    socket: ServerWebSocket<SyncSocketData>,
    header: SyncSnapshotChunkHeader,
    assertCurrentAuthority?: () => void,
  ): Promise<SyncSnapshotChunkWriter> {
    const writer = new SyncSnapshotChunkWriter(
      socket,
      header,
      assertCurrentAuthority,
    );
    if (writer.writable) {
      await waitForSyncDrain(socket);
      writer.#assertCurrentAuthority?.();
    }
    return writer;
  }

  get writable(): boolean {
    return this.#writable && !this.#finished;
  }

  /** Add one canonical row, flushing before the next frame would exceed cap. */
  async add(table: string, rowId: string, row: Row): Promise<boolean> {
    if (!this.writable) return false;
    if (this.#table !== null && this.#table !== table && !(await this.#flush())) {
      return false;
    }
    this.#table = table;

    const entryBytes = jsonPropertyBytes(rowId, row);
    const candidateBytes = wireBytes(this.#chunk(table, {}))
      + this.#rowWireBytes
      + (this.#rowWireBytes > 0 ? 1 : 0)
      + entryBytes;
    const audited = Boolean(this.#socket.data.prepareReadResult);
    if ((!audited || Object.keys(this.#rows).length < 1000) && candidateBytes <= SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES - (audited ? 4096 : 0)) {
      this.#rows[rowId] = audited ? structuredClone(row) : row;
      this.#rowWireBytes += (this.#rowWireBytes > 0 ? 1 : 0) + entryBytes;
      return true;
    }
    if (Object.keys(this.#rows).length > 0 && !(await this.#flush())) return false;
    this.#table = table;
    const single: Record<string, Row> = Object.create(null);
    single[rowId] = audited ? structuredClone(row) : row;
    if (wireBytes(this.#chunk(table, {})) + entryBytes
      > SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES - (audited ? 4096 : 0)) {
      throw new SyncSnapshotChunkLimitError();
    }
    this.#rows = single;
    this.#rowWireBytes = entryBytes;
    return true;
  }

  /** Flush the last fragment and atomically complete client staging. */
  async finish(): Promise<boolean> {
    if (!this.writable || !(await this.#flush())) return false;
    if (this.#socket.data.prepareReadResult) for (const table of this.#header.tables) {
      if (this.#sentTables.has(table)) continue;
      this.#table = table;
      if (!(await this.#flush(true))) return false;
    }
    const end: SyncSnapshotEndMessage = {
      type: 'sync.snapshot.end',
      snapshotId: this.snapshotId,
      ...(this.#plane ? { plane: this.#plane } : {}),
    };
    this.#finished = true;
    this.#assertCurrentAuthority?.();
    this.#writable = sendSyncWire(this.#socket, end);
    if (this.#writable) {
      await waitForSyncDrain(this.#socket);
      this.#assertCurrentAuthority?.();
    }
    return this.#writable;
  }

  #chunk(
    table: string,
    rows: Record<string, Row>,
  ): SyncSnapshotChunkMessage {
    return {
      type: 'sync.snapshot.chunk',
      snapshotId: this.snapshotId,
      ...(this.#plane ? { plane: this.#plane } : {}),
      table,
      rows,
    };
  }

  async #flush(empty = false): Promise<boolean> {
    if (!this.writable || this.#table === null
      || !empty && Object.keys(this.#rows).length === 0) return this.writable;
    const chunk = this.#chunk(this.#table, this.#rows);
    this.#rows = Object.create(null);
    this.#rowWireBytes = 0;
    return this.#sendChunk(chunk);
  }

  async #sendChunk(chunk: SyncSnapshotChunkMessage): Promise<boolean> {
    this.#assertCurrentAuthority?.();
    let receipt;
    try { receipt = this.#socket.data.prepareReadResult ? await prepareSyncReadResult(this.#socket, chunk.table, Object.values(chunk.rows), this.#header.seq, this.#header.epoch ?? 'legacy') : undefined; }
    catch (error) {
      const entries = Object.entries(chunk.rows);
      // Only a definite pre-admission size rejection is splittable. Never
      // replay/split an unknown writer outcome or ordinary capacity failure.
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'LOGGING_RESULT_LIMIT') || entries.length < 2) throw error;
      const middle = Math.ceil(entries.length / 2);
      for (const rows of [entries.slice(0, middle), entries.slice(middle)]) {
        if (!(await this.#sendChunk({ ...chunk, rows: Object.fromEntries(rows) }))) return false;
      }
      return this.#writable;
    }
    if (receipt) chunk.auditReceipt = receipt;
    else if (!Object.keys(chunk.rows).length) return this.#writable;
    this.#assertCurrentAuthority?.();
    if (wireBytes(chunk) > SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES) throw new SyncSnapshotChunkLimitError();
    this.#writable = sendSyncWire(this.#socket, chunk);
    if (this.#writable) this.#sentTables.add(chunk.table);
    if (this.#writable) {
      await waitForSyncDrain(this.#socket);
      this.#assertCurrentAuthority?.();
    }
    return this.#writable;
  }
}

function wireBytes(value: object): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function jsonPropertyBytes(key: string, value: Row): number {
  return encoder.encode(`${JSON.stringify(key)}:${JSON.stringify(value)}`).byteLength;
}
