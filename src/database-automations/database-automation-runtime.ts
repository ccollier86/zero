/**
 * database-automation-runtime.ts
 *
 * Composes same-transaction trigger execution with the source-local durable
 * outbox for one database actor. It owns lifecycle and narrow queue operations;
 * Fabric routing and host-side function execution remain outside this module.
 */

import { DatabaseError, isDatabaseError } from '../databases/database-error';
import { isDatabaseRegistryName } from '../databases/database-operations';
import {
  type ClaimedDatabaseAutomationDelivery,
  type DatabaseAutomationDeliveryLease,
  type DatabaseAutomationOutboxCompletionResult,
  type DatabaseAutomationOutboxDeadResult,
  type DatabaseAutomationOutboxRecoveryResult,
  type DatabaseAutomationOutboxRetryResult,
} from './automation-outbox-contracts';
import { DatabaseAutomationOutboxStore } from './automation-outbox-store';
import { createDatabaseAutomationOutboxAdapter } from './database-automation-outbox-adapter';
import {
  DatabaseTransactionAutomationRuntime,
} from './database-transaction-automation-runtime';
import type {
  DatabaseAutomationRuntimeOptions,
  DatabaseAutomationRuntimeStatus,
} from './database-automation-runtime-types';

const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;

/** Actor-local lifecycle for transaction and durable database automations. */
export class DatabaseAutomationRuntime {
  private readonly registry: DatabaseAutomationRuntimeOptions['registry'];
  private readonly realmName: string;
  private readonly manifestFingerprint: string;
  private readonly outbox: DatabaseAutomationOutboxStore | null;
  private readonly transactionRuntime: DatabaseTransactionAutomationRuntime;
  private transactionClosed = false;
  private outboxClosed: boolean;
  private closing = false;
  private closed = false;

