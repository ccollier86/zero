/**
 * sync-mutation-receipts.ts
 *
 * Owns bounded, exact-ref promises for optimistic Sync mutations. It translates
 * protocol and client-lifecycle outcomes into safe public errors; it does not
 * queue writes, mutate the reactive store, or cancel writes after submission.
 */

import type { ChangeOp, SyncAckErrorCode } from '../types';

/** Default maximum time an async caller waits for an exact mutation receipt. */
export const SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS = 30_000;

/** Largest caller-selected receipt wait accepted by the browser client. */
export const SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS = 5 * 60_000;

/** Stable client-side failure codes for acknowledged Sync mutation methods. */
export const SYNC_MUTATION_ERROR_CODES = Object.freeze({
  serverRejected: 'SYNC_MUTATION_REJECTED',
  acknowledgmentTimeout: 'SYNC_MUTATION_ACK_TIMEOUT',
  waitTimeout: 'SYNC_MUTATION_WAIT_TIMEOUT',
  waitAborted: 'SYNC_MUTATION_WAIT_ABORTED',
  snapshotReplaced: 'SYNC_MUTATION_SNAPSHOT_REPLACED',
  clientReset: 'SYNC_MUTATION_CLIENT_RESET',
  clientDisconnected: 'SYNC_MUTATION_CLIENT_DISCONNECTED',
  authorizationScopeReplaced: 'SYNC_MUTATION_AUTHORIZATION_SCOPE_REPLACED',
  submissionFailed: 'SYNC_MUTATION_SUBMISSION_FAILED',
} as const);

export type SyncMutationErrorCode =
  (typeof SYNC_MUTATION_ERROR_CODES)[keyof typeof SYNC_MUTATION_ERROR_CODES];

/** Options for waiting on the authoritative receipt of one optimistic write. */
export interface SyncMutationWaitOptions {
  /**
   * Stops only this caller's wait. The already-submitted mutation can still be
   * accepted and committed by the server.
   */
  readonly signal?: AbortSignal;
  /**
   * Overall wait bound, including same-row queue time. Defaults to 30 seconds
   * and must not exceed five minutes.
   */
  readonly timeoutMs?: number;
}

/** Secret-free identity attached to a failed acknowledged mutation. */
export interface SyncMutationErrorDetails {
  readonly ref: string;
  readonly table: string;
  readonly op: ChangeOp;
  readonly rowId: string;
}

/**
 * Safe public error raised by `insertAsync`, `updateAsync`, and `deleteAsync`.
 *
 * `serverErrorCode` preserves the server's stable rejection code when one was
 * supplied. Raw server messages and thrown causes are intentionally omitted.
 */
export class SyncMutationError extends Error {
  readonly code: SyncMutationErrorCode;
  readonly serverErrorCode: SyncAckErrorCode | null;
  readonly ref: string;
  readonly table: string;
  readonly op: ChangeOp;
  readonly rowId: string;

  constructor(
    code: SyncMutationErrorCode,
    details: SyncMutationErrorDetails,
    serverErrorCode: SyncAckErrorCode | null = null,
  ) {
    super(syncMutationErrorMessage(code));
    this.name = 'SyncMutationError';
    this.code = code;
    this.serverErrorCode = serverErrorCode;
    this.ref = details.ref;
    this.table = details.table;
    this.op = details.op;
    this.rowId = details.rowId;
  }
}

/** Narrow a caught value to Zero's safe acknowledged-mutation error. */
export function isSyncMutationError(value: unknown): value is SyncMutationError {
  return value instanceof SyncMutationError;
}

export type SyncMutationReceiptDropCode = Extract<
  SyncMutationErrorCode,
  | 'SYNC_MUTATION_SNAPSHOT_REPLACED'
  | 'SYNC_MUTATION_CLIENT_RESET'
  | 'SYNC_MUTATION_CLIENT_DISCONNECTED'
  | 'SYNC_MUTATION_AUTHORIZATION_SCOPE_REPLACED'
>;

interface PendingReceipt {
  readonly details: SyncMutationErrorDetails;
  readonly resolve: () => void;
  readonly reject: (error: SyncMutationError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal | null;
  readonly abort: (() => void) | null;
}

export interface SyncMutationReceiptRegistration {
  readonly accepted: boolean;
  readonly promise: Promise<void>;
}

/** @internal Exact-ref receipt registry owned by one Sync mutation queue. */
export class SyncMutationReceipts {
  private readonly pending = new Map<string, PendingReceipt>();

