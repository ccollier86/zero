/**
 * authority-commit-coordinator.ts
 *
 * Coordinates the narrow commit boundary between independent tenant writers
 * and control-plane authority mutations. Tenant commits take shared leases;
 * authority mutations take exclusive leases. The coordinator owns scheduling
 * only and deliberately has no knowledge of databases, tenants, or sessions.
 */

import { DatabaseError } from './database-error';
import { DATABASE_OBSERVABILITY_COUNT_MAX } from './database-capacity';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';

const DEFAULT_MAX_PENDING = 1_024;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;

/** Lifecycle visible through privacy-safe diagnostics. */
export type AuthorityCommitCoordinatorState =
  | 'open'
  | 'draining'
  | 'closed';

/** Lease kind used at the commit boundary. */
export type AuthorityCommitLeaseMode = 'shared' | 'exclusive';

/** Construction policy for the bounded coordinator queue. */
export interface AuthorityCommitCoordinatorOptions {
  /** Maximum number of blocked acquisitions retained in memory. */
  readonly maxPending?: number;
  /** Default deadline for a blocked acquisition. */
  readonly acquireTimeoutMs?: number;
}

/** Per-acquisition cancellation and deadline policy. */
export interface AuthorityCommitAcquireOptions {
  /** Cancels only an acquisition that has not yet been granted. */
  readonly signal?: AbortSignal;
  /** Overrides the coordinator's default blocked-acquisition deadline. */
  readonly timeoutMs?: number;
}

/** An explicitly owned commit-boundary lease. */
export interface AuthorityCommitLease {
  readonly mode: AuthorityCommitLeaseMode;
  readonly released: boolean;
  /** Idempotently leave the commit boundary. */
  release(): void;
}

/** Privacy-safe scheduler state for lifecycle and saturation reporting. */
export interface AuthorityCommitCoordinatorDiagnostics {
  readonly state: AuthorityCommitCoordinatorState;
  readonly activeShared: number;
  readonly activeExclusive: boolean;
  readonly pendingShared: number;
  readonly pendingExclusive: number;
  readonly maxPending: number;
  readonly acquireTimeoutMs: number;
}

interface PendingAcquisition {
  readonly mode: AuthorityCommitLeaseMode;
  readonly resolve: (lease: AuthorityCommitLease) => void;
  readonly reject: (error: DatabaseError) => void;
  readonly signal: AbortSignal | undefined;
  abortListener: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

interface DrainDeferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

/**
 * App-local writer-preferring shared/exclusive commit coordinator.
 *
 * Preference is intentionally precise: existing shared holders may finish,
 * but after an exclusive acquisition queues, later shared acquisitions cannot
 * join them. Arrival order is retained for work already waiting ahead of that
 * exclusive acquisition.
 */
export class AuthorityCommitCoordinator {
  private readonly maxPending: number;
  private readonly acquireTimeoutMs: number;
  private readonly pending: PendingAcquisition[] = [];
  private state: AuthorityCommitCoordinatorState = 'open';
  private activeShared = 0;
  private activeExclusive = false;
  private drainDeferred: DrainDeferred | null = null;

  constructor(options: AuthorityCommitCoordinatorOptions = {}) {
    this.maxPending = normalizePositiveSafeInteger(
      options.maxPending ?? DEFAULT_MAX_PENDING,
      'maxPending',
      DATABASE_OBSERVABILITY_COUNT_MAX,
    );
    this.acquireTimeoutMs = normalizePositiveSafeInteger(
      options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
      'acquireTimeoutMs',
      MAX_RUNTIME_TIMER_INTERVAL_MS,
    );
  }

  /** Acquire a lease for one tenant-database commit boundary. */
  acquireShared(
    options: AuthorityCommitAcquireOptions = {},
  ): Promise<AuthorityCommitLease> {
    return this.acquire('shared', options);
  }

  /** Acquire a lease for one control-plane authority mutation boundary. */
  acquireExclusive(
    options: AuthorityCommitAcquireOptions = {},
  ): Promise<AuthorityCommitLease> {
    return this.acquire('exclusive', options);
  }

