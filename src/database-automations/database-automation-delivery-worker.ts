/**
 * Sequential per-source worker for at-least-once durable database functions.
 * Source mutations happen behind a narrow capability; handlers never hold the
 * writer lane and must use the stable delivery ID for downstream idempotency.
 */

import { DatabaseError } from '../databases/database-error';
import {
  DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS,
  DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS,
  type ClaimedDatabaseAutomationDelivery,
} from './automation-outbox-contracts';
import type { DatabaseAutomationRegistry } from './database-automations';
import {
  executeDatabaseAutomationDelivery,
} from './database-automation-delivery-execution';
import type {
  DatabaseAutomationDeliveryEvent,
  DatabaseAutomationDeliveryEventSink,
  DatabaseAutomationDeliverySource,
  DatabaseAutomationDrainResult,
  DatabaseAutomationExecutionServiceProvider,
} from './database-automation-delivery-contracts';
import { databaseAutomationRetryAt } from './database-automation-retry-policy';
import type { DurableDatabaseFunctionDefinition } from './database-function';
import {
  databaseAutomationDeliveryLease,
} from './database-automation-delivery-lease';

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_DELIVERIES = 100;
const MAX_DELIVERIES_PER_DRAIN = 1_000;
const MAX_EXECUTION_TIMEOUT_MS = 86_400_000;
const LEASE_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,191}$/u;

export interface DatabaseAutomationDeliveryWorkerOptions<TServices> {
  readonly source: DatabaseAutomationDeliverySource;
  readonly registry: DatabaseAutomationRegistry;
  readonly services: DatabaseAutomationExecutionServiceProvider<TServices>;
  readonly leaseOwner: string;
  readonly leaseMs?: number;
  readonly renewIntervalMs?: number;
  readonly executionTimeoutMs?: number;
  readonly maxDeliveriesPerDrain?: number;
  readonly now?: () => number;
  readonly emit?: DatabaseAutomationDeliveryEventSink;
}

/** One worker may drain repeatedly, but never overlaps itself on one source. */
export class DatabaseAutomationDeliveryWorker<TServices> {
  readonly #source: DatabaseAutomationDeliverySource;
  readonly #registry: DatabaseAutomationRegistry;
  readonly #services: DatabaseAutomationExecutionServiceProvider<TServices>;
  readonly #leaseOwner: string;
  readonly #leaseMs: number;
  readonly #renewIntervalMs: number;
  readonly #executionTimeoutMs: number;
  readonly #maxDeliveries: number;
  readonly #now: () => number;
  readonly #emit: DatabaseAutomationDeliveryEventSink | null;
  readonly #shutdown = new AbortController();
  #drainTask: Promise<DatabaseAutomationDrainResult> | null = null;
  #closed = false;

  constructor(options: DatabaseAutomationDeliveryWorkerOptions<TServices>) {
    if (!options || typeof options !== 'object'
      || !options.source
      || !options.registry
      || !options.services
      || !LEASE_OWNER_PATTERN.test(options.leaseOwner)) {
      throw configInvalid('Database automation delivery worker options are invalid.');
    }
    const leaseMs = boundedInteger(
      options.leaseMs ?? DEFAULT_LEASE_MS,
      DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS,
      DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS,
      'lease duration',
    );
    const renewIntervalMs = boundedInteger(
      options.renewIntervalMs ?? Math.max(250, Math.floor(leaseMs / 3)),
      1,
      leaseMs - 1,
      'lease renewal interval',
    );
    const executionTimeoutMs = boundedInteger(
      options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
      renewIntervalMs,
      MAX_EXECUTION_TIMEOUT_MS,
      'execution timeout',
    );
    const maxDeliveries = boundedInteger(
      options.maxDeliveriesPerDrain ?? DEFAULT_MAX_DELIVERIES,
      1,
      MAX_DELIVERIES_PER_DRAIN,
      'drain delivery limit',
    );
    if (options.now !== undefined && typeof options.now !== 'function') {
      throw configInvalid('Database automation clock must be a function.');
    }
    if (options.emit !== undefined && typeof options.emit !== 'function') {
      throw configInvalid('Database automation event sink must be a function.');
    }

    this.#source = options.source;
    this.#registry = options.registry;
    this.#services = options.services;
    this.#leaseOwner = options.leaseOwner;
    this.#leaseMs = leaseMs;
    this.#renewIntervalMs = renewIntervalMs;
    this.#executionTimeoutMs = executionTimeoutMs;
    this.#maxDeliveries = maxDeliveries;
    this.#now = options.now ?? Date.now;
    this.#emit = options.emit ?? null;
  }

