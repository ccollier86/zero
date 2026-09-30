/**
 * In-process read-only Sync projection for Zero-owned system tables.
 *
 * The ordinary Sync runtime remains bound to the application ReactiveDB. This
 * bridge gives each socket an independent cursor over system.db while reusing
 * the proven snapshot, catch-up, filtering, and backpressure implementation.
 * Its socket facade owns only stream-local cursor state; authentication and
 * row-policy state continue to resolve from the real socket.
 */

import type { ServerWebSocket } from 'bun';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { deliverSyncChange } from './sync-change-delivery';
import type { ReactiveDB } from './reactive-db';
import { handleSyncSubscribe } from './sync-subscribe-handler';
import type {
  Change,
  SyncAckMessage,
  SyncSocketData,
  SyncSubscribeMessage,
} from './types';
import {
  clearSyncBackpressure,
  rejectSyncDrain,
  sendSyncWire,
} from './sync-wire-send';

export interface SyncSystemSocketBridgeOptions {
  readonly socket: ServerWebSocket<SyncSocketData>;
  readonly db: ReactiveDB;
  readonly tables: Iterable<string>;
  readonly snapshotTables?: Set<string>;
  readonly observability?: PlatformObservabilityRuntime | null;
  readonly assertCurrentAuthority?: () => void;
}

/** One socket-local system-plane cursor and subscription. */
export class SyncSystemSocketBridge {
  readonly #socket: ServerWebSocket<SyncSocketData>;
  readonly #planeSocket: ServerWebSocket<SyncSocketData>;
  readonly #db: ReactiveDB;
  readonly #tables: ReadonlySet<string>;
  readonly #snapshotTables?: Set<string>;
  readonly #observability?: PlatformObservabilityRuntime | null;
  readonly #assertCurrentAuthority: () => void;
  #disposed = false;

  constructor(options: SyncSystemSocketBridgeOptions) {
    this.#socket = options.socket;
    this.#db = options.db;
    this.#tables = new Set(options.tables);
    this.#snapshotTables = options.snapshotTables;
    this.#observability = options.observability;
    this.#assertCurrentAuthority = options.assertCurrentAuthority
      ?? (() => undefined);
    this.#planeSocket = createSystemPlaneSocket(options.socket);
  }

  ownsTable(table: unknown): table is string {
    return typeof table === 'string' && this.#tables.has(table);
  }

  ownsAnyTable(tables: unknown): boolean {
    return Array.isArray(tables) && tables.some((table) => this.ownsTable(table));
  }

  async subscribe(message: SyncSubscribeMessage): Promise<void> {
    this.#assertUsable();
    await handleSyncSubscribe(
      this.#planeSocket,
      message,
      this.#db,
      this.#snapshotTables,
      this.#observability,
      this.#assertCurrentAuthority,
    );
  }

  clearSubscription(): void {
    if (this.#disposed) return;
    this.#planeSocket.data.syncSubscribedTables.clear();
    this.#planeSocket.data.rowFilteredSubscribedTables.clear();
    this.#planeSocket.data.syncDeferredChanges = [];
  }

  deliver(
    change: Change,
    origin: string,
    validateCurrentAuthority: () => boolean,
  ): void {
    if (this.#disposed || !this.ownsTable(change.table)) return;
    deliverSyncChange(
      [this.#planeSocket],
      change,
      this.#db.syncEpoch,
      origin,
      () => validateCurrentAuthority(),
    );
  }

  rejectMutation(ref: unknown): void {
    if (this.#disposed || typeof ref !== 'string') return;
    const response: SyncAckMessage = {
      type: 'sync.ack',
      plane: 'system',
      ref,
      seq: null,
      ok: false,
      error: 'Framework system tables are read-only over Sync.',
    };
    sendSyncWire(this.#socket, response);
  }

  resume(): void {
    if (!this.#disposed) clearSyncBackpressure(this.#planeSocket);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    rejectSyncDrain(this.#planeSocket);
    this.#planeSocket.data.syncSubscribedTables.clear();
    this.#planeSocket.data.rowFilteredSubscribedTables.clear();
    this.#planeSocket.data.syncDeferredChanges = [];
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error('System Sync plane is closed.');
    this.#assertCurrentAuthority();
  }
}

function createSystemPlaneSocket(
  socket: ServerWebSocket<SyncSocketData>,
): ServerWebSocket<SyncSocketData> {
  const data = Object.create(socket.data) as SyncSocketData;
  data.lastSeq = 0;
  data.syncSubscribedTables = new Set();
  data.rowFilteredSubscribedTables = new Set();
  data.syncBackpressured = false;
  data.syncSnapshotInFlight = false;
  data.syncDeferredChanges = [];
  data.syncMultiplexed = false;

  return new Proxy(socket, {
    get(target, property, receiver) {
      if (property === 'data') return data;
      if (property === 'send') {
        return (payload: unknown, ...args: unknown[]) => Reflect.apply(
          target.send,
          target,
          [withSystemPlane(payload), ...args],
        );
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ServerWebSocket<SyncSocketData>;
}

function withSystemPlane(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (typeof parsed.type !== 'string' || !parsed.type.startsWith('sync.')) {
      return payload;
    }
    return JSON.stringify({ ...parsed, plane: 'system' });
  } catch {
    return payload;
  }
}