  /**
   * Acquire the shared side on the current stack, or return null when an
   * authority mutation owns or is already waiting for the boundary.
   *
   * SQLite commit guards cannot await while a transaction is open. A null
   * result therefore tells the application transaction to roll back and let
   * the caller reauthorize/retry after the authority mutation settles.
   */
  tryAcquireShared(): AuthorityCommitLease | null {
    if (this.state !== 'open') throw closedError();
    if (!this.canGrantImmediately('shared')) return null;
    return this.grant('shared');
  }

  /**
   * Acquire the exclusive side on the current stack, or return null when a
   * tenant commit or earlier waiter already owns priority.
   *
   * This is used immediately before a synchronous SQLite control-plane
   * transaction commits. It never waits while that transaction holds locks:
   * the caller must roll the transaction back and retry when null is returned.
   */
  tryAcquireExclusive(): AuthorityCommitLease | null {
    if (this.state !== 'open') throw closedError();
    if (!this.canGrantImmediately('exclusive')) return null;
    return this.grant('exclusive');
  }

  /**
   * Stop admission, reject every queued acquisition, and wait for granted
   * leases to be explicitly released by their owners.
   */
  drain(): Promise<void> {
    if (this.drainDeferred) return this.drainDeferred.promise;

    this.drainDeferred = createDrainDeferred();
    this.state = 'draining';
    const pending = this.pending.splice(0);
    for (const acquisition of pending) {
      this.rejectPending(acquisition, closedError());
    }
    this.finishDrainIfIdle();
    return this.drainDeferred.promise;
  }

  /** Close has the same ownership-safe semantics as drain. */
  close(): Promise<void> {
    return this.drain();
  }

  diagnostics(): AuthorityCommitCoordinatorDiagnostics {
    let pendingShared = 0;
    let pendingExclusive = 0;
    for (const acquisition of this.pending) {
      if (acquisition.mode === 'shared') pendingShared += 1;
      else pendingExclusive += 1;
    }

    return Object.freeze({
      state: this.state,
      activeShared: this.activeShared,
      activeExclusive: this.activeExclusive,
      pendingShared,
      pendingExclusive,
      maxPending: this.maxPending,
      acquireTimeoutMs: this.acquireTimeoutMs,
    });
  }

