/**
 * Trusted routing boundary for actor-backed named and tenant databases.
 *
 * The application-level manager owns process lifecycle. This collaborator
 * owns physical actor selection, Guardian eligibility/authority admission,
 * and the opaque capabilities returned to request and Sync consumers.
 */

import type { IdentityAnchorState } from '../auth/identity-projection-types';
import type { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  deriveNamedDatabaseId,
  deriveTenantDatabaseId,
} from './database-binding-ref';
import { createAsyncDatabaseClient } from './database-client';
import {
  assertDatabaseCommitAuthorityCurrent,
  createDatabaseCommitAuthority,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import {
  type DatabaseCoordinator,
  type DatabaseCoordinatorDiagnostics,
  type DatabaseCoordinatorLease,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import { createDatabaseRef, type DatabaseId } from './database-file';
import type {
  BindTenantDatabaseOptions,
  DatabaseTenantEligibilityOptions,
  DatabaseTenantIdentityProjectionOptions,
  TenantDatabaseBinding,
  TenantDatabaseSyncBinding,
} from './database-manager-contract';
import {
  DatabaseTenantIdentityProjectionAdmission,
} from './database-tenant-identity-projection-admission';
import type {
  AsyncDatabaseClient,
  AsyncDatabaseOperationExecutor,
} from './database-operations';
import type { DatabaseTrustedWriteExecutor } from './database-trusted-writer';

/** @internal Validated options supplied only by DatabaseManager. */
export interface DatabaseManagerActorRouterOptions {
  readonly coordinator: DatabaseCoordinator | null;
  readonly authority: AuthorityCommitCoordinator | null;
  readonly tenantDatabases: boolean;
  readonly tenantIdentityProjection: DatabaseTenantIdentityProjectionOptions | null;
  readonly tenantDatabaseEligibility: DatabaseTenantEligibilityOptions | null;
}

/** @internal Actor-backed routing kept separate from pinned-plane lifecycle. */
export class DatabaseManagerActorRouter {
  readonly #coordinator: DatabaseCoordinator | null;
  readonly #authority: AuthorityCommitCoordinator | null;
  readonly #tenantDatabases: boolean;
  readonly #identityProjection: DatabaseTenantIdentityProjectionAdmission;
  readonly #tenantDatabaseEligibility: DatabaseTenantEligibilityOptions | null;

  constructor(options: DatabaseManagerActorRouterOptions) {
    this.#coordinator = options.coordinator;
    this.#authority = options.authority;
    this.#tenantDatabases = options.tenantDatabases;
    this.#identityProjection = new DatabaseTenantIdentityProjectionAdmission(
      options.tenantIdentityProjection,
    );
    this.#tenantDatabaseEligibility = options.tenantDatabaseEligibility;
  }

  get multipleEnabled(): boolean {
    return this.#coordinator !== null;
  }

  get tenantDatabasesEnabled(): boolean {
    return this.#tenantDatabases;
  }

  start(): void {
    this.#coordinator?.start();
  }

  async close(): Promise<void> {
    await this.#coordinator?.close();
  }

  diagnostics(): DatabaseCoordinatorDiagnostics | null {
    return this.#coordinator?.diagnostics() ?? null;
  }

  /** Privileged setup/operator binding for one explicit named database. */
  async acquireNamed(input: string): Promise<DatabaseCoordinatorLease> {
    const coordinator = this.#requireCoordinator();
    const physicalId = deriveNamedDatabaseId(input);
    // A tenant-file coordinator may require authority for every write. Named
    // setup bindings are already privileged, so bind an internal live proof.
    const commitAuthority = this.#tenantDatabases
      ? createDatabaseCommitAuthority(
          this.#requireAuthority(),
          physicalId,
          () => undefined,
        )
      : undefined;
    return await coordinator.acquire(physicalId, {
      ...(commitAuthority ? { commitAuthority } : {}),
    });
  }

  /** Bind one request/background capability from trusted tenant authority. */
  async bindTenant(
    options: BindTenantDatabaseOptions,
  ): Promise<TenantDatabaseBinding> {
    const { physicalId, authority } = this.#resolveTenantBinding(options);
    const lease = await this.#requireCoordinator().acquire(physicalId, {
      commitAuthority: authority,
    });
    try {
      await this.#identityProjection.reconcile(options.tenantId, lease);
      const client = createAsyncDatabaseClient({
        executor: createLeaseExecutor(lease),
        assertReadAuthority: options.assertCurrentReadAuthority
          ?? options.assertCurrentAuthoritySync,
      });
      return new BoundTenantDatabase(lease, client);
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  /** Bind the persistent capability consumed by the tenant Zero Sync plane. */
  async bindTenantSync(
    options: BindTenantDatabaseOptions,
  ): Promise<TenantDatabaseSyncBinding> {
    const { physicalId, authority } = this.#resolveTenantBinding(options);
    const coordinator = this.#requireCoordinator();
    const readinessLease = await coordinator.acquire(physicalId, {
      commitAuthority: authority,
    });
    try {
      await this.#identityProjection.reconcile(options.tenantId, readinessLease);
    } finally {
      readinessLease.release();
    }
    return await coordinator.acquireTenantSync(physicalId, {
      commitAuthority: authority,
      ...(options.assertCurrentReadAuthority === undefined
        ? {}
        : { assertReadAuthority: options.assertCurrentReadAuthority }),
    });
  }

  /** Provision/reconcile one authoritative tenant target for lifecycle work. */
  async ensureTenantIdentityProjection(tenantId: string): Promise<void> {
    if (!this.#identityProjection.enabled) return;
    this.#assertTenantDatabaseEligible(tenantId);
    const physicalId = deriveTenantDatabaseId(tenantId);
    const authority = createDatabaseCommitAuthority(
      this.#requireAuthority(),
      physicalId,
      () => undefined,
    );
    const lease = await this.#requireCoordinator().acquire(physicalId, {
      commitAuthority: authority,
    });
    try {
      await this.#identityProjection.reconcile(tenantId, lease);
    } finally {
      lease.release();
    }
  }

  /** Inspect one existing tenant target without creating or reconciling it. */
  async inspectTenantIdentityProjection(
    tenantId: string,
  ): Promise<IdentityAnchorState | null> {
    if (!this.#identityProjection.enabled) return null;
    this.#assertTenantDatabaseEligible(tenantId);
    const physicalId = deriveTenantDatabaseId(tenantId);
    const authority = createDatabaseCommitAuthority(
      this.#requireAuthority(),
      physicalId,
      () => undefined,
    );
    const lease = await this.#requireCoordinator().acquireExisting(physicalId, {
      commitAuthority: authority,
    });
    if (!lease) return null;
    try {
      return await this.#identityProjection.inspect(tenantId, lease);
    } finally {
      lease.release();
    }
  }

  #requireCoordinator(): DatabaseCoordinator {
    if (!this.#coordinator) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Multiple databases are not enabled.',
      );
    }
    return this.#coordinator;
  }

  #requireAuthority(): AuthorityCommitCoordinator {
    if (!this.#authority) {
      throw configInvalid('Database authority coordinator is unavailable.');
    }
    return this.#authority;
  }

  #resolveTenantBinding(options: BindTenantDatabaseOptions): Readonly<{
    physicalId: DatabaseId;
    authority: DatabaseCommitAuthority;
  }> {
    if (!this.#tenantDatabases) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Tenant database isolation is not enabled.',
      );
    }
    if (!options || typeof options !== 'object'
      || typeof options.tenantId !== 'string'
      || options.tenantId.length === 0
      || typeof options.assertCurrentAuthoritySync !== 'function'
      || (options.assertCurrentReadAuthority !== undefined
        && typeof options.assertCurrentReadAuthority !== 'function')) {
      throw configInvalid('Tenant database authority is invalid.');
    }

    this.#assertTenantDatabaseEligible(options.tenantId);

    const physicalId = deriveTenantDatabaseId(options.tenantId);
    const authorityOwner = this.#requireAuthority();
    const authority = createDatabaseCommitAuthority(
      authorityOwner,
      physicalId,
      options.assertCurrentAuthoritySync,
    );
    // Reject an already-revoked request before actor admission can reserve a
    // slot or create an otherwise unused tenant file. Operation dispatch still
    // performs the authoritative check again at the writer FIFO head.
    assertDatabaseCommitAuthorityCurrent(
      authority,
      authorityOwner,
      createDatabaseRef(physicalId),
    );
    assertTenantReadAuthorityCurrent(options.assertCurrentReadAuthority);
    return Object.freeze({ physicalId, authority });
  }

  #assertTenantDatabaseEligible(tenantId: string): void {
    const eligibility = this.#tenantDatabaseEligibility;
    if (!eligibility) return;
    try {
      const result: unknown = eligibility.assertEligible(tenantId);
      if (result === undefined) return;
      void Promise.resolve(result).catch(() => undefined);
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
    }
    throw new DatabaseError(
      'DATABASE_AUTHORITY_CHANGED',
      'Tenant database eligibility changed before binding.',
      { retryable: false, outcome: 'not-started' },
    );
  }
}

