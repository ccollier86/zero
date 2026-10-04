/**
 * Actor-local ownership and dispatch for one realm's database automations.
 *
 * The session installs transaction interception and owns the source-local
 * durable outbox. Host handler execution and Fabric routing remain outside the
 * database actor.
 */

import { DatabaseAutomationRuntime } from '../database-automations/database-automation-runtime';
import type { DatabaseAutomationRegistry } from '../database-automations/database-automations';
import type { SQLiteStorageMode } from '../persistence';
import type { ReactiveDB } from '../sync/reactive-db';
import { DatabaseError } from './database-error';
import type {
  DatabaseActorAutomationOutboxPayload,
  DatabaseActorAutomationOutboxResult,
} from './database-automation-actor-protocol';
import {
  validateDatabaseActorAutomationOutboxResult,
} from './database-automation-actor-protocol';

/** Construction inputs retained only inside one bound writer actor. */
export interface DatabaseActorAutomationSessionOptions {
  readonly db: ReactiveDB;
  readonly registry: DatabaseAutomationRegistry;
  readonly realmName: string;
  readonly realmFingerprint: string;
  readonly storageMode: SQLiteStorageMode;
  readonly readOnlyTables?: readonly string[];
}

/** Own and execute the narrow automation lifecycle for one writer binding. */
export class DatabaseActorAutomationSession {
  readonly #runtime: DatabaseAutomationRuntime;
  readonly #durableDeliveryEnabled: boolean;

  constructor(options: DatabaseActorAutomationSessionOptions) {
    this.#runtime = new DatabaseAutomationRuntime({
      db: options.db,
      registry: options.registry,
      realmName: options.realmName,
      realmFingerprint: options.realmFingerprint,
      storageMode: options.storageMode,
      outbox: { enabled: true },
      readOnlyTables: options.readOnlyTables,
    });
    this.#durableDeliveryEnabled = options.registry
      .listFunctions()
      .some(({ mode }) => mode === 'durable');
  }

  /** Execute one already-validated lifecycle request and validate its result. */
  execute(
    payload: DatabaseActorAutomationOutboxPayload,
  ): DatabaseActorAutomationOutboxResult {
    if (!this.#durableDeliveryEnabled) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'This database realm has no durable automation delivery source.',
      );
    }
    const result = this.#execute(payload);
    return validateDatabaseActorAutomationOutboxResult(payload, result);
  }

  /** Remove mutation interception before finalizing source-local statements. */
  close(): void {
    this.#runtime.close();
  }

  #execute(payload: DatabaseActorAutomationOutboxPayload): unknown {
    switch (payload.action) {
      case 'claim':
        return this.#runtime.claim(
          payload.leaseOwner,
          payload.now,
          payload.leaseMs,
        );
      case 'renew':
        return this.#runtime.renew(payload.lease, payload.now, payload.leaseMs);
      case 'complete':
        return this.#runtime.complete(payload.lease, payload.now);
      case 'retry':
        return this.#runtime.retry(
          payload.lease,
          payload.errorCode,
          payload.retryAt,
          payload.now,
        );
      case 'dead':
        return this.#runtime.dead(payload.lease, payload.errorCode, payload.now);
      case 'recover-expired':
        return this.#runtime.recoverExpired(payload.now);
      case 'counts': {
        const counts = this.#runtime.status().counts;
        if (counts === null) {
          throw new DatabaseError(
            'DATABASE_OPERATION_UNSUPPORTED',
            'This database realm has no durable automation delivery source.',
          );
        }
        return counts;
      }
    }
  }
}

/** Return the executor kind required by one closed automation action. */
export function databaseActorAutomationOperationKind(
  payload: DatabaseActorAutomationOutboxPayload,
): 'read' | 'write' {
  return payload.action === 'counts' ? 'read' : 'write';
}
