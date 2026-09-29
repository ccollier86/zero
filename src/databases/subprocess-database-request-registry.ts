/**
 * subprocess-database-request-registry.ts
 *
 * Owns bounded request identifiers, in-flight promises, operation deadlines,
 * and drain coordination for one subprocess executor generation.
 */

import { DatabaseError } from './database-error';
import type {
  DatabaseExecutorOperationKind,
  DatabaseExecutorValue,
} from './database-executor';

interface PendingRequest {
  readonly kind: DatabaseExecutorOperationKind;
  readonly resolve: (value: DatabaseExecutorValue) => void;
  readonly reject: (error: DatabaseError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface DrainDeferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

export interface SubprocessDatabaseRequestAllocation {
  readonly requestId: number;
  readonly result: Promise<DatabaseExecutorValue>;
}

export interface SubprocessDatabaseRequestRegistryOptions {
  readonly generation: number;
  readonly slot: number;
  readonly maxInFlight: number;
  readonly onOperationTimeout: (error: DatabaseError) => void;
}

/** Bounded pending-request ownership for one executor generation. */
export class SubprocessDatabaseRequestRegistry {
  readonly maxInFlight: number;

  private readonly generation: number;
  private readonly slot: number;
  private readonly onOperationTimeout: (error: DatabaseError) => void;
  private readonly pending = new Map<number, PendingRequest>();
  private drainDeferred: DrainDeferred | null = null;
  private nextRequestId = 1;

  constructor(options: SubprocessDatabaseRequestRegistryOptions) {
    this.generation = options.generation;
    this.slot = options.slot;
    this.maxInFlight = options.maxInFlight;
    this.onOperationTimeout = options.onOperationTimeout;
  }

  get size(): number {
    return this.pending.size;
  }

  assertCapacity(): void {
    if (this.pending.size < this.maxInFlight) return;
    throw new DatabaseError(
      'DATABASE_BACKPRESSURE',
      'Database executor capacity is exhausted.',
      {
        details: {
          generation: this.generation,
          maxInFlight: this.maxInFlight,
          slot: this.slot,
        },
      },
    );
  }

  register(
    kind: DatabaseExecutorOperationKind,
    timeoutMs: number,
  ): SubprocessDatabaseRequestAllocation {
    this.assertCapacity();

    const requestId = this.allocateRequestId();
    const result = new Promise<DatabaseExecutorValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handleOperationTimeout(requestId);
      }, timeoutMs);
      this.pending.set(requestId, {
        kind,
        resolve,
        reject,
        timer,
      });
    });
    return { requestId, result };
  }

  has(requestId: number): boolean {
    return this.pending.has(requestId);
  }

  resolve(requestId: number, value: DatabaseExecutorValue): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    pending.resolve(value);
    return true;
  }

  reject(requestId: number, error: DatabaseError): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    pending.reject(error);
    return true;
  }

  rejectAll(error: DatabaseError): void {
    for (const requestId of [...this.pending.keys()]) {
      this.reject(requestId, error);
    }
  }

  rejectForTransportFailure(phase: string): void {
    for (const [requestId, pending] of [...this.pending]) {
      this.reject(requestId, new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database executor failed while an operation was in flight.',
        {
          outcome: pending.kind === 'write' ? 'unknown' : null,
          retryable: false,
          details: {
            generation: this.generation,
            phase,
            slot: this.slot,
          },
        },
      ));
    }
  }

  waitForDrain(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();
    this.drainDeferred ??= createDrainDeferred();
    return this.drainDeferred.promise;
  }

  private handleOperationTimeout(requestId: number): void {
    const pending = this.take(requestId);
    if (!pending) return;
    const error = new DatabaseError(
      'DATABASE_OPERATION_TIMEOUT',
      'Database executor operation timed out.',
      {
        outcome: pending.kind === 'write' ? 'unknown' : null,
        retryable: false,
        details: {
          generation: this.generation,
          slot: this.slot,
        },
      },
    );
    pending.reject(error);
    this.onOperationTimeout(error);
  }

  private take(requestId: number): PendingRequest | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (this.pending.size === 0) {
      const drain = this.drainDeferred;
      this.drainDeferred = null;
      drain?.resolve();
    }
    return pending;
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database executor request identifier space is exhausted.',
      );
    }
    this.nextRequestId += 1;
    return requestId;
  }
}

function createDrainDeferred(): DrainDeferred {
  let settled = false;
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
  };
}
