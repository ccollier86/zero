/**
 * automation-outbox-store.ts
 *
 * Owns synchronous source-local durable-delivery lifecycle operations. It uses
 * private ReactiveDB SQL inside caller transactions, but never executes host
 * functions, schedules polling, or emits application row changes.
 */

import type { Statement } from 'bun:sqlite';
import { DatabaseError, isDatabaseError } from '../databases/database-error';
import { isDatabaseRegistryName } from '../databases/database-operations';
import type { ReactiveDB } from '../sync/reactive-db';
import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS,
  DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS,
  DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION,
  DEFAULT_DATABASE_AUTOMATION_OUTBOX_LIMITS,
  type ClaimedDatabaseAutomationDelivery,
  type DatabaseAutomationDeliveryLease,
  type DatabaseAutomationOutboxCompletionResult,
  type DatabaseAutomationOutboxCounts,
  type DatabaseAutomationOutboxDeadResult,
  type DatabaseAutomationOutboxEnqueueInput,
  type DatabaseAutomationOutboxEnqueueResult,
  type DatabaseAutomationOutboxLimits,
  type DatabaseAutomationOutboxRecord,
  type DatabaseAutomationOutboxRecoveryResult,
  type DatabaseAutomationOutboxRetryResult,
} from './automation-outbox-contracts';
import {
  assertDatabaseAutomationErrorCode,
  assertDatabaseAutomationLeaseOwner,
  assertDatabaseAutomationLeaseToken,
  assertSafeTimestamp,
  automationOutboxCorrupt,
  prepareDatabaseAutomationOutboxCommand,
  validateDatabaseAutomationOutboxLimits,
} from './automation-outbox-codec';
import {
  projectClaimedDatabaseAutomationDelivery,
  projectDatabaseAutomationOutboxRow,
  type DatabaseAutomationOutboxSqlRow,
} from './automation-outbox-row';
import { initializeDatabaseAutomationOutboxSchema } from './automation-outbox-schema';
import {
  prepareDatabaseAutomationOutboxStatements,
  type DatabaseAutomationOutboxStatements,
} from './automation-outbox-store-sql';

interface OutboxStateRow {
  readonly singleton?: unknown;
  readonly schema_version?: unknown;
  readonly total_records?: unknown;
  readonly active_records?: unknown;
  readonly active_bytes?: unknown;
  readonly last_ordinal?: unknown;
}

interface StatusCountsRow {
  readonly pending_records?: unknown;
  readonly processing_records?: unknown;
  readonly completed_records?: unknown;
  readonly dead_records?: unknown;
}

const DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,191}$/u;

/** Options for one source-database outbox store. */
export interface DatabaseAutomationOutboxStoreOptions {
  readonly db: ReactiveDB;
  /** Lower-only limits; omitted fields retain production defaults. */
  readonly limits?: Partial<DatabaseAutomationOutboxLimits>;
}

/**
 * Persist and fence durable automation deliveries in their source database.
 *
 * Construction installs or validates the exact private schema. Enqueue is
 * synchronous, so calling it from a ReactiveDB mutation interceptor commits or
 * rolls back with the originating application mutation.
 */
export class DatabaseAutomationOutboxStore {
  private readonly db: ReactiveDB;
  private readonly limits: DatabaseAutomationOutboxLimits;
  private readonly sql: DatabaseAutomationOutboxStatements;
  private readonly finalized = new Set<Statement>();
  private closing = false;
  private closed = false;

