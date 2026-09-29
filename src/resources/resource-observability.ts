/**
 * App-local observability ownership for immutable registered resources.
 *
 * Resource policy contexts deliberately remain framework-neutral and must not
 * expose an observability runtime to application callbacks. The registry binds
 * each detached resource object to its owning app here instead. Standalone
 * resources without an owner retain the historical ambient-sink behavior.
 */

import type {
  PlatformCodeDefinition,
  PlatformEvent,
  PlatformObservabilityRuntime,
} from '../observability/types';
import {
  emitPlatformCode,
  emitPlatformCodeTo,
  warnPlatform,
} from '../observability/sink';
import { OBS_CODES } from '../observability/codes';
import type {
  DatabaseErrorCode,
  DatabaseOperationOutcome,
} from '../databases/database-error';
import type { DatabaseHttpConflictType } from '../databases/database-http-error';
import {
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  type ResourceMutationReceiptCompaction,
} from './resource-default-receipt-store';
import type { ResourceAction } from './resource-policy-types';

const resourceObservabilityOwners = new WeakMap<object, PlatformObservabilityRuntime>();

const RESOURCE_OBSERVABILITY_IDENTIFIER_MAX_LENGTH = 128;

/** Storage plane used by a generated Resource operation. */
export type ResourceDatabasePlane = 'default' | 'tenant';

/** Stable, low-cardinality reason for a generated CRUD failure event. */
export type ResourceCrudFailureKind =
  | 'mutation'
  | 'query'
  | 'tenant-database'
  | 'committed-readback';

/** Closed input for privacy-safe generated CRUD failure telemetry. */
export interface ResourceCrudFailureEvent {
  readonly resource: string;
  readonly table: string;
  readonly action: ResourceAction;
  readonly failureKind: ResourceCrudFailureKind;
  readonly databasePlane?: ResourceDatabasePlane;
  readonly databaseCode?: DatabaseErrorCode;
  readonly databaseOutcome?: DatabaseOperationOutcome | 'committed' | 'none';
  readonly databaseConflictType?: DatabaseHttpConflictType | 'none';
}

/** Closed context shared by default and physical-tenant receipt events. */
export interface ResourceReceiptEventContext {
  readonly resource: string;
  readonly table: string;
  readonly action: Extract<ResourceAction, 'create' | 'update' | 'delete'>;
  readonly databasePlane: ResourceDatabasePlane;
  readonly permanentKeyLimit?: number;
}

/** Bind one immutable registered resource to the app runtime that owns it. */
export function bindResourceObservabilityOwner(
  resource: object,
  observability: PlatformObservabilityRuntime | null | undefined,
): void {
  if (observability) resourceObservabilityOwners.set(resource, observability);
}

/** Emit a resource-policy warning through its owning app, or the legacy sink. */
export function warnResourcePolicy(
  resource: object,
  definition: PlatformCodeDefinition,
  options: Readonly<{
    metadata?: Readonly<Record<string, unknown>>;
  }> = {},
): PlatformEvent {
  const safeOptions = {
    metadata: policyFailureMetadata(options.metadata),
    level: 'warn' as const,
  };
  const observability = resourceObservabilityOwners.get(resource);
  if (observability) {
    return emitPlatformCodeTo(observability, definition, safeOptions);
  }
  return warnPlatform(definition, safeOptions);
}

/** Emit a generated CRUD failure without transporting a caught Error. */
export function emitResourceCrudFailure(
  observability: PlatformObservabilityRuntime | null | undefined,
  event: ResourceCrudFailureEvent,
): PlatformEvent {
  return emitResourceCode(observability, OBS_CODES.RESOURCE_CRUD_FAILED, {
    resource: safeIdentifier(event.resource),
    table: safeIdentifier(event.table),
    action: event.action,
    failureKind: event.failureKind,
    ...(event.databasePlane ? { databasePlane: event.databasePlane } : {}),
    ...(event.databaseCode ? { databaseCode: event.databaseCode } : {}),
    ...(event.databaseOutcome
      ? { databaseOutcome: event.databaseOutcome }
      : {}),
    ...(event.databaseConflictType
      ? { databaseConflictType: event.databaseConflictType }
      : {}),
  });
}