function assertTenantReadAuthorityCurrent(
  check: (() => undefined) | undefined,
): void {
  if (!check) return;
  let result: unknown;
  try {
    result = check();
  } catch {
    throw new DatabaseError(
      'DATABASE_AUTHORITY_CHANGED',
      'Database read authority changed before binding.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw configInvalid('Database read authority checks must be synchronous.');
  }
}

class BoundTenantDatabase implements TenantDatabaseBinding {
  readonly #lease: DatabaseCoordinatorLease;
  readonly #client: AsyncDatabaseClient;
  #released = false;

  constructor(
    lease: DatabaseCoordinatorLease,
    client: AsyncDatabaseClient,
  ) {
    this.#lease = lease;
    this.#client = client;
    Object.preventExtensions(this);
  }

  get client(): AsyncDatabaseClient { return this.#client; }
  get trustedWriter(): DatabaseTrustedWriteExecutor {
    return this.#lease.trustedWriter;
  }
  get released(): boolean { return this.#released; }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#lease.release();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.release();
  }
}

function createLeaseExecutor(
  lease: DatabaseCoordinatorLease,
): AsyncDatabaseOperationExecutor {
  return {
    execute(operation, options) {
      return lease.execute(operation, options);
    },
  } as AsyncDatabaseOperationExecutor;
}

function configInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message);
}
