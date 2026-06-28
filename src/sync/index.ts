// ─── Server: ReactiveDB ────────────────────────────────────────────────────
export { ReactiveDB, createReactiveDB } from './reactive-db';
export type {
  ReactiveDBConfig,
  TableSchema,
  Row,
  SyncMode,
  DeclaredSyncMode,
  Change,
  ChangeOp,
  ChangeListener,
} from './types';

// ─── Natural Identity ─────────────────────────────────────────────────────
export {
  assertIdentityFields,
  createIdentityId,
  ensureRowSyncPrimaryKey,
  getIdentityValues,
  hasIdentity,
  withIdentityPrimaryKey,
} from './identity';
export type { IdentityKey, IdentityValue } from './identity';

// ─── Server: Sync Plugin ──────────────────────────────────────────────────
export { createSyncPlugin, getSyncDB, getEphemeralManager } from './sync.plugin';
export type { SyncPluginConfig, SyncSocketData } from './types';
export {
  allowAllSyncPolicy,
  combineSyncPolicies,
  createDefaultSyncPolicy,
  evaluateSyncMutationPolicy,
  evaluateSyncReadPolicy,
  getReadableSyncTables,
} from './sync-policy';
export type {
  DefaultSyncPolicyConfig,
  SyncMutationPolicyContext,
  SyncPolicy,
  SyncPolicyDecision,
  SyncPolicyEvaluation,
  SyncReadPolicyContext,
} from './sync-policy';

// ─── Server: Message Handler ──────────────────────────────────────────────
export { routeMessage, currentMutationOrigin } from './message-handler';

// ─── Server: State Sync ──────────────────────────────────────────────────
export { StateManager } from './state-manager';
export {
  handleStateSubscribe,
  handleStateSet,
  handleStateDelete,
  handleStateClear,
} from './state-handler';

// ─── Wire Protocol Types ──────────────────────────────────────────────────
export type {
  SyncSnapshotMessage,
  SyncChangeMessage,
  SyncAckMessage,
  SyncCatchupMessage,
  SyncSubscribeMessage,
  SyncMutateMessage,
  ClientMessage,
  ServerMessage,
  PendingMutation,
  ClientTableDef,
  SyncClientConfig,
} from './types';

// ─── Server: Ephemeral KV ──────────────────────────────────────────────────
export { EphemeralStateManager } from './ephemeral-manager';
export type { EphemeralEntry } from './ephemeral-manager';
export {
  handleEphemeralSubscribe,
  handleEphemeralUnsubscribe,
  handleEphemeralSet,
  handleEphemeralDelete,
  cleanupEphemeralForSocket,
} from './ephemeral-handler';

// ─── Ephemeral Wire Protocol Types ──────────────────────────────────────
export type {
  EphemeralSubscribeMessage,
  EphemeralUnsubscribeMessage,
  EphemeralSetMessage,
  EphemeralDeleteMessage,
  EphemeralSnapshotMessage,
  EphemeralChangeMessage,
} from './types';

// ─── State Sync Types ────────────────────────────────────────────────────
export type {
  JsonValue,
  StateChangeEvent,
  StateErrorCode,
  StateSubscribeMessage,
  StateSetMessage,
  StateDeleteMessage,
  StateClearMessage,
  StateSnapshotMessage,
  StateAckMessage,
  StateChangeMessage,
  PendingStateOp,
} from './types';
export { STATE_LIMITS } from './types';
