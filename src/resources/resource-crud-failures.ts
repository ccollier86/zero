/**
 * resource-crud-failures.ts
 *
 * Classifies persistence failures into stable generated Resource responses and
 * emits privacy-safe platform events. It never transports caught error text,
 * tenant identities, receipt keys, SQL, or bind values to clients or sinks.
 */

import { classifyDatabaseHttpFailure } from '../databases/database-http-error';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { ResourceCrudFailure } from './resource-crud-contracts';
import {
  ResourceMutationReceiptError,
  type ResourceMutationReceiptCompaction,
} from './resource-default-receipt-store';
import {
  emitResourceCrudFailure,
  emitResourceReceiptCapacityExhausted,
  emitResourceReceiptCompacted,
  emitResourceReceiptExpired,
  emitResourceReceiptLookupFailed,
} from './resource-observability';
import type { ResourceAction } from './resource-policy-types';
import type { RegisteredResourceDefinition } from './resource-registry';
import {
  resourceAuthorityChangedFailure,
  resourceConflictFailure,
  resourceFailure,
  resourceRowChangedFailure,
  sameIdempotencyKeyFailure,
  tenantDatabaseUnavailableFailure,
} from './resource-crud-results';

type MutationAction = Extract<ResourceAction, 'create' | 'update' | 'delete'>;

/** Stable failure and observability adapter shared by both CRUD engines. */
export class ResourceCrudFailureMapper {
  constructor(
    private readonly observability: PlatformObservabilityRuntime | null | undefined,
  ) {}

  /** Classify a default-plane receipt lookup/admission failure. */
  defaultReceipt(
    error: unknown,
    resource: RegisteredResourceDefinition,
    action: MutationAction,
  ): ResourceCrudFailure {
    if (!(error instanceof ResourceMutationReceiptError)) {
      return this.mutation(error, resource, action);
    }
    if (error.kind === 'key-reused') {
      return resourceFailure(
        409,
        'Idempotency-Key was already used for a different resource mutation',
        'resource-idempotency-key-reused',
      );
    }
    if (error.kind === 'expired') {
      emitResourceReceiptExpired(this.observability, {
        resource: resource.name,
        table: resource.table,
        action,
        databasePlane: 'default',
      });
      return resourceFailure(
        409,
        'Idempotency result expired; read the current resource state before submitting new work',
        'resource-idempotency-result-expired',
        false,
      );
    }
    if (error.kind === 'capacity') {
      emitResourceReceiptCapacityExhausted(this.observability, {
        resource: resource.name,
        table: resource.table,
        action,
        databasePlane: 'default',
      });
      return resourceFailure(
        503,
        'Resource idempotency receipt capacity is exhausted',
        'resource-idempotency-capacity-exhausted',
        false,
      );
    }
    if (error.kind === 'result-too-large') {
      return resourceFailure(400, 'Invalid resource input', 'invalid-resource-input');
    }

    emitResourceReceiptLookupFailed(this.observability, {
      resource: resource.name,
      table: resource.table,
      action,
      databasePlane: 'default',
    });
    return resourceFailure(500, 'Resource mutation failed', 'resource-mutation-failed');
  }

  /** Emit bounded default receipt compaction accounting when work was pruned. */
  defaultReceiptCompaction(
    compaction: ResourceMutationReceiptCompaction | null,
    resource: RegisteredResourceDefinition,
    action: MutationAction,
  ): void {
    if (!compaction) return;
    emitResourceReceiptCompacted(this.observability, {
      resource: resource.name,
      table: resource.table,
      action,
      databasePlane: 'default',
    }, compaction);
  }