  /** Recover expired attempts, then drain a bounded ordered batch. */
  drain(): Promise<DatabaseAutomationDrainResult> {
    if (this.#closed) return Promise.reject(closedError());
    if (this.#drainTask) return this.#drainTask;
    const task = this.#drainOnce();
    this.#drainTask = task;
    void task.finally(() => {
      if (this.#drainTask === task) this.#drainTask = null;
    }).catch(() => undefined);
    return task;
  }

  /** Stop new claims and abandon a current lease after fencing its services. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#shutdown.abort('shutdown');
    await this.#drainTask?.catch(() => undefined);
  }

  async #drainOnce(): Promise<DatabaseAutomationDrainResult> {
    const recovered = await this.#source.recoverExpired(this.#timestamp());
    if (recovered.requeued > 0 || recovered.dead > 0) {
      this.#event({ type: 'recovered', ...recovered });
    }
    const counts = {
      claimed: 0,
      completed: 0,
      retried: 0,
      dead: recovered.dead,
      leaseLost: 0,
      abandoned: 0,
    };

    while (!this.#shutdown.signal.aborted
      && counts.claimed < this.#maxDeliveries) {
      const claim = await this.#source.claim(
        this.#leaseOwner,
        this.#timestamp(),
        this.#leaseMs,
      );
      if (!claim) break;
      counts.claimed += 1;
      this.#event({ type: 'claimed', attempt: claim.attemptCount });
      const disposition = await this.#executeClaim(claim);
      counts[disposition] += 1;
    }

    return Object.freeze({ ...counts, recovered });
  }

  async #executeClaim(
    claim: ClaimedDatabaseAutomationDelivery,
  ): Promise<'completed' | 'retried' | 'dead' | 'leaseLost' | 'abandoned'> {
    const definition = this.#registry.getFunction(claim.functionIdentity);
    if (!definition || definition.mode !== 'durable') {
      const result = await this.#source.dead(
        databaseAutomationDeliveryLease(claim),
        'AUTOMATION_FUNCTION_UNAVAILABLE',
        this.#timestamp(),
      );
      if (result === 'stale') {
        this.#event({ type: 'lease-lost', attempt: claim.attemptCount });
        return 'leaseLost';
      }
      this.#event({
        type: 'dead-lettered',
        attempt: claim.attemptCount,
        reason: 'function-unavailable',
      });
      return 'dead';
    }
    if (claim.manifestFingerprint !== this.#registry.fingerprint) {
      this.#event({ type: 'manifest-drift', attempt: claim.attemptCount });
    }

    const outcome = await executeDatabaseAutomationDelivery({
      source: this.#source,
      definition: definition as DurableDatabaseFunctionDefinition<any, any, TServices>,
      provider: this.#services,
      claim,
      leaseMs: this.#leaseMs,
      renewIntervalMs: this.#renewIntervalMs,
      timeoutMs: this.#executionTimeoutMs,
      shutdownSignal: this.#shutdown.signal,
      now: () => this.#timestamp(),
    });
    if (outcome.cleanupFailed) {
      this.#event({
        type: 'service-cleanup-failed',
        attempt: claim.attemptCount,
      });
    }
    if (outcome.status === 'lease-lost') {
      this.#event({ type: 'lease-lost', attempt: claim.attemptCount });
      return 'leaseLost';
    }
    if (outcome.status === 'abandoned') {
      this.#event({
        type: 'execution-abandoned',
        attempt: claim.attemptCount,
        reason: outcome.reason,
      });
      return 'abandoned';
    }

    if (outcome.error === null) {
      const completed = await this.#source.complete(
        databaseAutomationDeliveryLease(outcome.claim),
        this.#timestamp(),
      );
      if (completed === 'stale') {
        this.#event({ type: 'lease-lost', attempt: claim.attemptCount });
        return 'leaseLost';
      }
      this.#event({ type: 'completed', attempt: claim.attemptCount });
      return 'completed';
    }

    const now = this.#timestamp();
    const retry = await this.#source.retry(
      databaseAutomationDeliveryLease(outcome.claim),
      'AUTOMATION_HANDLER_FAILED',
      databaseAutomationRetryAt(now, outcome.claim.attemptCount),
      now,
    );
    if (retry === 'stale') {
      this.#event({ type: 'lease-lost', attempt: claim.attemptCount });
      return 'leaseLost';
    }
    if (retry === 'dead') {
      this.#event({
        type: 'dead-lettered',
        attempt: claim.attemptCount,
        reason: 'attempts-exhausted',
      });
      return 'dead';
    }
    this.#event({ type: 'retry-scheduled', attempt: claim.attemptCount });
    return 'retried';
  }

  #timestamp(): number {
    let value: unknown;
    try {
      value = this.#now();
    } catch (cause) {
      throw infrastructureError(cause);
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw infrastructureError();
    }
    return value;
  }

  #event(event: DatabaseAutomationDeliveryEvent): void {
    try {
      this.#emit?.(Object.freeze(event));
    } catch {
      // Telemetry cannot change delivery state.
    }
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum) {
    throw configInvalid(`Database automation ${field} is invalid.`);
  }
  return value as number;
}

function configInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message, {
    retryable: false,
    outcome: 'not-started',
    details: { component: 'database-automation-worker' },
  });
}

function closedError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CLOSED',
    'Database automation delivery worker is closed.',
  );
}

function infrastructureError(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database automation delivery clock failed.',
    {
      ...(cause === undefined ? {} : { cause }),
      retryable: false,
      outcome: 'not-started',
      details: { component: 'database-automation-worker' },
    },
  );
}
