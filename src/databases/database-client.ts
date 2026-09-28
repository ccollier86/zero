/**
 * Scope-bound ergonomic client for actor-backed databases.
 *
 * Routing lives in the injected executor capability. No method accepts a
 * database id, tenant id, path, raw SQL string, callback, or database handle.
 */

import {
  cloneDatabaseSerializableValue,
  type AsyncDatabaseClient,
  type AsyncDatabaseOperationExecutor,
  type DatabaseBatchInput,
  type DatabaseCommitResult,
  type DatabaseFindInput,
  type DatabaseFindRows,
  type DatabaseListPage,
  type DatabaseListPageOptions,
  type DatabaseMutation,
  type DatabaseMutationOptions,
  type DatabaseOperationExecutionOptions,
  type DatabaseOperationRow,
  type DatabaseReadOptions,
  type DatabaseReadResult,
  type DatabaseSerializableValue,
} from './database-operations';
import { DatabaseError } from './database-error';

export interface CreateAsyncDatabaseClientOptions {
  /** Already-bound internal capability; it owns all physical routing. */
  readonly executor: AsyncDatabaseOperationExecutor;
  /**
   * Optional live authority fence for reads. It runs immediately before actor
   * dispatch and again before yielded data is returned to application code.
   * Tenant-bound adapters must provide it; privileged named clients may omit it.
   */
  readonly assertReadAuthority?: () => undefined;
}

/** Create an opaque database client which cannot be rebound by its consumer. */
export function createAsyncDatabaseClient(
  options: CreateAsyncDatabaseClientOptions,
): AsyncDatabaseClient {
  if (!options || typeof options !== 'object'
    || !options.executor
    || typeof options.executor.execute !== 'function') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'A bound database executor is required.',
    );
  }
  if (options.assertReadAuthority !== undefined
    && typeof options.assertReadAuthority !== 'function') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database read-authority validation is invalid.',
    );
  }
  return new BoundAsyncDatabaseClient(
    options.executor,
    options.assertReadAuthority ?? null,
  );
}

class BoundAsyncDatabaseClient implements AsyncDatabaseClient {
  readonly #executor: AsyncDatabaseOperationExecutor;
  readonly #assertReadAuthority: (() => undefined) | null;

  constructor(
    executor: AsyncDatabaseOperationExecutor,
    assertReadAuthority: (() => undefined) | null,
  ) {
    this.#executor = executor;
    this.#assertReadAuthority = assertReadAuthority;
    Object.freeze(this);
  }

  async get(
    table: string,
    id: string,
    options: DatabaseReadOptions = {},
  ): Promise<DatabaseReadResult<DatabaseOperationRow | null>> {
    return await this.#read({
      type: 'get',
      table,
      id,
      ...readConsistency(options),
    }, executionOptions(options)) as DatabaseReadResult<DatabaseOperationRow | null>;
  }

  async list(
    table: string,
    page: DatabaseListPageOptions,
    options: DatabaseReadOptions = {},
  ): Promise<DatabaseReadResult<DatabaseListPage>> {
    return await this.#read({
      type: 'list',
      table,
      limit: page.limit,
      ...(page.after === undefined ? {} : { after: page.after }),
      ...readConsistency(options),
    }, executionOptions(options)) as DatabaseReadResult<DatabaseListPage>;
  }

  async find(
    table: string,
    input: DatabaseFindInput,
    options: DatabaseReadOptions = {},
  ): Promise<DatabaseReadResult<DatabaseFindRows>> {
    const normalized = normalizeFindInput(input);
    return await this.#read({
      type: 'find',
      table,
      ...(normalized.select === undefined ? {} : { select: normalized.select }),
      ...(normalized.filters === undefined ? {} : { filters: normalized.filters }),
      ...(normalized.order === undefined ? {} : { order: normalized.order }),
      limit: normalized.limit,
      ...(normalized.offset === undefined ? {} : { offset: normalized.offset }),
      ...readConsistency(options),
    }, executionOptions(options)) as DatabaseReadResult<DatabaseFindRows>;
  }

  async query(
    name: string,
    input: DatabaseSerializableValue,
    options: DatabaseReadOptions = {},
  ): Promise<DatabaseReadResult<DatabaseSerializableValue>> {
    return await this.#read({
      type: 'query',
      name,
      input,
      ...readConsistency(options),
    }, executionOptions(options));
  }

  async mutate(
    mutation: DatabaseMutation,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult> {
    return await this.#executor.execute({
      type: 'mutate',
      mutation,
      idempotencyKey: options.idempotencyKey,
    }, executionOptions(options)) as DatabaseCommitResult;
  }

  async batch(
    input: DatabaseBatchInput,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult> {
    return await this.#executor.execute({
      type: 'batch',
      ...(input.assertions === undefined ? {} : { assertions: input.assertions }),
      mutations: input.mutations,
      idempotencyKey: options.idempotencyKey,
    }, executionOptions(options)) as DatabaseCommitResult;
  }

  async command(
    name: string,
    input: DatabaseSerializableValue,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult<DatabaseSerializableValue>> {
    return await this.#executor.execute({
      type: 'command',
      name,
      input,
      idempotencyKey: options.idempotencyKey,
    }, executionOptions(options)) as DatabaseCommitResult;
  }

  async #read(
    operation: Parameters<AsyncDatabaseOperationExecutor['execute']>[0],
    options: DatabaseOperationExecutionOptions,
  ): Promise<DatabaseReadResult> {
    this.#assertCurrentReadAuthority('not-started');
    const result = await this.#executor.execute(operation, options);
    this.#assertCurrentReadAuthority(null);
    return result as DatabaseReadResult;
  }

  #assertCurrentReadAuthority(outcome: 'not-started' | null): void {
    if (!this.#assertReadAuthority) return;
    let result: unknown;
    try {
      result = this.#assertReadAuthority();
    } catch {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Database read authority changed during execution.',
        { retryable: false, outcome },
      );
    }
    if (result !== undefined) {
      // Runtime callers can bypass TypeScript. Observe any returned thenable so
      // rejecting async checks cannot surface as an unhandled rejection.
      void Promise.resolve(result).catch(() => undefined);
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database read-authority checks must be synchronous.',
        { retryable: false, outcome },
      );
    }
  }
}

function normalizeFindInput(value: unknown): DatabaseFindInput {
  const detached = cloneDatabaseSerializableValue(value);
  if (detached === null || Array.isArray(detached) || typeof detached !== 'object') {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database find input must be a plain object.',
    );
  }
  const allowed = new Set(['select', 'filters', 'order', 'limit', 'offset']);
  if (Object.keys(detached).some((field) => !allowed.has(field))) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database find input contains an unknown field.',
    );
  }
  return detached as unknown as DatabaseFindInput;
}

function readConsistency(
  options: DatabaseReadOptions,
): { readonly consistency?: DatabaseReadOptions['consistency'] } {
  return options.consistency === undefined
    ? {}
    : { consistency: options.consistency };
}

function executionOptions(
  options: DatabaseOperationExecutionOptions,
): DatabaseOperationExecutionOptions {
  return {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.queueTimeoutMs === undefined
      ? {}
      : { queueTimeoutMs: options.queueTimeoutMs }),
    ...(options.operationTimeoutMs === undefined
      ? {}
      : { operationTimeoutMs: options.operationTimeoutMs }),
  };
}
