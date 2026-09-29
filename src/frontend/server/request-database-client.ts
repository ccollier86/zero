/**
 * Request/background projection for an actor-backed tenant database.
 *
 * The physical binding is derived exclusively from a framework-owned service
 * scope. Each public operation owns one short-lived coordinator lease so an
 * abandoned request cannot pin an actor indefinitely. The projected client
 * exposes neither the DatabaseManager nor any database/tenant selector.
 */

import type { ServiceDataScope } from '../../auth/service-data-scope';
import { DatabaseError } from '../../databases/database-error';
import type { DatabaseManager } from '../../databases/database-manager';
import type { ResourceTenantDatabaseAccess } from '../../resources/resource-crud-service';
import type {
  AsyncDatabaseClient,
  DatabaseBatchInput,
  DatabaseCommitResult,
  DatabaseFindInput,
  DatabaseFindRows,
  DatabaseListPage,
  DatabaseListPageOptions,
  DatabaseMutation,
  DatabaseMutationOptions,
  DatabaseOperationRow,
  DatabaseReadOptions,
  DatabaseReadResult,
  DatabaseSerializableValue,
} from '../../databases/database-operations';

export interface CreateRequestDatabaseClientOptions {
  /** App-local infrastructure owner. It is retained privately, never exposed. */
  readonly manager: DatabaseManager | null;
  /** Framework-derived committed scope; request input must never populate it. */
  readonly scope: ServiceDataScope;
  /** Durable live-authority fence captured with the request/background scope. */
  readonly assertCurrentAuthoritySync: () => void;
}

/**
 * Project the tenant file for a committed scope, or null when this app/scope
 * does not use tenant-database isolation.
 */
export function createRequestDatabaseClient(
  options: CreateRequestDatabaseClientOptions,
): AsyncDatabaseClient | null {
  const { manager, scope, assertCurrentAuthoritySync } = options;
  if (!manager
    || scope.scopeKind !== 'tenant'
    || !manager.diagnostics().tenantDatabasesEnabled) return null;

  // Preserve the runtime return value. DatabaseManager/AsyncDatabaseClient
  // deliberately reject promises and other non-undefined values even when a
  // JavaScript caller bypasses this TypeScript contract.
  const assertCurrentAuthority = (): undefined => (
    assertCurrentAuthoritySync() as undefined
  );

  return new RequestDatabaseClient(
    manager,
    scope.tenantId,
    assertCurrentAuthority,
  );
}

/**
 * @internal Acquire one request-owned Resource capability.
 *
 * Unlike the public request client above, this keeps one physical binding for
 * receipt lookup, pre-read, policy work, commit, and canonical result handling.
 * The caller must release it in a `finally` block. The trusted writer is never
 * projected onto `zero.data` or the public AsyncDatabaseClient surface.
 */
export async function createResourceTenantDatabaseAccess(
  options: CreateRequestDatabaseClientOptions,
): Promise<ResourceTenantDatabaseAccess | null> {
  const { manager, scope, assertCurrentAuthoritySync } = options;
  if (!manager
    || scope.scopeKind !== 'tenant'
    || !manager.diagnostics().tenantDatabasesEnabled) return null;

  const assertCurrentAuthority = (): undefined => (
    assertCurrentAuthoritySync() as undefined
  );
  const binding = await manager.bindTenant({
    tenantId: scope.tenantId,
    assertCurrentAuthoritySync: assertCurrentAuthority,
    assertCurrentReadAuthority: assertCurrentAuthority,
  });
  let released = false;
  return Object.freeze({
    client: binding.client,
    trustedWriter: binding.trustedWriter,
    release: () => {
      if (released) return;
      released = true;
      binding.release();
    },
  });
}

class RequestDatabaseClient implements AsyncDatabaseClient {
  readonly #manager: DatabaseManager;
  readonly #tenantId: string;
  readonly #assertCurrentAuthority: () => undefined;

  constructor(
    manager: DatabaseManager,
    tenantId: string,
    assertCurrentAuthority: () => undefined,
  ) {
    this.#manager = manager;
    this.#tenantId = tenantId;
    this.#assertCurrentAuthority = assertCurrentAuthority;
    Object.freeze(this);
  }

  async get(
    table: string,
    id: string,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseOperationRow | null>> {
    return await this.#withBinding((client) => client.get(table, id, options));
  }

  async list(
    table: string,
    page: DatabaseListPageOptions,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseListPage>> {
    return await this.#withBinding((client) => client.list(table, page, options));
  }

  async find(
    table: string,
    input: DatabaseFindInput,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseFindRows>> {
    return await this.#withBinding((client) => client.find(table, input, options));
  }

  async query(
    name: string,
    input: DatabaseSerializableValue,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseSerializableValue>> {
    return await this.#withBinding((client) => client.query(name, input, options));
  }

  async mutate(
    mutation: DatabaseMutation,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult> {
    return await this.#withBinding((client) => client.mutate(mutation, options));
  }

  async batch(
    input: DatabaseBatchInput,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult> {
    return await this.#withBinding((client) => client.batch(input, options));
  }

  async command(
    name: string,
    input: DatabaseSerializableValue,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult<DatabaseSerializableValue>> {
    return await this.#withBinding((client) => client.command(name, input, options));
  }

  async #withBinding<T>(
    operation: (client: AsyncDatabaseClient) => Promise<T>,
  ): Promise<T> {
    const binding = await this.#manager.bindTenant({
      tenantId: this.#tenantId,
      assertCurrentAuthoritySync: this.#assertCurrentAuthority,
      assertCurrentReadAuthority: this.#assertCurrentAuthority,
    });
    try {
      const result = await operation(binding.client);
      // The bound actor client fences reads after its own await, but resolving
      // that promise yields once more before this request-facing wrapper can
      // expose the result. Close that continuation window for both reads and
      // canonical write results without reflecting authority callback errors.
      this.#assertFinalAuthority();
      return result;
    } finally {
      binding.release();
    }
  }

  #assertFinalAuthority(): void {
    let result: unknown;
    try {
      result = this.#assertCurrentAuthority();
    } catch {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Tenant database authority changed before result delivery.',
        { retryable: false, outcome: null },
      );
    }
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Tenant database authority checks must be synchronous.',
        { retryable: false, outcome: null },
      );
    }
  }
}
