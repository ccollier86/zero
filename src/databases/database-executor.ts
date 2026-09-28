/**
 * database-executor.ts
 *
 * Defines the backend-neutral request, lifecycle, and diagnostics contract for
 * database execution. Transport framing and process ownership live in concrete
 * executor implementations.
 */

import type { DatabaseErrorCode } from './database-error';

/** Portable values accepted by database executor request and response bodies. */
export type DatabaseExecutorValue =
  | null
  | undefined
  | boolean
  | number
  | bigint
  | string
  | Date
  | ArrayBuffer
  | Uint8Array
  | readonly DatabaseExecutorValue[]
  | { readonly [key: string]: DatabaseExecutorValue };

/** Commit semantics used when classifying an interrupted request. */
export type DatabaseExecutorOperationKind = 'read' | 'write';

/** One serializable unit of database work. */
export interface DatabaseExecutorRequest<
  Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
> {
  /** Stable operation name understood by the executor actor. */
  readonly operation: string;
  /** Writes receive an unknown outcome if their executor disappears in flight. */
  readonly kind: DatabaseExecutorOperationKind;
  /** Structured-clone-safe operation input. */
  readonly payload: Payload;
}

/** Per-operation execution policy. */
export interface DatabaseExecutorExecuteOptions {
  /** Override the executor's default operation deadline. */
  readonly timeoutMs?: number;
}

export type DatabaseExecutorState =
  | 'created'
  | 'starting'
  | 'ready'
  | 'draining'
  | 'closing'
  | 'failed'
  /** Termination deadlines elapsed without an observed authority boundary. */
  | 'quarantined'
  | 'closed';

/** Privacy-safe executor health snapshot. */
export interface DatabaseExecutorDiagnostics {
  readonly state: DatabaseExecutorState;
  readonly slot: number;
  readonly generation: number;
  readonly inFlight: number;
  readonly maxInFlight: number;
  readonly disconnectObserved: boolean;
  readonly exitObserved: boolean;
  /** True only after this exact executor generation can no longer commit work. */
  readonly settled: boolean;
  readonly exitCode: number | null;
  readonly signalCode: string | number | null;
  readonly lastFailureCode: DatabaseErrorCode | null;
}

/** Common contract implemented by local, subprocess, or future remote actors. */
export interface DatabaseExecutor extends AsyncDisposable {
  start(): Promise<void>;

  execute<
    Result extends DatabaseExecutorValue = DatabaseExecutorValue,
    Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
  >(
    request: DatabaseExecutorRequest<Payload>,
    options?: DatabaseExecutorExecuteOptions,
  ): Promise<Result>;

  /**
   * Resolve only after this exact executor generation can no longer execute or
   * commit work. This does not initiate shutdown and never treats a transport
   * disconnect alone as settlement.
   */
  settled(): Promise<void>;

  close(): Promise<void>;
  diagnostics(): DatabaseExecutorDiagnostics;
}
