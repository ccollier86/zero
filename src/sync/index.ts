// ─── Server: ReactiveDB ────────────────────────────────────────────────────
export { ReactiveDB, createReactiveDB } from './reactive-db';
export { registerReactiveDBMutationInterceptor } from './reactive-db-mutation-interceptor';
export type {
  ExternalChangePollingOptions,
  ReactiveDBRowScope,
} from './reactive-db';
export type {
  ReactiveDBMutationChange,
  ReactiveDBMutationInterception,
  ReactiveDBMutationInterceptor,
  ReactiveDBReadOnlyRow,
  ReactiveDBReadOnlyValue,
} from './reactive-db-mutation-interceptor';
export type { ReactiveDBTransactionToken } from './reactive-db-transaction-token';
export { SYNC_TABLE_MUTATION_VALIDATOR } from './types';
export type {
  ReactiveDBConfig,
  ReactiveDBPlatformCodeEmitter,
  TableSchema,
  Row,
  SyncMode,
  DeclaredSyncMode,
  Change,
  ChangeOp,
  ChangeDeliveryMetadata,
  ChangeListener,
  SyncMutationValidationIssue,
  SyncResourceMutationScope,
  SyncRowValidationResult,
  SyncTableMutationValidator,
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
export type {
  SyncAuthConfig,
  SyncAuthContext,
  SyncPluginConfig,
  SyncSocketData,
  SyncTokenVerifier,
} from './types';
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
export { SYNC_ACK_ERROR_CODES } from './types';
export type {
  SyncDataPlaneName,
  SyncSnapshotMessage,
  SyncSnapshotBeginMessage,
  SyncSnapshotChunkMessage,
  SyncSnapshotEndMessage,
  SyncChangeMessage,
  SyncAckMessage,
  SyncAckErrorCode,
  SyncMutationRejection,
  SyncCatchupMessage,
  SyncAuthMessage,
  SyncAuthReadyMessage,
  SyncSubscribeMessage,
  SyncMutateMessage,
  ClientMessage,
  ServerMessage,
  PendingMutation,
  ClientTableDef,
  SyncClientConfig,
  SyncAuthLifecycleBinder,
  SyncClientLifecycleTarget,
} from './types';

// ─── Server: Ephemeral KV ──────────────────────────────────────────────────
export { EphemeralStateManager } from './ephemeral-manager';
export type { EphemeralEntry } from './ephemeral-manager';
export { EphemeralChannel } from './ephemeral-channel';
export type { EphemeralChannelOptions } from './ephemeral-channel';
export {
  allowLegacyEphemeralTopicPolicy,
  denyEphemeralTopicPolicy,
} from './ephemeral-policy';
export type {
  EphemeralErrorCode,
  EphemeralErrorMessage,
  EphemeralKeyOwnership,
  EphemeralTopicAllowedDecision,
  EphemeralTopicDecision,
  EphemeralTopicDeniedDecision,
  EphemeralTopicOperation,
  EphemeralTopicPolicy,
  EphemeralTopicPolicyContext,
  EphemeralWireOperation,
} from './ephemeral-policy';
export {
  createManagedEphemeralTopicPolicy,
} from './ephemeral-managed-policy';
export type {
  EphemeralRoomMembershipService,
  ManagedEphemeralTopicPolicyOptions,
} from './ephemeral-managed-policy';
export { EPHEMERAL_LIMITS } from './ephemeral-validation';
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