/** Emit a permanent receipt-expiry event with bounded declarative context. */
export function emitResourceReceiptExpired(
  observability: PlatformObservabilityRuntime | null | undefined,
  context: ResourceReceiptEventContext,
): PlatformEvent {
  return emitResourceReceiptCode(
    observability,
    OBS_CODES.DATABASE_RECEIPT_EXPIRED,
    context,
  );
}

/** Emit a corrupt/default receipt lookup event without its caught Error. */
export function emitResourceReceiptLookupFailed(
  observability: PlatformObservabilityRuntime | null | undefined,
  context: ResourceReceiptEventContext,
): PlatformEvent {
  return emitResourceReceiptCode(
    observability,
    OBS_CODES.DATABASE_RECEIPT_LOOKUP_FAILED,
    context,
  );
}

/** Emit aggregate capacity exhaustion without a key, principal, or SQL error. */
export function emitResourceReceiptCapacityExhausted(
  observability: PlatformObservabilityRuntime | null | undefined,
  context: ResourceReceiptEventContext,
): PlatformEvent {
  return emitResourceCode(
    observability,
    OBS_CODES.RESOURCE_RECEIPT_CAPACITY_EXHAUSTED,
    {
      ...receiptMetadata(context),
      permanentKeyLimit: safeCount(
        context.permanentKeyLimit ?? RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
      ),
    },
  );
}

/** Emit bounded default-receipt compaction accounting. */
export function emitResourceReceiptCompacted(
  observability: PlatformObservabilityRuntime | null | undefined,
  context: ResourceReceiptEventContext,
  compaction: ResourceMutationReceiptCompaction,
): PlatformEvent {
  return emitResourceCode(observability, OBS_CODES.DATABASE_RECEIPT_COMPACTED, {
    ...receiptMetadata(context),
    totalKeys: safeCount(compaction.totalKeys),
    retainedResults: safeCount(compaction.retainedResults),
    retainedResultBytes: safeCount(compaction.retainedResultBytes),
    expiredTombstones: safeCount(compaction.expiredTombstones),
    keyLimit: safeCount(compaction.keyLimit),
    prunedCount: safeCount(compaction.prunedCount),
    prunedResultBytes: safeCount(compaction.prunedResultBytes),
    retainedLimit: safeCount(compaction.retainedLimit),
    retainedByteLimit: safeCount(compaction.retainedByteLimit),
    resultByteLimit: safeCount(compaction.resultByteLimit),
  });
}

function emitResourceReceiptCode(
  observability: PlatformObservabilityRuntime | null | undefined,
  definition: PlatformCodeDefinition,
  context: ResourceReceiptEventContext,
): PlatformEvent {
  return emitResourceCode(observability, definition, receiptMetadata(context));
}

function emitResourceCode(
  observability: PlatformObservabilityRuntime | null | undefined,
  definition: PlatformCodeDefinition,
  metadata: Record<string, unknown>,
): PlatformEvent {
  const options = { metadata: Object.freeze(metadata) };
  return observability
    ? emitPlatformCodeTo(observability, definition, options)
    : emitPlatformCode(definition, options);
}

function receiptMetadata(
  context: ResourceReceiptEventContext,
): Record<string, unknown> {
  return {
    resource: safeIdentifier(context.resource),
    table: safeIdentifier(context.table),
    action: context.action,
    databasePlane: context.databasePlane,
  };
}

function policyFailureMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const safe: Record<string, unknown> = {};
  if (typeof metadata.kind === 'string') safe.kind = safeIdentifier(metadata.kind);
  if (typeof metadata.policy === 'string') safe.policy = safeIdentifier(metadata.policy);
  if (typeof metadata.table === 'string') safe.table = safeIdentifier(metadata.table);
  if (isResourceAction(metadata.action)) safe.action = metadata.action;
  return safe;
}

function safeIdentifier(value: string): string {
  if (value.length === 0
    || value.length > RESOURCE_OBSERVABILITY_IDENTIFIER_MAX_LENGTH
    || !/^[A-Za-z0-9_.:-]+$/u.test(value)) {
    return '[invalid]';
  }
  return value;
}

function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function isResourceAction(value: unknown): value is ResourceAction {
  return value === 'list'
    || value === 'get'
    || value === 'create'
    || value === 'update'
    || value === 'delete';
}
