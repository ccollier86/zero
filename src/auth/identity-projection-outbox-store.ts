import type { ReactiveDB } from '../sync/reactive-db';
import { registerReactiveDBRollbackRecovery } from '../sync/reactive-db-rollback-recovery';
import { IdentityProjectionDeliveryJournal } from './identity-projection-delivery-journal';
import { identityProjectionError } from './identity-projection-error';
import { safeIdentityProjectionErrorCode } from './identity-projection-outbox-records';
import { defineIdentityProjectionSystemTables } from './identity-projection-schema';
import { IdentityProjectionTargetCatalog } from './identity-projection-target-catalog';
import type {
  IdentityAnchor,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
  IdentityProjectionTargetScope,
  IdentityProjectionTargetState,
} from './identity-projection-types';
import {
  identityAnchorDedupeKey,
  identityAnchorFingerprint,
  requireIdentityProjectionId,
  validateIdentityAnchor,
} from './identity-projection-validation';

export interface IdentityProjectionOutboxStoreOptions {
  now?: () => number;
  createEventId?: () => string;
  createInstallationId?: () => string;
}

export interface IdentityProjectionEnqueueResult {
  readonly delivery: IdentityProjectionDelivery;
  readonly inserted: boolean;
}

type IdentityProjectionEnqueueTransactionResult =
  | { readonly kind: 'enqueued'; readonly value: IdentityProjectionEnqueueResult }
  | { readonly kind: 'conflict' };

/**
 * Transactional facade over the system-plane target catalog and delivery
 * journal. Methods stay synchronous so enqueue can join Guardian SQL.
 */
export class IdentityProjectionOutboxStore {
  private readonly now: () => number;
  private readonly createEventId: () => string;
  private readonly installationId: string;
  private readonly targets: IdentityProjectionTargetCatalog;
  private readonly deliveries: IdentityProjectionDeliveryJournal;

  constructor(
    private readonly db: ReactiveDB,
    options: IdentityProjectionOutboxStoreOptions = {},
  ) {
    defineIdentityProjectionSystemTables(db);
    this.now = options.now ?? Date.now;
    this.createEventId = options.createEventId
      ?? (() => `ipj_${crypto.randomUUID()}`);
    this.targets = new IdentityProjectionTargetCatalog(db);
    this.deliveries = new IdentityProjectionDeliveryJournal(db);
    const createInstallationId = options.createInstallationId
      ?? (() => `ipi_${crypto.randomUUID()}`);
    this.installationId = this.db.transaction(() => (
      this.targets.loadOrCreateInstallationId(createInstallationId, this.currentTime())
    ));
  }

  /** Stable authority identity binding every target database to this system.db. */
  getInstallationId(): string {
    return this.installationId;
  }

  registerTarget(
    targetIdInput: string,
    scope: IdentityProjectionTargetScope,
  ): IdentityProjectionTargetState {
    const targetId = requireIdentityProjectionId(targetIdInput, 'targetId');
    if (scope !== 'application' && scope !== 'tenant' && scope !== 'named') {
      throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
    }
    const now = this.currentTime();
    return this.db.transaction(() => this.targets.register(targetId, scope, now));
  }

  getTargetState(targetIdInput: string): IdentityProjectionTargetState | null {
    const targetId = requireIdentityProjectionId(targetIdInput, 'targetId');
    return this.targets.getState(targetId);
  }

  /** Bounded-by-configuration target catalog used for startup catch-up. */
  listTargetStates(): readonly IdentityProjectionTargetState[] {
    return this.targets.listStates();
  }

  /** Retained completed history used to rebuild a restored target watermark. */
  listCompletedAfter(
    targetIdInput: string,
    sequence: number,
    limit = 100,
  ): IdentityProjectionDelivery[] {
    const targetId = requireIdentityProjectionId(targetIdInput, 'targetId');
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new TypeError('sequence must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new TypeError('limit must be between 1 and 10000');
    }
    this.targets.requireUsable(targetId);
    return this.deliveries.listCompletedAfter(targetId, sequence, limit);
  }

  enqueue(targetIdInput: string, anchorInput: IdentityAnchor): IdentityProjectionDelivery {
    return this.enqueueWithDisposition(targetIdInput, anchorInput).delivery;
  }