  private acquire(
    mode: AuthorityCommitLeaseMode,
    options: AuthorityCommitAcquireOptions,
  ): Promise<AuthorityCommitLease> {
    // Lifecycle wins over caller policy so every acquisition attempted after
    // drain begins observes the same stable closed contract.
    if (this.state !== 'open') {
      return Promise.reject(closedError());
    }

    let timeoutMs: number;
    try {
      timeoutMs = normalizePositiveSafeInteger(
        options.timeoutMs ?? this.acquireTimeoutMs,
        'timeoutMs',
        MAX_RUNTIME_TIMER_INTERVAL_MS,
      );
    } catch (error) {
      return Promise.reject(error);
    }

    const signal = options.signal;
    // Option getters are not trusted to be inert at a public JavaScript
    // boundary; re-check admission before changing coordinator ownership.
    if (this.state !== 'open') {
      return Promise.reject(closedError());
    }
    if (signal?.aborted) {
      return Promise.reject(abortedError());
    }
    if (this.canGrantImmediately(mode)) {
      return Promise.resolve(this.grant(mode));
    }
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Authority commit coordinator capacity is exhausted.',
        { details: { maxPending: this.maxPending } },
      ));
    }

    return new Promise<AuthorityCommitLease>((resolve, reject) => {
      const acquisition: PendingAcquisition = {
        mode,
        resolve,
        reject,
        signal,
        abortListener: null,
        timer: null,
        settled: false,
      };

      this.pending.push(acquisition);
      if (acquisition.signal) {
        acquisition.abortListener = () => {
          this.cancelPending(acquisition, abortedError());
        };
        acquisition.signal.addEventListener(
          'abort',
          acquisition.abortListener,
          { once: true },
        );
      }
      acquisition.timer = setTimeout(() => {
        this.cancelPending(acquisition, timeoutError(timeoutMs));
      }, timeoutMs);

      // A real AbortSignal cannot dispatch between the pre-check and listener
      // registration on this synchronous stack, but this closes the boundary
      // for already-aborted or adversarial signal-like implementations.
      if (acquisition.signal?.aborted) {
        this.cancelPending(acquisition, abortedError());
        return;
      }
      this.pump();
    });
  }

  private canGrantImmediately(mode: AuthorityCommitLeaseMode): boolean {
    if (this.pending.length > 0 || this.activeExclusive) return false;
    return mode === 'shared' || this.activeShared === 0;
  }

  private pump(): void {
    if (this.state !== 'open' || this.activeExclusive) return;

    if (this.activeShared > 0) {
      this.grantLeadingShared();
      return;
    }

    const first = this.pending[0];
    if (!first) return;
    if (first.mode === 'exclusive') {
      this.pending.shift();
      this.resolvePending(first, this.grant('exclusive'));
      return;
    }
    this.grantLeadingShared();
  }

  private grantLeadingShared(): void {
    while (this.pending[0]?.mode === 'shared') {
      const acquisition = this.pending.shift();
      if (!acquisition) return;
      this.resolvePending(acquisition, this.grant('shared'));
    }
  }

  private grant(mode: AuthorityCommitLeaseMode): AuthorityCommitLease {
    if (mode === 'shared') this.activeShared += 1;
    else this.activeExclusive = true;

    let released = false;
    return Object.freeze({
      mode,
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        this.release(mode);
      },
    });
  }

  private release(mode: AuthorityCommitLeaseMode): void {
    if (mode === 'shared') {
      if (this.activeShared <= 0) {
        throw new Error('Authority commit coordinator shared lease underflow.');
      }
      this.activeShared -= 1;
    } else {
      if (!this.activeExclusive) {
        throw new Error('Authority commit coordinator exclusive lease underflow.');
      }
      this.activeExclusive = false;
    }

    if (this.state === 'open') this.pump();
    else this.finishDrainIfIdle();
  }

  private cancelPending(
    acquisition: PendingAcquisition,
    error: DatabaseError,
  ): void {
    if (acquisition.settled) return;
    const index = this.pending.indexOf(acquisition);
    if (index < 0) return;
    this.pending.splice(index, 1);
    this.rejectPending(acquisition, error);
    this.pump();
  }

  private resolvePending(
    acquisition: PendingAcquisition,
    lease: AuthorityCommitLease,
  ): void {
    if (acquisition.settled) {
      lease.release();
      return;
    }
    acquisition.settled = true;
    cleanupPending(acquisition);
    acquisition.resolve(lease);
  }

  private rejectPending(
    acquisition: PendingAcquisition,
    error: DatabaseError,
  ): void {
    if (acquisition.settled) return;
    acquisition.settled = true;
    cleanupPending(acquisition);
    acquisition.reject(error);
  }

  private finishDrainIfIdle(): void {
    if (this.state !== 'draining'
      || this.activeShared > 0
      || this.activeExclusive) {
      return;
    }
    this.state = 'closed';
    this.drainDeferred?.resolve();
  }
}

function cleanupPending(acquisition: PendingAcquisition): void {
  if (acquisition.timer) {
    clearTimeout(acquisition.timer);
    acquisition.timer = null;
  }
  if (acquisition.signal && acquisition.abortListener) {
    acquisition.signal.removeEventListener('abort', acquisition.abortListener);
    acquisition.abortListener = null;
  }
}

function normalizePositiveSafeInteger(
  value: unknown,
  name: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) <= 0
    || (value as number) > maximum) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Authority commit coordinator ${name} is outside its supported range.`,
      { details: { option: name } },
    );
  }
  return value as number;
}

function closedError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CLOSED',
    'Authority commit coordinator is closed.',
  );
}

function abortedError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_QUEUE_TIMEOUT',
    'Authority commit lease acquisition was cancelled.',
    { details: { reason: 'aborted' } },
  );
}

function timeoutError(timeoutMs: number): DatabaseError {
  return new DatabaseError(
    'DATABASE_QUEUE_TIMEOUT',
    'Authority commit lease acquisition timed out.',
    { details: { reason: 'deadline-exceeded', timeoutMs } },
  );
}

function createDrainDeferred(): DrainDeferred {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  let settled = false;
  return {
    promise,
    resolve() {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
  };
}
