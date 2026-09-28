/**
 * App-local ownership boundary for the compatibility database and optional
 * actor-backed file databases.
 *
 * This class is infrastructure, not a request capability. Request code gets
 * only an already-bound AsyncDatabaseClient produced by bindTenant().
 */

import { createHash } from 'node:crypto';

import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { createAsyncDatabaseClient } from './database-client';
import { createDatabaseCommitAuthority } from './database-commit-authority';
import {
  DatabaseCoordinator,
  type DatabaseCoordinatorDiagnostics,
  type DatabaseCoordinatorLease,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import {
  normalizeDatabaseId,
  type DatabaseId,
} from './database-file';
import type {
  AsyncDatabaseClient,
  AsyncDatabaseOperationExecutor,
} from './database-operations';
import {
  DatabaseRuntime,
  type DatabaseRuntimeRole,
} from './database-runtime';

const NAMED_BINDING_DOMAIN = 'zero.named-database-binding.v1\0';
const TENANT_BINDING_DOMAIN = 'zero.tenant-database-binding.v1\0';

export type DatabaseManagerState =
  | 'created'
  | 'started'
  | 'draining'
  | 'close-failed'
  | 'closed';

export interface MultipleDatabaseManagerOptions {
  /** Actor-backed owner for every non-default physical database. */
  readonly coordinator: DatabaseCoordinator;
  /** The same gate supplied to the coordinator when tenant files are enabled. */
  readonly authorityCommitCoordinator?: AuthorityCommitCoordinator;
  /** Enables auth-derived tenant bindings and requires the authority gate. */
  readonly tenantDatabases?: boolean;
}

export interface DatabaseManagerOptions {
  /** Pinned compatibility runtime used by zero.db and zero.sql. */
  readonly defaultRuntime: DatabaseRuntime;
  /** Omit to preserve historical single-database behavior exactly. */
  readonly multiple?: MultipleDatabaseManagerOptions;
}

export interface BindTenantDatabaseOptions {
  /** Trusted tenant identity from a committed authorization scope. */
  readonly tenantId: string;
  /** Synchronous durable authority check used at the writer FIFO head. */
  readonly assertCurrentAuthoritySync: () => undefined;
  /** Read fence run before dispatch and before data is returned. */
  readonly assertCurrentReadAuthority?: () => undefined;
}

/** Opaque ownership token for one already-routed tenant client. */
export interface TenantDatabaseBinding extends AsyncDisposable {
  readonly client: AsyncDatabaseClient;
  readonly released: boolean;
  release(): void;
}

export interface DatabaseManagerDiagnostics {
  readonly state: DatabaseManagerState;
  readonly multipleEnabled: boolean;
  readonly tenantDatabasesEnabled: boolean;
  readonly default: Readonly<{
    readonly role: DatabaseRuntimeRole;
    readonly started: boolean;
    readonly closed: boolean;
  }>;
  readonly coordinator: DatabaseCoordinatorDiagnostics | null;
  readonly authority: ReturnType<AuthorityCommitCoordinator['diagnostics']> | null;
}

/**
 * Owns startup/shutdown order and trusted routing for all database planes.
 * It deliberately exposes no named SQLite, ReactiveDB, path, or runtime.
 */
export class DatabaseManager implements AsyncDisposable {
  readonly defaultRuntime: DatabaseRuntime;

  readonly #coordinator: DatabaseCoordinator | null;
  readonly #authority: AuthorityCommitCoordinator | null;
  readonly #tenantDatabases: boolean;
  #state: DatabaseManagerState = 'created';
  #closeTask: Promise<void> | null = null;

  constructor(options: DatabaseManagerOptions) {
    if (!options || typeof options !== 'object'
      || !(options.defaultRuntime instanceof DatabaseRuntime)) {
      throw configInvalid('Database manager requires a default runtime.');
    }
    if (options.defaultRuntime.role !== 'default'
      || options.defaultRuntime.diagnostics().closed) {
      throw configInvalid('Database manager default runtime is invalid.');
    }

    const multiple = options.multiple;
    if (multiple !== undefined && (!multiple || typeof multiple !== 'object')) {
      throw configInvalid('Multiple-database configuration is invalid.');
    }
    if (multiple && !(multiple.coordinator instanceof DatabaseCoordinator)) {
      throw configInvalid('Multiple-database coordinator is invalid.');
    }
    if (multiple?.authorityCommitCoordinator !== undefined
      && !(multiple.authorityCommitCoordinator instanceof AuthorityCommitCoordinator)) {
      throw configInvalid('Database authority coordinator is invalid.');
    }
    if (multiple?.tenantDatabases !== undefined
      && typeof multiple.tenantDatabases !== 'boolean') {
      throw configInvalid('Tenant-database policy is invalid.');
    }
    if (multiple?.tenantDatabases === true
      && !multiple.authorityCommitCoordinator) {
      throw configInvalid('Tenant databases require an authority coordinator.');
    }

    this.defaultRuntime = options.defaultRuntime;
    this.#coordinator = multiple?.coordinator ?? null;
    this.#authority = multiple?.authorityCommitCoordinator ?? null;
    this.#tenantDatabases = multiple?.tenantDatabases ?? false;
  }

  /** Start the pinned runtime and claim the actor database root. */
  start(): void {
    if (this.#state === 'started') return;
    if (this.#state !== 'created') throw closedError();
    try {
      this.defaultRuntime.start();
      this.#coordinator?.start();
      this.#state = 'started';
    } catch (error) {
      this.#state = 'close-failed';
      throw error;
    }
  }

  /**
   * Privileged setup/operator binding for an explicit named database.
   * Never project this method into an ordinary request service facade.
   */
  async acquireNamed(input: string): Promise<DatabaseCoordinatorLease> {
    this.#assertStarted();
    const coordinator = this.#requireCoordinator();
    const physicalId = deriveBindingId(NAMED_BINDING_DOMAIN, input);
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
    this.#assertStarted();
    if (!this.#tenantDatabases) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Tenant database isolation is not enabled.',
      );
    }
    if (!options || typeof options !== 'object'
      || typeof options.assertCurrentAuthoritySync !== 'function'
      || (options.assertCurrentReadAuthority !== undefined
        && typeof options.assertCurrentReadAuthority !== 'function')) {
      throw configInvalid('Tenant database authority is invalid.');
    }

    const physicalId = deriveBindingId(TENANT_BINDING_DOMAIN, options.tenantId);
    const authorityCoordinator = this.#requireAuthority();
    const authority = createDatabaseCommitAuthority(
      authorityCoordinator,
      physicalId,
      options.assertCurrentAuthoritySync,
    );
    const lease = await this.#requireCoordinator().acquire(physicalId, {
      commitAuthority: authority,
    });
    try {
      const executor = createLeaseExecutor(lease);
      const client = createAsyncDatabaseClient({
        executor,
        assertReadAuthority: options.assertCurrentReadAuthority
          ?? options.assertCurrentAuthoritySync,
      });
      return new BoundTenantDatabase(lease, client);
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  /** Drain actors, then authority leases, then the default database. */
  close(): Promise<void> {
    if (this.#state === 'closed') return Promise.resolve();
    if (this.#closeTask) return this.#closeTask;
    const task = this.#closeOnce();
    this.#closeTask = task;
    void task.catch(() => {
      if (this.#closeTask === task) this.#closeTask = null;
    });
    return task;
  }

  diagnostics(): DatabaseManagerDiagnostics {
    const defaultDiagnostics = this.defaultRuntime.diagnostics();
    return Object.freeze({
      state: this.#state,
      multipleEnabled: this.#coordinator !== null,
      tenantDatabasesEnabled: this.#tenantDatabases,
      default: Object.freeze({
        role: defaultDiagnostics.role,
        started: defaultDiagnostics.started,
        closed: defaultDiagnostics.closed,
      }),
      coordinator: this.#coordinator?.diagnostics() ?? null,
      authority: this.#authority?.diagnostics() ?? null,
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async #closeOnce(): Promise<void> {
    this.#state = 'draining';
    if (this.#coordinator) {
      await this.#coordinator.close();
      if (this.#coordinator.diagnostics().heldAuthorityLeases > 0) {
        // Settlement proof failed closed. Begin gate drain to reject new work,
        // but retain the default control plane for a later operator retry.
        void this.#authority?.close().catch(() => undefined);
        this.#state = 'close-failed';
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database authority settlement is incomplete.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    }
    if (this.#authority) await this.#authority.close();
    this.defaultRuntime.close();
    this.#state = 'closed';
  }

  #assertStarted(): void {
    if (this.#state !== 'started') throw closedError();
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

function deriveBindingId(domain: string, input: string): DatabaseId {
  let logicalId: DatabaseId;
  try {
    logicalId = normalizeDatabaseId(input);
  } catch {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database binding identity is invalid.',
    );
  }
  const digest = createHash('sha256')
    .update(domain, 'utf8')
    .update(logicalId, 'utf8')
    .digest('hex');
  return normalizeDatabaseId(`binding-v1-${digest}`);
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

function closedError(): DatabaseError {
  return new DatabaseError('DATABASE_CLOSED', 'Database manager is not accepting work.');
}
