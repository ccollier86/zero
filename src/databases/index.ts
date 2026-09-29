export {
  DATABASE_ERROR_CODES,
  DATABASE_CAPACITY_TYPES,
  DATABASE_ERROR_DETAILS_MAX_ENTRIES,
  DATABASE_ERROR_DETAIL_KEY_MAX_LENGTH,
  DATABASE_ERROR_DETAIL_STRING_MAX_LENGTH,
  DATABASE_ERROR_ENVELOPE_KIND,
  DATABASE_ERROR_ENVELOPE_VERSION,
  DATABASE_ERROR_MESSAGE_MAX_LENGTH,
  DatabaseError,
  deserializeDatabaseError,
  isDatabaseErrorCode,
  isSerializedDatabaseError,
  normalizeDatabaseError,
  serializeDatabaseError,
} from './database-error';

export type {
  DatabaseErrorCode,
  DatabaseCapacityType,
  DatabaseErrorDetails,
  DatabaseErrorDetailValue,
  DatabaseErrorOptions,
  DatabaseOperationOutcome,
  SerializedDatabaseError,
} from './database-error';

export { classifyDatabaseHttpFailure } from './database-http-error';
export type {
  DatabaseHttpCapacityType,
  DatabaseHttpConflictType,
  DatabaseHttpFailureClassification,
  DatabaseHttpFailureKind,
  DatabaseHttpOperationKind,
} from './database-http-error';

export {
  DATABASE_COORDINATOR_MAX_DATABASES,
  DATABASE_EXECUTOR_SLOT_MAX,
  DATABASE_OBSERVABILITY_COUNT_MAX,
} from './database-capacity';

export {
  DATABASE_ID_MAX_BYTES,
  DatabasePathError,
  createDatabaseRef,
  encodeDatabaseFileName,
  normalizeDatabaseId,
  normalizeDatabaseRef,
  prepareDatabaseFile,
  resolveDatabaseFile,
} from './database-file';

export {
  createNamedDatabaseRef,
  createTenantDatabaseRef,
} from './database-binding-ref';

export type {
  DatabaseId,
  DatabaseRef,
  DatabasePathErrorCode,
  PreparedDatabaseFile,
  ResolvedDatabaseFile,
} from './database-file';

export {
  DATABASE_FILE_PLACEMENT_POLICY,
  DATABASE_HOT_DEFAULT_DURABILITY,
  DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS,
  DATABASE_HOT_MIN_SNAPSHOT_TIMEOUT_MS,
  DATABASE_HOT_SHORTHAND_MAX_BYTES,
  DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY,
  defaultDatabaseHotSnapshotTimeoutMs,
  isDatabaseHotDurability,
  isDatabasePlacement,
} from './database-placement';
export type {
  DatabaseHotDurability,
  DatabaseHotPlacementConfig,
  DatabasePlacement,
  DatabasePlacementPolicy,
  DatabasePlacementSelector,
  DatabasePlacementSelectorContext,
} from './database-placement';

export { DatabaseManager } from './database-manager';
export type {
  BindTenantDatabaseOptions,
  DatabaseManagerDiagnostics,
  DatabaseManagerOptions,
  DatabaseManagerState,
  MultipleDatabaseManagerOptions,
  TenantDatabaseBinding,
  TenantDatabaseSyncBinding,
} from './database-manager';

export { AuthorityCommitCoordinator } from './authority-commit-coordinator';
export type {
  AuthorityCommitAcquireOptions,
  AuthorityCommitCoordinatorDiagnostics,
  AuthorityCommitCoordinatorOptions,
  AuthorityCommitCoordinatorState,
  AuthorityCommitLease,
  AuthorityCommitLeaseMode,
} from './authority-commit-coordinator';

export {
  registerDatabaseAuthorityCommitGuard,
} from './database-authority-commit-guard';

export { DatabaseCoordinator } from './database-coordinator';
export type {
  DatabaseAcquireOptions,
  DatabaseCoordinatorDiagnostics,
  DatabaseCoordinatorEntryDiagnostics,
  DatabaseCoordinatorEntryState,
  DatabaseCoordinatorLease,
  DatabaseCoordinatorOptions,
  DatabaseCoordinatorRestartPolicy,
  DatabaseCoordinatorState,
  DatabaseExecutionOptions,
  DatabaseExecutorFactory,
  DatabaseExecutorFactoryContext,
  DatabaseTenantSyncAcquireOptions,
} from './database-coordinator';
export {
  normalizeDatabaseCoordinatorRestartPolicy,
} from './database-restart-policy';
export type {
  NormalizedDatabaseCoordinatorRestartPolicy,
} from './database-restart-policy';

export {
  DATABASE_TENANT_SYNC_MAX_SNAPSHOT_TABLES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
} from './database-tenant-sync-snapshot-protocol';

export type {
  DatabaseLogicalReceiptFingerprint,
  DatabaseTrustedReceiptExecutionOptions,
  DatabaseTrustedReceiptLookup,
  DatabaseTrustedWriteExecutionOptions,
  DatabaseTrustedWriteExecutor,
} from './database-trusted-writer';
export type {
  DatabaseTenantSyncBinding,
  DatabaseTenantSyncChangesWakeup,
  DatabaseTenantSyncExecutionOptions,
  DatabaseTenantSyncReplayResult,
  DatabaseTenantSyncResetWakeup,
  DatabaseTenantSyncSnapshotPage,
  DatabaseTenantSyncSnapshotSession,
  DatabaseTenantSyncUnavailableWakeup,
  DatabaseTenantSyncWakeup,
  DatabaseTenantSyncWakeupListener,
} from './database-tenant-sync';