  constructor(options: DatabaseAutomationRuntimeOptions) {
    assertRuntimeOptions(options);
    this.registry = options.registry;
    this.realmName = options.realmName;
    this.manifestFingerprint = options.registry.fingerprint;
    const hasDurableFunctions = options.registry
      .listFunctions()
      .some(({ mode }) => mode === 'durable');
    assertDurableSourcePolicy(options, hasDurableFunctions);

    let outbox: DatabaseAutomationOutboxStore | null = null;
    try {
      if (hasDurableFunctions) {
        outbox = new DatabaseAutomationOutboxStore({
          db: options.db,
          limits: options.outbox.limits,
        });
        outbox.assertActiveRealm(options.realmName);
      }
      const durableSink = outbox
        ? createDatabaseAutomationOutboxAdapter({
            store: outbox,
            registry: options.registry,
            realmName: options.realmName,
            realmFingerprint: options.realmFingerprint,
          })
        : undefined;
      this.transactionRuntime = new DatabaseTransactionAutomationRuntime({
        db: options.db,
        registry: options.registry,
        ...(durableSink ? { durableSink } : {}),
        readOnlyTables: options.readOnlyTables,
        limits: options.transactionLimits,
        now: options.now,
        createId: options.createId,
      });
    } catch (cause) {
      const cleanupFailures: unknown[] = [];
      if (outbox) {
        try {
          outbox.close();
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      if (cleanupFailures.length > 0) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database automation runtime startup cleanup failed.',
          {
            cause: new AggregateError(
              [cause, ...cleanupFailures],
              'Automation runtime startup and cleanup failed.',
            ),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      if (isDatabaseError(cause)) throw cause;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database automation runtime could not start.',
        { cause, retryable: false, outcome: 'not-started' },
      );
    }
    this.outbox = outbox;
    this.outboxClosed = outbox === null;
  }

  /** Claim the next due durable function invocation. */
  claim(
    leaseOwner: string,
    now: number,
    leaseMs: number,
  ): ClaimedDatabaseAutomationDelivery | null {
    const outbox = this.requireOutbox();
    const claim = outbox.claim(leaseOwner, now, leaseMs);
    if (!claim) return null;
    if (claim.realmName !== this.realmName) {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Database automation delivery belongs to another realm.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    const definition = this.registry.getFunction(claim.functionIdentity);
    if (!definition || definition.mode !== 'durable') {
      const outcome = outbox.dead(
        claim,
        'AUTOMATION_FUNCTION_UNAVAILABLE',
        now,
      );
      if (outcome !== 'dead') {
        throw new DatabaseError(
          'DATABASE_OUTCOME_UNKNOWN',
          'Database automation unavailable-function disposition is unknown.',
        );
      }
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'The exact durable database function is unavailable.',
        {
          retryable: false,
          outcome: 'not-started',
          details: { reason: 'durable-function-unavailable' },
        },
      );
    }
    return claim;
  }

  /** Renew the exact physical attempt represented by a live lease token. */
  renew(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): ClaimedDatabaseAutomationDelivery | null {
    return this.requireOutbox().renew(claim, now, leaseMs);
  }

  /** Mark one exact durable attempt complete. */
  complete(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
  ): DatabaseAutomationOutboxCompletionResult {
    return this.requireOutbox().complete(claim, now);
  }

  /** Requeue one exact attempt or dead-letter it at its attempt ceiling. */
  retry(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    retryAt: number,
    now: number,
  ): DatabaseAutomationOutboxRetryResult {
    return this.requireOutbox().retry(claim, errorCode, retryAt, now);
  }

  /** Explicitly dead-letter one exact attempt. */
  dead(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    now: number,
  ): DatabaseAutomationOutboxDeadResult {
    return this.requireOutbox().dead(claim, errorCode, now);
  }

  /** Recover every expired source-local lease in one SQLite transaction. */
  recoverExpired(now: number): DatabaseAutomationOutboxRecoveryResult {
    return this.requireOutbox().recoverExpired(now);
  }

  /** Return bounded aggregate state without payloads or source identities. */
  status(): DatabaseAutomationRuntimeStatus {
    this.assertOpen();
    return Object.freeze({
      outbox: this.outbox ? 'ready' as const : 'disabled' as const,
      manifestFingerprint: this.manifestFingerprint,
      counts: this.outbox?.counts() ?? null,
    });
  }

  /** Stop mutation interception before releasing private outbox statements. */
  close(): void {
    if (this.closed) return;
    this.closing = true;
    const failures: unknown[] = [];
    if (!this.transactionClosed) {
      try {
        this.transactionRuntime.close();
        this.transactionClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.transactionClosed && this.outbox && !this.outboxClosed) {
      try {
        this.outbox.close();
        this.outboxClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database automation runtime cleanup failed.',
        {
          cause: new AggregateError(failures, 'Automation runtime cleanup failed.'),
          retryable: false,
          outcome: 'unknown',
        },
      );
    }
    this.closed = true;
  }

  private requireOutbox(): DatabaseAutomationOutboxStore {
    this.assertOpen();
    if (!this.outbox) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'This database automation runtime has no durable outbox.',
      );
    }
    return this.outbox;
  }

  private assertOpen(): void {
    if (this.closing || this.closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database automation runtime is closed.',
      );
    }
  }
}

function assertRuntimeOptions(options: DatabaseAutomationRuntimeOptions): void {
  if (!isDatabaseRegistryName(options.realmName)
    || !SHA256_FINGERPRINT_PATTERN.test(options.realmFingerprint)
    || (options.storageMode !== 'file'
      && options.storageMode !== 'hot'
      && options.storageMode !== 'ephemeral')
    || !options.outbox
    || typeof options.outbox !== 'object'
    || typeof options.outbox.enabled !== 'boolean') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database automation runtime configuration is invalid.',
      { details: { phase: 'automation-config' } },
    );
  }
}

function assertDurableSourcePolicy(
  options: DatabaseAutomationRuntimeOptions,
  hasDurableFunctions: boolean,
): void {
  if (!hasDurableFunctions) return;
  if (options.storageMode === 'ephemeral') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Durable database automations require durable source storage.',
      { details: { phase: 'automation-config' } },
    );
  }
  if (!options.outbox.enabled) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Durable database automations require a source-local outbox.',
      { details: { phase: 'automation-config' } },
    );
  }
}
