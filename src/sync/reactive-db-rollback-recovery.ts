import { isReactiveDBPromiseLike } from './reactive-db-synchronous-boundary';

type RollbackRecovery = () => unknown;

const recoveriesByTransactionOwner = new WeakMap<
  object,
  RollbackRecovery[]
>();

/** Open the rollback-recovery queue for one outer ReactiveDB transaction. */
export function beginReactiveDBRollbackRecoveryScope(owner: object): void {
  if (recoveriesByTransactionOwner.has(owner)) {
    throw new Error('ReactiveDB rollback recovery scope is already active');
  }
  recoveriesByTransactionOwner.set(owner, []);
}

/** Discard recovery work after a successful commit or runtime teardown. */
export function discardReactiveDBRollbackRecoveries(owner: object): void {
  recoveriesByTransactionOwner.delete(owner);
}

/**
 * Register trusted synchronous recovery for the current outer transaction.
 *
 * This module is deliberately absent from the public Sync barrel. Recovery
 * runs after ReactiveDB leaves the failed transaction and may open a fresh
 * transaction to persist safety state that must survive the rollback.
 */
export function registerReactiveDBRollbackRecovery(
  owner: object,
  recovery: RollbackRecovery,
): void {
  if (typeof recovery !== 'function') {
    throw new TypeError('ReactiveDB rollback recovery must be a function');
  }
  const recoveries = recoveriesByTransactionOwner.get(owner);
  if (!recoveries) {
    throw new Error(
      'ReactiveDB rollback recovery requires an active transaction',
    );
  }
  recoveries.push(recovery);
}

/** Take and synchronously run recovery work after the failed transaction. */
export function runReactiveDBRollbackRecoveries(owner: object): void {
  const recoveries = recoveriesByTransactionOwner.get(owner) ?? [];
  recoveriesByTransactionOwner.delete(owner);
  for (const recovery of recoveries) {
    const result = recovery();
    if (isReactiveDBPromiseLike(result)) {
      void Promise.resolve(result).catch(() => {});
      throw new Error('ReactiveDB rollback recovery must be synchronous');
    }
  }
}