  /** Classify an actor-backed physical-tenant read or write failure. */
  tenantDatabase(
    error: unknown,
    resource: RegisteredResourceDefinition,
    action: ResourceAction,
    operation: 'read' | 'write',
  ): ResourceCrudFailure {
    const classified = classifyDatabaseHttpFailure(error, operation);
    if (classified.receiptState !== 'expired'
      && (classified.kind === 'write-outcome-unknown'
        || classified.kind === 'unavailable'
        || (classified.kind === 'capacity'
          && classified.capacityType !== 'receipts'))) {
      emitResourceCrudFailure(this.observability, {
        resource: resource.name,
        table: resource.table,
        action,
        failureKind: 'tenant-database',
        databasePlane: 'tenant',
        databaseCode: classified.databaseCode,
        databaseOutcome: classified.outcome ?? 'none',
        databaseConflictType: classified.conflictType ?? 'none',
      });
    }

    if (classified.receiptState === 'expired') {
      if (isResourceReceiptAction(action)) {
        emitResourceReceiptExpired(this.observability, {
          resource: resource.name,
          table: resource.table,
          action,
          databasePlane: 'tenant',
        });
      }
      return resourceFailure(
        409,
        'Idempotency result expired; read the current resource state before submitting new work',
        'resource-idempotency-result-expired',
        false,
      );
    }

    switch (classified.kind) {
      case 'authority':
        return resourceAuthorityChangedFailure();
      case 'conflict': {
        switch (classified.conflictType) {
          case 'idempotency-key-reused':
            return resourceFailure(
              409,
              'Idempotency-Key was already used for a different resource mutation',
              'resource-idempotency-key-reused',
            );
          case 'cas':
            return resourceRowChangedFailure();
          case 'primary-key':
            return action === 'create'
              ? resourceFailure(409, 'Resource row already exists', 'resource-conflict')
              : resourceConflictFailure();
          case 'constraint':
          default:
            return resourceConflictFailure();
        }
      }
      case 'invalid':
        return resourceFailure(
          400,
          operation === 'read' ? 'Invalid resource query' : 'Invalid resource input',
          operation === 'read' ? 'invalid-resource-query' : 'invalid-resource-input',
        );
      case 'capacity':
        if (classified.capacityType === 'receipts'
          && isResourceReceiptAction(action)) {
          emitResourceReceiptCapacityExhausted(this.observability, {
            resource: resource.name,
            table: resource.table,
            action,
            databasePlane: 'tenant',
            ...(classified.capacityLimit === undefined
              ? {}
              : { permanentKeyLimit: classified.capacityLimit }),
          });
          return resourceFailure(
            503,
            'Resource idempotency receipt capacity is exhausted',
            'resource-idempotency-capacity-exhausted',
            false,
          );
        }
        return resourceFailure(
          503,
          'Tenant database capacity is exhausted',
          'database-capacity-exhausted',
          false,
        );
      case 'write-outcome-unknown':
        return sameIdempotencyKeyFailure(
          503,
          'Resource mutation outcome is unknown; retry with the same Idempotency-Key',
          'resource-mutation-outcome-unknown',
        );
      case 'unavailable':
        return tenantDatabaseUnavailableFailure();
    }
  }

  /** Report a committed actor mutation whose canonical effect was invalid. */
  committedReadback(
    resource: RegisteredResourceDefinition,
    action: MutationAction,
  ): ResourceCrudFailure {
    emitResourceCrudFailure(this.observability, {
      resource: resource.name,
      table: resource.table,
      action,
      failureKind: 'committed-readback',
      databasePlane: 'tenant',
      databaseCode: 'DATABASE_EXECUTOR_FAILED',
      databaseOutcome: 'committed',
    });
    return sameIdempotencyKeyFailure(
      503,
      'Resource mutation committed but its row could not be read safely',
      'resource-mutation-readback-failed',
    );
  }

  /** Classify a synchronous default-plane ReactiveDB mutation failure. */
  mutation(
    error: unknown,
    resource: RegisteredResourceDefinition,
    action: ResourceAction,
  ): ResourceCrudFailure {
    const message = error instanceof Error ? error.message : 'Resource mutation failed';
    if (message.includes('primary key already exists')) {
      return resourceFailure(409, 'Resource row already exists', 'resource-conflict');
    }
    if (message.includes('row changed since authorization')) {
      return resourceRowChangedFailure();
    }

    const status = isLikelyClientMutationError(message) ? 400 : 500;
    if (status >= 500) {
      emitResourceCrudFailure(this.observability, {
        resource: resource.name,
        table: resource.table,
        action,
        failureKind: 'mutation',
        databasePlane: 'default',
      });
    }
    return status === 400
      ? resourceFailure(400, 'Invalid resource input', 'invalid-resource-input')
      : resourceFailure(500, 'Resource mutation failed', 'resource-mutation-failed');
  }

  /** Map a default-plane generated query exception without reflecting details. */
  query(
    resource: RegisteredResourceDefinition,
    action: ResourceAction,
  ): ResourceCrudFailure {
    emitResourceCrudFailure(this.observability, {
      resource: resource.name,
      table: resource.table,
      action,
      failureKind: 'query',
      databasePlane: 'default',
    });
    return resourceFailure(500, 'Resource query failed', 'resource-query-failed');
  }
}

function isResourceReceiptAction(action: ResourceAction): action is MutationAction {
  return action === 'create' || action === 'update' || action === 'delete';
}

function isLikelyClientMutationError(message: string): boolean {
  return message.includes('missing primary key')
    || message.includes('identity')
    || message.includes('UNIQUE constraint')
    || message.includes('NOT NULL constraint')
    || message.includes('CHECK constraint')
    || message.includes('FOREIGN KEY constraint');
}
