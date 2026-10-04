/**
 * Trusted routing boundary for actor-backed named and tenant databases.
 *
 * The application-level manager owns process lifecycle. This collaborator
 * owns physical actor selection, Guardian eligibility/authority admission,
 * and the opaque capabilities returned to request and Sync consumers.
 */

import type { IdentityAnchorState } from '../auth/identity-projection-types';
import type {
  DatabaseAutomationSourceRecord,
  DatabaseAutomationSourceRegistration,
} from '../database-automations/automation-source-catalog-contract';
import type {
  DatabaseAutomationSourceCatalog,
} from '../database-automations/automation-source-catalog-store';
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
import {
  createDatabaseRef,
  normalizeDatabaseId,
  type DatabaseId,
} from './database-file';
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
  readonly automationSourceCatalog: DatabaseAutomationSourceCatalog | null;
}

/** @internal Actor-backed routing kept separate from pinned-plane lifecycle. */
export class DatabaseManagerActorRouter {
  readonly #coordinator: DatabaseCoordinator | null;
  readonly #authority: AuthorityCommitCoordinator | null;
  readonly #tenantDatabases: boolean;
  readonly #identityProjection: DatabaseTenantIdentityProjectionAdmission;
  readonly #tenantDatabaseEligibility: DatabaseTenantEligibilityOptions | null;
  readonly #automationSourceCatalog: DatabaseAutomationSourceCatalog | null;
  readonly #realmHasDurableFunctions: boolean;

  constructor(options: DatabaseManagerActorRouterOptions) {
    this.#coordinator = options.coordinator;
    this.#authority = options.authority;
    this.#tenantDatabases = options.tenantDatabases;
    this.#identityProjection = new DatabaseTenantIdentityProjectionAdmission(
      options.tenantIdentityProjection,
    );
    this.#tenantDatabaseEligibility = options.tenantDatabaseEligibility;
    this.#automationSourceCatalog = options.automationSourceCatalog;
    this.#realmHasDurableFunctions = options.coordinator?.realm.automations
      ?.listFunctions()
      .some(({ mode }) => mode === 'durable') ?? false;
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
    const logicalSourceId = String(normalizeDatabaseId(input));
    // A tenant-file coordinator may require authority for every write. Named
    // setup bindings are already privileged, so bind an internal live proof.
    const commitAuthority = this.#tenantDatabases
      ? createDatabaseCommitAuthority(
          this.#requireAuthority(),
          physicalId,
          () => undefined,
        )
      : undefined;
    const lease = await coordinator.acquire(physicalId, {
      ...(commitAuthority ? { commitAuthority } : {}),
    });
    try {
      this.#registerReadySource(namedSource(
        createDatabaseRef(physicalId),
        logicalSourceId,
      ));
      return lease;
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  /** Bind one request/background capability from trusted tenant authority. */
  async bindTenant(
    options: BindTenantDatabaseOptions,
  ): Promise<TenantDatabaseBinding> {
    const { physicalId, logicalSourceId, authority } =
      this.#resolveTenantBinding(options);
    const lease = await this.#requireCoordinator().acquire(physicalId, {
      commitAuthority: authority,
    });
    try {
      this.#registerReadySource(tenantSource(
        createDatabaseRef(physicalId),
        logicalSourceId,
      ));
      // Registration must precede every post-open mutation. Identity
      // projection can itself touch an app table with an automation trigger;
      // cataloguing first prevents durable work from becoming undiscoverable
      // if projection or a later setup step fails.
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
    const { physicalId, logicalSourceId, authority } =
      this.#resolveTenantBinding(options);
    const coordinator = this.#requireCoordinator();
    const readinessLease = await coordinator.acquire(physicalId, {
      commitAuthority: authority,
    });
    try {
      this.#registerReadySource(tenantSource(
        createDatabaseRef(physicalId),
        logicalSourceId,
      ));
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
    const logicalSourceId = String(normalizeDatabaseId(tenantId));
    const authority = createDatabaseCommitAuthority(
      this.#requireAuthority(),
      physicalId,
      () => undefined,
    );
    const lease = await this.#requireCoordinator().acquire(physicalId, {
      commitAuthority: authority,
    });
    try {
      this.#registerReadySource(tenantSource(
        createDatabaseRef(physicalId),
        logicalSourceId,
      ));
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

  /** @internal Bind one catalog-proven existing source for host recovery. */
  async acquireAutomationSourceForRecovery(
    source: DatabaseAutomationSourceRecord,
  ): Promise<DatabaseCoordinatorLease | null> {
    if (!this.#realmHasDurableFunctions) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'The actor realm has no durable database functions.',
      );
    }
    const expected = this.#assertCatalogSourceCurrent(source);
    if (expected.sourceKind === 'application') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Application automation sources use the pinned database plane.',
      );
    }

    const physicalId = expected.sourceKind === 'named'
      ? deriveNamedDatabaseId(expected.logicalSourceId)
      : deriveTenantDatabaseId(expected.logicalSourceId);
    if (createDatabaseRef(physicalId) !== expected.sourceRef) {
      throw automationSourceAuthorityChanged();
    }

    let commitAuthority: DatabaseCommitAuthority | undefined;
    if (expected.sourceKind === 'tenant') {
      if (!this.#tenantDatabases) {
        throw new DatabaseError(
          'DATABASE_OPERATION_UNSUPPORTED',
          'Tenant database isolation is not enabled.',
        );
      }
      this.#assertTenantDatabaseEligible(expected.logicalSourceId);
      commitAuthority = createDatabaseCommitAuthority(
        this.#requireAuthority(),
        physicalId,
        () => {
          this.#assertCatalogSourceCurrent(expected);
          this.#assertTenantDatabaseEligible(expected.logicalSourceId);
          return undefined;
        },
      );
    } else if (this.#tenantDatabases) {
      commitAuthority = createDatabaseCommitAuthority(
        this.#requireAuthority(),
        physicalId,
        () => {
          this.#assertCatalogSourceCurrent(expected);
          return undefined;
        },
      );
    }

    const lease = await this.#requireCoordinator().acquireExisting(physicalId, {
      ...(commitAuthority ? { commitAuthority } : {}),
    });
    if (!lease) return null;
    try {
      if (commitAuthority) {
        assertDatabaseCommitAuthorityCurrent(
          commitAuthority,
          this.#requireAuthority(),
          createDatabaseRef(physicalId),
        );
      } else {
        this.#assertCatalogSourceCurrent(expected);
      }
      return lease;
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  /** @internal Revalidate one server-owned source before/after host effects. */
  assertAutomationSourceAuthorityCurrent(
    source: DatabaseAutomationSourceRecord,
  ): void {
    const current = this.#assertCatalogSourceCurrent(source);
    if (current.sourceKind !== 'tenant') return;
    if (!this.#tenantDatabases) throw automationSourceAuthorityChanged();
    this.#assertTenantDatabaseEligible(current.logicalSourceId);
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
    logicalSourceId: string;
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
    const logicalSourceId = String(normalizeDatabaseId(options.tenantId));
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
    return Object.freeze({ physicalId, logicalSourceId, authority });
  }

  #registerReadySource(registration: DatabaseAutomationSourceRegistration): void {
    if (!this.#realmHasDurableFunctions) return;
    const catalog = this.#requireAutomationSourceCatalog();
    catalog.register(registration);
  }

  #assertCatalogSourceCurrent(
    expected: DatabaseAutomationSourceRecord,
  ): DatabaseAutomationSourceRecord {
    const catalog = this.#requireAutomationSourceCatalog();
    let current: DatabaseAutomationSourceRecord | null;
    try {
      current = catalog.get(expected.sourceRef);
    } catch {
      throw automationSourceAuthorityChanged();
    }
    if (!current
      || expected.status !== 'active'
      || current.status !== 'active'
      || !sameAutomationSourceRecord(current, expected)) {
      throw automationSourceAuthorityChanged();
    }
    return current;
  }

  #requireAutomationSourceCatalog(): DatabaseAutomationSourceCatalog {
    if (!this.#automationSourceCatalog) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Durable database automation recovery is not configured.',
      );
    }
    return this.#automationSourceCatalog;
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

