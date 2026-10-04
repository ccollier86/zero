// ─── Client Store ──────────────────────────────────────────────────────────
export {
  createSyncStore,
  createTableSlice,
  createSlice,
  routeServerMessage,
} from './sync-store';
export type { SyncStoreContext, SyncMeta, Slice } from './sync-store';

// ─── Client Connection ────────────────────────────────────────────────────
export { createSyncClient } from './sync-client';
export type { SyncClient } from './sync-client';
export type { SyncMutationRejection } from '../types';
export {
  SYNC_MUTATION_ERROR_CODES,
  SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS,
  SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS,
  SyncMutationError,
  isSyncMutationError,
} from './sync-mutation-receipts';
export type {
  SyncMutationErrorCode,
  SyncMutationErrorDetails,
  SyncMutationWaitOptions,
} from './sync-mutation-receipts';

// ─── React Hooks (Sync) ──────────────────────────────────────────────────
export {
  SyncProvider,
  useSyncClient,
  useTable,
  useRow,
  useQuery,
  useSyncStatus,
} from './hooks';
export type {
  SyncProviderProps,
  UseTableResult,
  UseRowResult,
  SyncStatus,
  SyncContextValue,
} from './hooks';

// ─── State Sync (Client) ─────────────────────────────────────────────────
export { createStateStore, routeStateMessage } from './state-store';
export type { StateStore, StateStoreContext } from './state-store';
export { StateClient } from './state-client';

// ─── React Hooks (State) ─────────────────────────────────────────────────
export { useServerState, useServerStateReady } from './state-hooks';

// ─── Ephemeral KV (Client) ──────────────────────────────────────────────
export { createEphemeralStore, routeEphemeralMessage } from './ephemeral-store';
export type { EphemeralStore, EphemeralStoreContext, EphemeralEntryClient } from './ephemeral-store';
export { EphemeralClient } from './ephemeral-client';
export type { EphemeralChangeEvent, EphemeralErrorListener } from './ephemeral-client';
export type { EphemeralErrorMessage } from '../ephemeral-policy';

// ─── React Hooks (Ephemeral) ────────────────────────────────────────────
export {
  useEphemeral,
  useEphemeralErrors,
  useEphemeralTopic,
} from './ephemeral-hooks';
