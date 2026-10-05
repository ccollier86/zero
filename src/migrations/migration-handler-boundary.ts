/** Admits and executes synchronous migration handlers without premature success. */
import type { Database } from 'bun:sqlite';
import type { MigrationDirection } from './types';

/** Stable, input-free handler contract error; never carries SQL or a database path. */
export class MigrationHandlerError extends Error {
  readonly code = 'MIGRATION_HANDLER_INVALID' as const;
  constructor(readonly direction: MigrationDirection) {
    super('Migration handlers must be synchronous functions.');
    this.name = 'MigrationHandlerError';
  }
}

export function assertSynchronousMigrationHandler(
  handler: unknown,
  direction: MigrationDirection,
): asserts handler is (database: Database) => unknown {
  if (typeof handler !== 'function'
    || Object.prototype.toString.call(handler) === '[object AsyncFunction]'
    || Object.prototype.toString.call(handler) === '[object GeneratorFunction]'
    || Object.prototype.toString.call(handler) === '[object AsyncGeneratorFunction]') {
    throw new MigrationHandlerError(direction);
  }
}

/** Must be invoked inside the migration transaction, before ledger/history success. */
export function runSynchronousMigrationHandler(
  handler: (database: Database) => unknown,
  database: Database,
  direction: MigrationDirection,
  receiver?: object,
): void {
  const result = Reflect.apply(handler, receiver, [database]);
  if (result !== null
    && (typeof result === 'object' || typeof result === 'function')
    && typeof Reflect.get(result, 'then') === 'function') {
    // Observe rejection without awaiting work outside SQLite's sync boundary.
    // Throwing now rolls back changes made in this attempt before the yield.
    void Promise.resolve(result).catch(() => undefined);
    throw new MigrationHandlerError(direction);
  }
}