  constructor(options: DatabaseAutomationOutboxStoreOptions) {
    this.db = options.db;
    this.limits = validateDatabaseAutomationOutboxLimits({
      ...DEFAULT_DATABASE_AUTOMATION_OUTBOX_LIMITS,
      ...options.limits,
    });
    initializeDatabaseAutomationOutboxSchema(this.db);
    try {
      this.sql = prepareDatabaseAutomationOutboxStatements(this.db);
    } catch (cause) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database automation outbox statements could not be prepared.',
        { cause },
      );
    }
    try {
      this.executeWrite(() => this.db.transaction(() => {
        this.compactTerminalRecords();
      }));
    } catch (cause) {
      const cleanupFailures: unknown[] = [];
      for (const statement of [...this.sql.all].reverse()) {
        try {
          statement.finalize();
        } catch (cleanupCause) {
          cleanupFailures.push(cleanupCause);
        }
      }
      if (cleanupFailures.length > 0) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database automation outbox startup cleanup failed.',
          {
            cause: new AggregateError(
              [cause, ...cleanupFailures],
              'Database automation outbox startup and cleanup failed.',
            ),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      throw cause;
    }
  }

  /** Atomically enqueue a command or recognize its exact existing identity. */
  enqueue(
    input: DatabaseAutomationOutboxEnqueueInput,
    now = Date.now(),
  ): DatabaseAutomationOutboxEnqueueResult {
    this.assertOpen();
    const prepared = prepareDatabaseAutomationOutboxCommand(
      input,
      now,
    );
    return this.executeWrite(() => this.db.transaction(() => {
      this.compactTerminalRecords();
      const existing = this.readRow(prepared.deliveryId);
      if (existing) {
        if (existing.command_fingerprint !== prepared.commandFingerprint) {
          throw new DatabaseError(
            'DATABASE_CONFLICT',
            'Database automation delivery identity was already used.',
            {
              retryable: false,
              outcome: 'not-committed',
              details: { conflictType: 'delivery-id-reused' },
            },
          );
        }
        projectDatabaseAutomationOutboxRow(existing);
        return Object.freeze({
          status: 'existing' as const,
          deliveryId: prepared.deliveryId,
        });
      }

      if (prepared.payloadBytes > this.limits.maxPayloadBytes) {
        throw new DatabaseError(
          'DATABASE_PAYLOAD_LIMIT',
          'Database automation input exceeds the configured byte limit.',
        );
      }

      const before = this.readState();
      if (before.totalRecords >= this.limits.maxStoredRecords) {
        throw new DatabaseError(
          'DATABASE_CAPACITY_EXHAUSTED',
          'Database automation delivery identity capacity is exhausted.',
          { details: { capacityType: 'automation-deliveries' } },
        );
      }
      if (before.activeRecords >= this.limits.maxActiveRecords
        || before.activeBytes + prepared.payloadBytes > this.limits.maxActiveBytes) {
        throw new DatabaseError(
          'DATABASE_BACKPRESSURE',
          'Database automation delivery queue is at capacity.',
          {
            retryable: true,
            outcome: 'not-started',
            details: { capacityType: 'automation-outbox' },
          },
        );
      }
      const ordinal = before.lastOrdinal + 1;
      if (!Number.isSafeInteger(ordinal)) throw automationOutboxCorrupt();
      this.sql.insert.run(
        prepared.deliveryId,
        prepared.commandFingerprint,
        prepared.invocationId,
        prepared.triggerIdentity,
        prepared.functionIdentity,
        prepared.manifestFingerprint,
        prepared.realmName,
        prepared.realmFingerprint,
        prepared.sourceSequence,
        prepared.sourceTable,
        prepared.sourceOperation,
        prepared.sourceRowId,
        prepared.payloadJson,
        prepared.payloadBytes,
        this.limits.maxAttempts,
        prepared.availableAt,
        prepared.createdAt,
        prepared.createdAt,
        ordinal,
        DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION,
      );
      const after = this.readState();
      if (after.totalRecords !== before.totalRecords + 1
        || after.activeRecords !== before.activeRecords + 1
        || after.activeBytes !== before.activeBytes + prepared.payloadBytes
        || after.lastOrdinal !== ordinal) {
        throw automationOutboxCorrupt();
      }
      return Object.freeze({
        status: 'enqueued' as const,
        deliveryId: prepared.deliveryId,
      });
    }));
  }

  /** Claim the earliest due command with a fresh per-attempt fencing token. */
  claim(
    leaseOwner: string,
    now: number,
    leaseMs: number,
  ): ClaimedDatabaseAutomationDelivery | null {
    this.assertOpen();
    assertDatabaseAutomationLeaseOwner(leaseOwner);
    assertSafeTimestamp(now, 'claim');
    if (!Number.isSafeInteger(leaseMs)
      || leaseMs < DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS
      || leaseMs > DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Database automation lease duration is invalid.',
      );
    }
    return this.executeWrite(() => this.db.transaction(() => {
      const candidate = this.sql.nextDue.get(now) as DatabaseAutomationOutboxSqlRow | null;
      if (!candidate) return null;
      const pending = projectDatabaseAutomationOutboxRow(candidate);
      if (pending.status !== 'pending') {
        throw automationOutboxCorrupt();
      }
      const updatedAt = Math.max(now, pending.updatedAt);
      const leaseExpiresAt = updatedAt + leaseMs;
      if (!Number.isSafeInteger(leaseExpiresAt)) {
        throw new DatabaseError(
          'DATABASE_PAYLOAD_LIMIT',
          'Database automation lease timestamp exceeds the supported range.',
        );
      }
      const leaseToken = `lease:${crypto.randomUUID()}`;
      const claimed = this.sql.claim.get(
        leaseOwner,
        leaseToken,
        leaseExpiresAt,
        updatedAt,
        pending.deliveryId,
        now,
      );
      if (!claimed) return null;
      const row = this.readRow(pending.deliveryId);
      if (!row) throw automationOutboxCorrupt();
      return projectClaimedDatabaseAutomationDelivery(row);
    }));
  }

  /** Mark an exact, unexpired attempt complete and scrub its payload. */
  complete(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
  ): DatabaseAutomationOutboxCompletionResult {
    this.assertOpen();
    assertDatabaseAutomationDeliveryLease(claim);
    assertSafeTimestamp(now, 'completion');
    return this.executeWrite(() => this.db.transaction(() => {
      const completed = this.sql.complete.get(
        now,
        now,
        claim.deliveryId,
        claim.leaseOwner,
        claim.leaseToken,
        now,
      );
      if (completed) {
        this.compactTerminalRecords();
        return 'completed';
      }
      const current = this.readProjected(claim.deliveryId);
      return current?.status === 'completed' ? 'completed' : 'stale';
    }));
  }

  /** Requeue an exact attempt, or dead-letter it at its persisted ceiling. */
  retry(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    retryAt: number,
    now: number,
  ): DatabaseAutomationOutboxRetryResult {
    this.assertOpen();
    assertDatabaseAutomationDeliveryLease(claim);
    assertDatabaseAutomationErrorCode(errorCode);
    assertSafeTimestamp(now, 'retry');
    assertSafeTimestamp(retryAt, 'retry availability');
    if (retryAt < now) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Database automation retry availability precedes the retry timestamp.',
      );
    }
    return this.executeWrite(() => this.db.transaction(() => {
      const retried = this.sql.retry.get(
        retryAt,
        errorCode,
        now,
        claim.deliveryId,
        claim.leaseOwner,
        claim.leaseToken,
        now,
      );
      if (retried) return 'pending';
      const dead = this.sql.dead.get(
        errorCode,
        now,
        now,
        claim.deliveryId,
        claim.leaseOwner,
        claim.leaseToken,
        now,
      );
      if (dead) {
        this.compactTerminalRecords();
        return 'dead';
      }
      const current = this.readProjected(claim.deliveryId);
      return current?.status === 'dead' ? 'dead' : 'stale';
    }));
  }

  /** Explicitly dead-letter an exact, unexpired attempt. */
  dead(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    now: number,
  ): DatabaseAutomationOutboxDeadResult {
    this.assertOpen();
    assertDatabaseAutomationDeliveryLease(claim);
    assertDatabaseAutomationErrorCode(errorCode);
    assertSafeTimestamp(now, 'dead-letter');
    return this.executeWrite(() => this.db.transaction(() => {
      const result = this.sql.dead.get(
        errorCode,
        now,
        now,
        claim.deliveryId,
        claim.leaseOwner,
        claim.leaseToken,
        now,
      );
      if (result) {
        this.compactTerminalRecords();
        return 'dead';
      }
      const current = this.readProjected(claim.deliveryId);
      return current?.status === 'dead' ? 'dead' : 'stale';
    }));
  }

  /** Renew an exact live lease; stale attempts cannot move the fence. */
  renew(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): ClaimedDatabaseAutomationDelivery | null {
    this.assertOpen();
    assertDatabaseAutomationDeliveryLease(claim);
    assertSafeTimestamp(now, 'lease extension');
    if (!Number.isSafeInteger(leaseMs)
      || leaseMs < DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS
      || leaseMs > DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Database automation lease duration is invalid.',
      );
    }
    const leaseExpiresAt = Math.max(now, claim.updatedAt) + leaseMs;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_LIMIT',
        'Database automation lease timestamp exceeds the supported range.',
      );
    }
    return this.executeWrite(() => this.db.transaction(() => {
      const result = this.sql.extendLease.get(
        leaseExpiresAt,
        now,
        claim.deliveryId,
        claim.leaseOwner,
        claim.leaseToken,
        now,
        leaseExpiresAt,
      );
      if (!result) return null;
      const row = this.readRow(claim.deliveryId);
      return row ? projectClaimedDatabaseAutomationDelivery(row) : null;
    }));
  }

  /** Compatibility spelling for callers that model renewal as extension. */
  extendLease(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): ClaimedDatabaseAutomationDelivery | null {
    return this.renew(claim, now, leaseMs);
  }

  /** Requeue expired attempts and dead-letter exhausted ones atomically. */
  recoverExpired(now: number): DatabaseAutomationOutboxRecoveryResult {
    this.assertOpen();
    assertSafeTimestamp(now, 'lease recovery');
    return this.executeWrite(() => this.db.transaction(() => {
      const dead = this.sql.recoverDead.all(now, now, now).length;
      const requeued = this.sql.recoverPending.all(now, now, now).length;
      this.compactTerminalRecords();
      return Object.freeze({ requeued, dead });
    }));
  }

  /** Read one persisted delivery without exposing its canonical JSON. */
  get(deliveryId: string): DatabaseAutomationOutboxRecord | null {
    this.assertOpen();
    assertDeliveryId(deliveryId);
    return this.executeRead(() => this.readProjected(deliveryId));
  }

  /** Return exact queue counters after validating singleton accounting. */
  counts(): DatabaseAutomationOutboxCounts {
    this.assertOpen();
    return this.executeRead(() => {
      const state = this.readState();
      const statuses = this.sql.statusCounts.get() as StatusCountsRow | null;
      if (!statuses
        || !isCount(statuses.pending_records)
        || !isCount(statuses.processing_records)
        || !isCount(statuses.completed_records)
        || !isCount(statuses.dead_records)
        || statuses.pending_records + statuses.processing_records
          !== state.activeRecords
        || statuses.pending_records + statuses.processing_records
          + statuses.completed_records + statuses.dead_records
          !== state.totalRecords) {
        throw automationOutboxCorrupt();
      }
      return Object.freeze({
        totalRecords: state.totalRecords,
        activeRecords: state.activeRecords,
        activeBytes: state.activeBytes,
        pendingRecords: statuses.pending_records,
        processingRecords: statuses.processing_records,
        completedRecords: statuses.completed_records,
        deadRecords: statuses.dead_records,
      });
    });
  }

  /**
   * Fence active work to the logical actor realm. Deployment fingerprints are
   * retained as provenance so additive deployments can drain older work when
   * the exact versioned durable function remains registered.
   */
  assertActiveRealm(realmName: string): void {
    this.assertOpen();
    if (!isDatabaseRegistryName(realmName)) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database automation realm name is invalid.',
      );
    }
    this.executeRead(() => {
      const mismatch = this.sql.activeRealmMismatch.get(realmName);
      if (mismatch) {
        throw new DatabaseError(
          'DATABASE_AUTHORITY_CHANGED',
          'Active database automation work belongs to another realm.',
          {
            retryable: false,
            outcome: 'not-started',
            details: { phase: 'automation-outbox-realm' },
          },
        );
      }
    });
  }

  /** Finalize owned prepared statements. Idempotent after complete success. */
  close(): void {
    if (this.closed) return;
    this.closing = true;
    const failures: unknown[] = [];
    for (const statement of this.sql.all) {
      if (this.finalized.has(statement)) continue;
      try {
        statement.finalize();
        this.finalized.add(statement);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database automation outbox cleanup failed.',
        {
          cause: new AggregateError(failures, 'Outbox statement cleanup failed.'),
          retryable: false,
          outcome: 'unknown',
        },
      );
    }
    this.closed = true;
  }

  private readRow(deliveryId: string): DatabaseAutomationOutboxSqlRow | null {
    return this.sql.byId.get(deliveryId) as DatabaseAutomationOutboxSqlRow | null;
  }

  private readProjected(deliveryId: string): DatabaseAutomationOutboxRecord | null {
    const row = this.readRow(deliveryId);
    return row ? projectDatabaseAutomationOutboxRow(row) : null;
  }

  private readState(): Readonly<{
    totalRecords: number;
    activeRecords: number;
    activeBytes: number;
    lastOrdinal: number;
  }> {
    const state = this.sql.state.get() as OutboxStateRow | null;
    if (!state
      || state.singleton !== 1
      || state.schema_version !== DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION
      || !isCount(state.total_records)
      || state.total_records > DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS
      || !isCount(state.active_records)
      || state.active_records > state.total_records
      || state.active_records > DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS
      || !isCount(state.active_bytes)
      || state.active_bytes > DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES
      || !isCount(state.last_ordinal)) {
      throw automationOutboxCorrupt();
    }
    return Object.freeze({
      totalRecords: state.total_records,
      activeRecords: state.active_records,
      activeBytes: state.active_bytes,
      lastOrdinal: state.last_ordinal,
    });
  }

  /** Retain only the newest bounded terminal metadata and preserve active work. */
  private compactTerminalRecords(): number {
    const before = this.readState();
    const terminalRecords = before.totalRecords - before.activeRecords;
    const excess = terminalRecords - this.limits.maxTerminalRecords;
    if (excess <= 0) return 0;
    this.sql.compactTerminal.run(excess);
    const after = this.readState();
    const deleted = before.totalRecords - after.totalRecords;
    if (deleted !== excess
      || after.activeRecords !== before.activeRecords
      || after.activeBytes !== before.activeBytes
      || after.lastOrdinal !== before.lastOrdinal) {
      throw automationOutboxCorrupt();
    }
    return deleted;
  }

  private executeWrite<T>(operation: () => T): T {
    try {
      return operation();
    } catch (cause) {
      if (isDatabaseError(cause)) throw cause;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database automation outbox mutation failed.',
        { cause, retryable: false, outcome: 'not-committed' },
      );
    }
  }

  private executeRead<T>(operation: () => T): T {
    try {
      return operation();
    } catch (cause) {
      if (isDatabaseError(cause)) throw cause;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database automation outbox read failed.',
        { cause, retryable: true, outcome: 'not-started' },
      );
    }
  }

  private assertOpen(): void {
    if (this.closing || this.closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database automation outbox is closed.',
      );
    }
  }
}

function assertDeliveryId(value: string): void {
  if (typeof value !== 'string' || !DELIVERY_ID_PATTERN.test(value)) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database automation delivery identity is invalid.',
    );
  }
}

function assertDatabaseAutomationDeliveryLease(
  lease: DatabaseAutomationDeliveryLease,
): void {
  if (!lease || typeof lease !== 'object') {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database automation delivery lease is invalid.',
    );
  }
  assertDeliveryId(lease.deliveryId);
  assertDatabaseAutomationLeaseOwner(lease.leaseOwner);
  assertDatabaseAutomationLeaseToken(lease.leaseToken);
  assertSafeTimestamp(lease.updatedAt, 'lease update');
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