function namedSource(
  sourceRef: string,
  logicalSourceId: string,
): DatabaseAutomationSourceRegistration {
  return Object.freeze({
    sourceRef,
    sourceKind: 'named',
    logicalSourceId,
    authority: Object.freeze({
      scopeKind: 'application',
      scopeId: 'application',
      tenantId: null,
    }),
  });
}

function tenantSource(
  sourceRef: string,
  tenantId: string,
): DatabaseAutomationSourceRegistration {
  return Object.freeze({
    sourceRef,
    sourceKind: 'tenant',
    logicalSourceId: tenantId,
    authority: Object.freeze({
      scopeKind: 'tenant',
      scopeId: tenantId,
      tenantId,
    }),
  });
}

function sameAutomationSourceRecord(
  left: DatabaseAutomationSourceRecord,
  right: DatabaseAutomationSourceRecord,
): boolean {
  return left.sourceRef === right.sourceRef
    && left.sourceKind === right.sourceKind
    && left.logicalSourceId === right.logicalSourceId
    && left.authority.scopeKind === right.authority.scopeKind
    && left.authority.scopeId === right.authority.scopeId
    && left.authority.tenantId === right.authority.tenantId
    && left.status === right.status
    && left.revision === right.revision
    && left.ordinal === right.ordinal
    && left.registeredAt === right.registeredAt
    && left.updatedAt === right.updatedAt;
}

function automationSourceAuthorityChanged(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Database automation source authority changed before recovery.',
    { retryable: false, outcome: 'not-started' },
  );
}

function configInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message);
}