  /** Enqueue once while exposing whether this call created durable work. */
  enqueueWithDisposition(
    targetIdInput: string,
    anchorInput: IdentityAnchor,
  ): IdentityProjectionEnqueueResult {
    const targetId = requireIdentityProjectionId(targetIdInput, 'targetId');
    const anchor = validateIdentityAnchor(anchorInput);
    const dedupeKey = identityAnchorDedupeKey(anchor);
    const now = this.currentTime();
    const result = this.db.transaction<IdentityProjectionEnqueueTransactionResult>(() => {
      this.targets.requireUsable(targetId);
      const existing = this.deliveries.findByDedupeKey(targetId, dedupeKey);
      if (existing) {
        if (identityAnchorFingerprint(existing.anchor) !== identityAnchorFingerprint(anchor)) {
          this.preserveQuarantineAfterOuterRollback(
            targetId,
            'IDENTITY_PROJECTION_CONFLICT',
            now,
          );
          this.targets.quarantine(targetId, 'IDENTITY_PROJECTION_CONFLICT', now);
          return { kind: 'conflict' };
        }
        return {
          kind: 'enqueued',
          value: Object.freeze({ delivery: existing, inserted: false }),
        };
      }

      const sequence = this.targets.reserveSequence(targetId, now);
      const eventId = requireIdentityProjectionId(this.createEventId(), 'eventId');
      return {
        kind: 'enqueued',
        value: Object.freeze({
          delivery: this.deliveries.insert({
            targetId,
            sequence,
            eventId,
            dedupeKey,
            anchor,
            now,
          }),
          inserted: true,
        }),
      };
    });
    if (result.kind === 'conflict') {
      throw identityProjectionError('IDENTITY_PROJECTION_CONFLICT');
    }
    return result.value;
  }

  claimNext(
    targetIdInput: string,
    workerIdInput: string,
    leaseMs: number,
  ): IdentityProjectionDelivery | null {
    const targetId = requireIdentityProjectionId(targetIdInput, 'targetId');
    const workerId = requireIdentityProjectionId(workerIdInput, 'workerId');
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new TypeError('leaseMs must be a positive safe integer');
    }
    const now = this.currentTime();
    const leaseExpiresAt = now + leaseMs;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
      throw new TypeError('lease expiration must be a safe integer');
    }
    return this.db.transaction(() => {
      this.targets.requireUsable(targetId);
      return this.deliveries.claimNext(targetId, workerId, now, leaseExpiresAt);
    });
  }

  acknowledge(
    delivery: IdentityProjectionDelivery,
    receipt: IdentityProjectionReceipt,
  ): IdentityProjectionTargetState {
    const now = this.currentTime();
    return this.db.transaction(() => {
      this.deliveries.acknowledge(delivery, receipt, now);
      this.targets.acknowledge(delivery.targetId, delivery.sequence, now);
      return this.targets.requireState(delivery.targetId);
    });
  }

  release(
    delivery: IdentityProjectionDelivery,
    retryAt: number,
    errorCode: string,
  ): boolean {
    if (!Number.isSafeInteger(retryAt) || retryAt < 0) {
      throw new TypeError('retryAt must be a non-negative safe integer');
    }
    const now = this.currentTime();
    const code = safeIdentityProjectionErrorCode(errorCode);
    return this.db.transaction(() => {
      this.deliveries.release(delivery, retryAt, code, now);
      this.targets.markProvisioning(delivery.targetId, code, now);
      return true;
    });
  }

  quarantine(
    delivery: IdentityProjectionDelivery,
    errorCode: string,
  ): IdentityProjectionTargetState {
    const now = this.currentTime();
    const code = safeIdentityProjectionErrorCode(errorCode);
    return this.db.transaction(() => {
      this.deliveries.quarantine(delivery, code, now);
      this.targets.quarantine(delivery.targetId, code, now);
      return this.targets.requireState(delivery.targetId);
    });
  }

  markReady(targetIdInput: string): IdentityProjectionTargetState {
    const targetId = requireIdentityProjectionId(targetIdInput, 'targetId');
    const now = this.currentTime();
    return this.db.transaction(() => this.targets.markReady(targetId, now));
  }

  recoverExpired(): number {
    const now = this.currentTime();
    return this.db.transaction(() => this.deliveries.recoverExpired(now));
  }

  private preserveQuarantineAfterOuterRollback(
    targetId: string,
    errorCode: string,
    now: number,
  ): void {
    // enqueue can join a wider Guardian transaction. Preserve the quarantine
    // even when its stable conflict error rolls that outer transaction back.
    registerReactiveDBRollbackRecovery(this.db, () => {
      this.db.transaction(() => {
        // A target created entirely inside the rolled-back outer transaction
        // no longer exists and has no retained identity meaning to quarantine.
        if (this.targets.getState(targetId)) {
          this.targets.quarantine(targetId, errorCode, now);
        }
      });
    });
  }

  private currentTime(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new TypeError('identity projection clock must return a non-negative safe integer');
    }
    return now;
  }
}
