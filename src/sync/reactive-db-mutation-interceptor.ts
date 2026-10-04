/**
 * Same-transaction interception for canonical ReactiveDB mutations.
 *
 * This is deliberately a narrow mechanism. It does not select tables, run
 * asynchronous work, or define automation policy. A higher-level subsystem
 * may use the one registered interceptor to perform additional synchronous
 * writes before the root SQLite transaction commits.
 */

import type { ReactiveDB } from './reactive-db';
import type { Change } from './types';
import { cloneChange } from './reactive-db-change-codec';
import { isReactiveDBPromiseLike } from './reactive-db-synchronous-boundary';
import {
  assertReactiveDBTransactionTokenActive,
  type ReactiveDBTransactionToken,
} from './reactive-db-transaction-token';

export type ReactiveDBReadOnlyValue =
  | string
  | number
  | boolean
  | null
  | ReactiveDBReadOnlyRow
  | readonly ReactiveDBReadOnlyValue[];

export interface ReactiveDBReadOnlyRow {
  readonly [field: string]: ReactiveDBReadOnlyValue;
}

/** Deeply immutable canonical mutation snapshot. */
export interface ReactiveDBMutationChange {
  readonly seq: number;
  readonly table: string;
  readonly op: Change['op'];
  readonly rowId: string;
  readonly row: ReactiveDBReadOnlyRow | null;
  readonly previousRow: ReactiveDBReadOnlyRow | null;
  readonly ts: number;
}

/** Input delivered synchronously after durable change recording. */
export interface ReactiveDBMutationInterception {
  readonly change: ReactiveDBMutationChange;

  /**
   * Opaque identity shared by nested and cascaded mutations in this root
   * transaction. Retaining it after the callback grants no continued access.
   */
  readonly transactionToken: ReactiveDBTransactionToken;
}

/**
 * Same-transaction mutation hook. Throwing, returning a Promise, or returning
 * a thenable rejects the complete root transaction.
 */
export type ReactiveDBMutationInterceptor = (
  interception: ReactiveDBMutationInterception,
) => unknown;

const activeHosts = new WeakSet<object>();
const interceptors = new WeakMap<object, ReactiveDBMutationInterceptor>();

/** @internal Admit a fully constructed ReactiveDB as an interceptor host. */
export function initializeReactiveDBMutationInterceptorHost(db: ReactiveDB): void {
  if (activeHosts.has(db)) {
    throw new Error('ReactiveDB mutation interceptor host is already active');
  }
  activeHosts.add(db);
}

/**
 * Register the sole same-transaction mutation interceptor for a live database.
 *
 * Registration is identity-safe: the returned remover cannot detach a later
 * replacement, is idempotent, and remains safe after database disposal.
 */
export function registerReactiveDBMutationInterceptor(
  db: ReactiveDB,
  interceptor: ReactiveDBMutationInterceptor,
): () => void {
  if (!activeHosts.has(db)) {
    throw new Error('ReactiveDB mutation interceptor target is not active');
  }
  if (typeof interceptor !== 'function') {
    throw new TypeError('ReactiveDB mutation interceptor must be a function');
  }
  if (interceptors.has(db)) {
    throw new Error('ReactiveDB already has a mutation interceptor');
  }

  interceptors.set(db, interceptor);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    if (interceptors.get(db) === interceptor) {
      interceptors.delete(db);
    }
  };
}

/** @internal Invoke the current interceptor from inside the writer transaction. */
export function invokeReactiveDBMutationInterceptor(
  db: ReactiveDB,
  change: Change,
  transactionToken: ReactiveDBTransactionToken,
): void {
  const interceptor = interceptors.get(db);
  if (!interceptor) return;

  assertReactiveDBTransactionTokenActive(transactionToken);
  const result = interceptor(Object.freeze({
    change: createReadOnlyChange(change),
    transactionToken,
  }));
  if (isReactiveDBPromiseLike(result)) {
    void Promise.resolve(result).catch(() => {});
    throw new Error('ReactiveDB mutation interceptors must be synchronous');
  }
}

/** @internal Seal a host and release any registered interceptor reference. */
export function disposeReactiveDBMutationInterceptorHost(db: ReactiveDB): void {
  interceptors.delete(db);
  activeHosts.delete(db);
}

function createReadOnlyChange(change: Change): ReactiveDBMutationChange {
  return deepFreeze(cloneChange(change)) as unknown as ReactiveDBMutationChange;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