export {
  DATABASE_REALM_FINGERPRINT_VERSION,
  createDatabaseRealmOperationCatalog,
  defineDatabaseRealm,
} from './database-realm';
export type {
  DatabaseReadQueryContext,
  DatabaseReadQueryHandler,
  DatabaseReadQueryRegistry,
  DatabaseRealm,
  DatabaseRealmDefinition,
  DatabaseRealmMigrationChecksum,
  DatabaseWriteCommandContext,
  DatabaseWriteCommandHandler,
  DatabaseWriteCommandRegistry,
} from './database-realm';

export { createAsyncDatabaseClient } from './database-client';
export type { CreateAsyncDatabaseClientOptions } from './database-client';
export type {
  AsyncDatabaseClient,
  AsyncDatabaseOperationExecutor,
  DatabaseAssertion,
  DatabaseBatchInput,
  DatabaseCommitResult,
  DatabaseFindFieldFilter,
  DatabaseFindFilter,
  DatabaseFindFilterGroup,
  DatabaseFindFilterOperator,
  DatabaseFindInput,
  DatabaseFindOrder,
  DatabaseFindRows,
  DatabaseListPage,
  DatabaseListPageOptions,
  DatabaseMutation,
  DatabaseMutationOptions,
  DatabaseOperation,
  DatabaseOperationExecutionOptions,
  DatabaseOperationRow,
  DatabaseReadConsistency,
  DatabaseReadOptions,
  DatabaseReadResult,
  DatabaseSequenceToken,
  DatabaseSerializableValue,
} from './database-operations';

export {
  runDatabaseActorIfRequested,
  runDatabaseActorSubprocess,
} from './database-actor-bootstrap';
export type {
  RunDatabaseActorIfRequestedOptions,
  RunDatabaseActorSubprocessOptions,
  RunningDatabaseActorSubprocess,
} from './database-actor-bootstrap';

export {
  DATABASE_ACTOR_CHILD_FLAG,
  normalizeDatabaseActorFlag,
  parseDatabaseActorInvocation,
} from './database-actor-entry-contract';
export type { DatabaseActorInvocation } from './database-actor-entry-contract';

export { normalizeDatabaseActorSQLiteConfig } from './database-actor-protocol';
export type {
  DatabaseActorRole,
  DatabaseActorSQLiteConfig,
} from './database-actor-protocol';

export {
  buildDatabaseActorCommand,
  createSubprocessDatabaseExecutorFactory,
} from './subprocess-database-executor-factory';
export type {
  BuildDatabaseActorCommandOptions,
  DatabaseActorBundleLaunch,
  DatabaseActorCommandPrefixLaunch,
  DatabaseActorExecutorFactoryContext,
  DatabaseActorExecutorPolicy,
  DatabaseActorLaunch,
  DatabaseActorSourceLaunch,
  SubprocessDatabaseExecutorFactory,
  SubprocessDatabaseExecutorFactoryOptions,
} from './subprocess-database-executor-factory';

export {
  DatabaseObservability,
  createDatabaseObservability,
  emitDatabaseObservabilityEvent,
} from './database-observability';
export type {
  DatabaseObservabilityEvent,
  DatabaseObservabilityEventType,
  DatabaseObservabilityMetadata,
} from './database-observability';

export { DatabaseRuntime } from './database-runtime';
export type {
  DatabaseReactiveConfig,
  DatabaseRuntimeDiagnostics,
  DatabaseRuntimeOptions,
  DatabaseRuntimeRole,
} from './database-runtime';

export {
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
} from './database-writer-engine';

export type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorEvent,
  DatabaseExecutorEventListener,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorOperationKind,
  DatabaseExecutorRequest,
  DatabaseExecutorState,
  DatabaseExecutorValue,
} from './database-executor';

export {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  SubprocessDatabaseExecutor,
} from './subprocess-database-executor';

export type {
  DatabaseExecutorFailureMessage,
  DatabaseExecutorHandshakeMessage,
  DatabaseExecutorOperationMessage,
  DatabaseExecutorReadyMessage,
  DatabaseExecutorShutdownAckMessage,
  DatabaseExecutorShutdownMessage,
  DatabaseExecutorSuccessMessage,
  DatabaseExecutorTelemetryMessage,
  SubprocessDatabaseExecutorCommand,
  SubprocessDatabaseExecutorEvent,
  SubprocessDatabaseExecutorOptions,
} from './subprocess-database-executor';

export {
  DATABASE_EXECUTOR_OPERATION_MAX_LENGTH,
  DATABASE_EXECUTOR_ROLE_MAX_LENGTH,
  DATABASE_EXECUTOR_VALUE_MAX_ARRAY_LENGTH,
  DATABASE_EXECUTOR_VALUE_MAX_BINARY_BYTES,
  DATABASE_EXECUTOR_VALUE_MAX_BYTES,
  DATABASE_EXECUTOR_VALUE_MAX_DEPTH,
  DATABASE_EXECUTOR_VALUE_MAX_NODES,
  DATABASE_EXECUTOR_VALUE_MAX_OBJECT_PROPERTIES,
  DATABASE_EXECUTOR_VALUE_MAX_STRING_BYTES,
  isDatabaseExecutorOperationName,
  isDatabaseExecutorRole,
  isDatabaseExecutorValue,
} from './database-executor-validation';

export { SubprocessDatabaseServer } from './subprocess-database-server';
export type {
  DatabaseExecutorServerHandler,
  DatabaseExecutorServerRequest,
  SubprocessDatabaseServerDiagnostics,
  SubprocessDatabaseServerOptions,
  SubprocessDatabaseServerState,
  SubprocessDatabaseServerTransport,
} from './subprocess-database-server';
