/** Narrow managed presence adapter on the existing Sync socket and ephemeral lifecycle. */
import type { EphemeralStateManager } from './ephemeral-manager';
import type { SyncAuthContext } from './types';

export interface SyncPresenceTransport {
  attach(manager: EphemeralStateManager): () => void;
  handle(message: Record<string, unknown>, auth: SyncAuthContext | null, connectionId: string, assertCurrent: () => void): void;
  release(connectionId: string): void;
}
