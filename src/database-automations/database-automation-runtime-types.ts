/**
 * database-automation-runtime-types.ts
 *
 * Defines actor-local composite runtime configuration and aggregate status.
 * It contains no persistence or execution logic.
 */

import type { SQLiteStorageMode } from '../persistence';
import type { ReactiveDB } from '../sync/reactive-db';
import type { DatabaseAutomationRegistry } from './database-automations';
import type {
  DatabaseAutomationOutboxCounts,
  DatabaseAutomationOutboxLimits,
} from './automation-outbox-contracts';
import type { DatabaseTransactionAutomationLimits } from './database-transaction-automation-runtime';

/** Explicit source-local outbox policy supplied by the actor composition root. */
export interface DatabaseAutomationOutboxPolicy {
  readonly enabled: boolean;
  readonly limits?: Partial<DatabaseAutomationOutboxLimits>;
}

/** Configuration for one actor-local automation runtime. */
export interface DatabaseAutomationRuntimeOptions {
  readonly db: ReactiveDB;
  readonly registry: DatabaseAutomationRegistry;
  readonly realmName: string;
  readonly realmFingerprint: string;
  readonly storageMode: SQLiteStorageMode;
  readonly outbox: DatabaseAutomationOutboxPolicy;
  readonly readOnlyTables?: readonly string[];
  readonly transactionLimits?: DatabaseTransactionAutomationLimits;
  readonly now?: () => number;
  readonly createId?: () => string;
}

/** Aggregate-only actor status; it never includes payloads or tenant values. */
export interface DatabaseAutomationRuntimeStatus {
  readonly outbox: 'disabled' | 'ready';
  readonly manifestFingerprint: string;
  readonly counts: DatabaseAutomationOutboxCounts | null;
}
