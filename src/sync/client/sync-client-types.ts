import type { ClientTableDef, Row } from '../types';
import type { createSyncStore } from './sync-store';

/** Public client surface for realtime table synchronization. */
export interface SyncClient {
  /** Reactive store containing synced rows and connection metadata. */
  readonly store: ReturnType<typeof createSyncStore>['store'];
  /** Resolved table definitions passed to the client. */
  readonly tables: Record<string, ClientTableDef>;
  /** Whether the server accepted the current socket authentication. */
  readonly connected: boolean;
  /** Apply an optimistic insert and submit it to the server. */
  insert(table: string, row: Row): void;
  /** Apply an optimistic update and submit it to the server. */
  update(table: string, id: string, partial: Partial<Row>): void;
  /** Apply an optimistic delete and submit it to the server. */
  delete(table: string, id: string): void;
  /** Send or buffer an extension-protocol message. */
  sendRaw(message: object): void;
  /** Open the socket when automatic connection is disabled. */
  connect(): void;
  /** Reopen the socket without clearing local data. */
  reconnect(): void;
  /** Close the socket and purge all locally synced table data. */
  reset(): void;
  /** Observe extension-protocol messages; returns an unsubscribe function. */
  onMessage(
    handler: (message: { type: string; [key: string]: unknown }) => void,
  ): () => void;
  /** Permanently disconnect this client and release its lifecycle binding. */
  disconnect(): void;
}
