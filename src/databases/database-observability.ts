/**
 * database-observability.ts
 *
 * Stable public facade for ReactiveDB Fabric observability. Contracts,
 * validation, event mapping, and the app-local runtime boundary live in
 * focused modules behind this entry point.
 */

export {
  DATABASE_EXECUTOR_ROLES,
  DATABASE_OBSERVABILITY_MAX_COUNT,
  DATABASE_OBSERVABILITY_MAX_DURATION_MS,
  DATABASE_OBSERVABILITY_MAX_SEQUENCE,
  DATABASE_OBSERVABILITY_MAX_SLOT,
  DATABASE_OBSERVABILITY_PHASES,
  DATABASE_OBSERVABILITY_REASONS,
  DATABASE_OPERATION_FAILURE_REASONS,
  DATABASE_OPERATION_CLASSES,
} from './database-observability-contract';
export type {
  DatabaseExecutorRole,
  DatabaseObservabilityEvent,
  DatabaseObservabilityEventType,
  DatabaseObservabilityMetadata,
  DatabaseObservabilityPhase,
  DatabaseObservabilityReason,
  DatabaseOperationClass,
  DatabaseOperationFailureReason,
} from './database-observability-contract';
export {
  DatabaseObservability,
  createDatabaseObservability,
  emitDatabaseObservabilityEvent,
} from './database-observability-runtime';
