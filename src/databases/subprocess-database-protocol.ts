/**
 * subprocess-database-protocol.ts
 *
 * Portable, versioned Bun IPC envelopes shared by parent executors and actor
 * servers. This module contains no process lifecycle or database behavior.
 */

import type { SerializedDatabaseError } from './database-error';
import type {
  DatabaseExecutorOperationKind,
  DatabaseExecutorValue,
} from './database-executor';

/** Wire discriminator shared by the parent transport and subprocess actor. */
export const DATABASE_EXECUTOR_PROTOCOL_KIND = 'zero.database-executor' as const;

/** Current subprocess IPC protocol version. */
export const DATABASE_EXECUTOR_PROTOCOL_VERSION = 3 as const;

export interface DatabaseExecutorProtocolIdentity {
  readonly protocol: typeof DATABASE_EXECUTOR_PROTOCOL_KIND;
  readonly version: typeof DATABASE_EXECUTOR_PROTOCOL_VERSION;
  readonly nonce: string;
  readonly role: string;
  readonly slot: number;
  readonly generation: number;
}

export interface DatabaseExecutorHandshakeMessage
  extends DatabaseExecutorProtocolIdentity {
  readonly type: 'handshake';
}

export interface DatabaseExecutorOperationMessage<
  Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
> extends DatabaseExecutorProtocolIdentity {
  readonly type: 'request';
  readonly requestId: number;
  readonly operation: string;
  readonly operationKind: DatabaseExecutorOperationKind;
  readonly payload: Payload;
}

export interface DatabaseExecutorShutdownMessage
  extends DatabaseExecutorProtocolIdentity {
  readonly type: 'shutdown';
}

/** Messages accepted by a subprocess actor. */
export type SubprocessDatabaseExecutorCommand =
  | DatabaseExecutorHandshakeMessage
  | DatabaseExecutorOperationMessage
  | DatabaseExecutorShutdownMessage;

export interface DatabaseExecutorReadyMessage
  extends DatabaseExecutorProtocolIdentity {
  readonly type: 'ready';
}

export interface DatabaseExecutorSuccessMessage<
  Value extends DatabaseExecutorValue = DatabaseExecutorValue,
> extends DatabaseExecutorProtocolIdentity {
  readonly type: 'response';
  readonly requestId: number;
  readonly ok: true;
  readonly value: Value;
}

export interface DatabaseExecutorFailureMessage
  extends DatabaseExecutorProtocolIdentity {
  readonly type: 'response';
  readonly requestId: number;
  readonly ok: false;
  readonly error: SerializedDatabaseError;
}

export interface DatabaseExecutorShutdownAckMessage
  extends DatabaseExecutorProtocolIdentity {
  readonly type: 'shutdown-ack';
}

/** Exact, payload-free durability lifecycle signals emitted by a bound actor. */
export interface DatabaseExecutorTelemetryMessage
  extends DatabaseExecutorProtocolIdentity {
  readonly type: 'telemetry';
  readonly signal:
    | 'hot-periodic-snapshot-started'
    | 'hot-periodic-snapshot-finished'
    | 'hot-periodic-durability-dirty'
    | 'hot-periodic-durability-clean'
    | 'hot-periodic-durability-failed';
}

/** Messages emitted by a subprocess actor. */
export type SubprocessDatabaseExecutorEvent =
  | DatabaseExecutorReadyMessage
  | DatabaseExecutorSuccessMessage
  | DatabaseExecutorFailureMessage
  | DatabaseExecutorTelemetryMessage
  | DatabaseExecutorShutdownAckMessage;