  register(
    details: SyncMutationErrorDetails,
    options: SyncMutationWaitOptions = {},
  ): SyncMutationReceiptRegistration {
    const timeoutMs = resolveReceiptTimeout(options.timeoutMs);
    if (options.signal?.aborted) {
      return {
        accepted: false,
        promise: Promise.reject(new SyncMutationError(
          SYNC_MUTATION_ERROR_CODES.waitAborted,
          details,
        )),
      };
    }

    if (this.pending.has(details.ref)) {
      return {
        accepted: false,
        promise: Promise.reject(new SyncMutationError(
          SYNC_MUTATION_ERROR_CODES.submissionFailed,
          details,
        )),
      };
    }

    let resolvePromise!: () => void;
    let rejectPromise!: (error: SyncMutationError) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const signal = options.signal ?? null;
    const abort = signal
      ? () => this.reject(details.ref, SYNC_MUTATION_ERROR_CODES.waitAborted)
      : null;
    const timer = setTimeout(() => {
      this.reject(details.ref, SYNC_MUTATION_ERROR_CODES.waitTimeout);
    }, timeoutMs);
    this.pending.set(details.ref, {
      details,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
      signal,
      abort,
    });
    signal?.addEventListener('abort', abort!, { once: true });

    // Covers a signal aborted synchronously between the initial check and the
    // listener registration without ever submitting the associated mutation.
    if (signal?.aborted) {
      this.reject(details.ref, SYNC_MUTATION_ERROR_CODES.waitAborted);
      return { accepted: false, promise };
    }

    return { accepted: true, promise };
  }

  resolve(ref: string): void {
    const receipt = this.take(ref);
    receipt?.resolve();
  }

  reject(
    ref: string,
    code: SyncMutationErrorCode,
    serverErrorCode: SyncAckErrorCode | null = null,
  ): void {
    const receipt = this.take(ref);
    if (!receipt) return;
    receipt.reject(new SyncMutationError(code, receipt.details, serverErrorCode));
  }

  rejectAll(code: SyncMutationReceiptDropCode): void {
    for (const ref of [...this.pending.keys()]) this.reject(ref, code);
  }

  private take(ref: string): PendingReceipt | null {
    const receipt = this.pending.get(ref);
    if (!receipt) return null;
    this.pending.delete(ref);
    clearTimeout(receipt.timer);
    if (receipt.signal && receipt.abort) {
      receipt.signal.removeEventListener('abort', receipt.abort);
    }
    return receipt;
  }
}

function resolveReceiptTimeout(value: number | undefined): number {
  const timeoutMs = value ?? SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS) {
    throw new RangeError(
      `Sync mutation timeoutMs must be an integer from 1 through ${SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

function syncMutationErrorMessage(code: SyncMutationErrorCode): string {
  switch (code) {
    case SYNC_MUTATION_ERROR_CODES.serverRejected:
      return 'The server rejected the Sync mutation.';
    case SYNC_MUTATION_ERROR_CODES.acknowledgmentTimeout:
      return 'The Sync mutation was not acknowledged before its transport deadline.';
    case SYNC_MUTATION_ERROR_CODES.waitTimeout:
      return 'Timed out waiting for the Sync mutation receipt; the mutation may still commit.';
    case SYNC_MUTATION_ERROR_CODES.waitAborted:
      return 'Stopped waiting for the Sync mutation receipt; the mutation may still commit.';
    case SYNC_MUTATION_ERROR_CODES.snapshotReplaced:
      return 'The Sync mutation was dropped when its authoritative snapshot was replaced.';
    case SYNC_MUTATION_ERROR_CODES.clientReset:
      return 'The Sync mutation was dropped when the client was reset.';
    case SYNC_MUTATION_ERROR_CODES.clientDisconnected:
      return 'The Sync mutation was dropped when the client disconnected.';
    case SYNC_MUTATION_ERROR_CODES.authorizationScopeReplaced:
      return 'The Sync mutation was dropped when the authorization scope changed.';
    case SYNC_MUTATION_ERROR_CODES.submissionFailed:
      return 'The Sync mutation could not be submitted.';
  }
}
