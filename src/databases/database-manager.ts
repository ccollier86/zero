/**
 * App-local ownership boundary for the system database, application database,
 * and optional actor-backed file databases.
 *
 * This class is infrastructure, not a request capability. Request code gets
 * only an already-bound AsyncDatabaseClient produced by bindTenant().
 */

import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  DatabaseAutomationSourceCatalog,
} from '../database-automations/automation-source-catalog-store';
import type {
  DatabaseAutomationSourceRecord,
} from '../database-automations/automation-source-catalog-contract';
import {
  DatabaseCoordinator,
  type DatabaseCoordinatorLease,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import { DatabaseManagerActorRouter } from './database-manager-actor-router';
import type {
  BindTenantDatabaseOptions,
  DatabaseManagerDiagnostics,
  DatabaseManagerOptions,
  DatabaseManagerState,
  TenantDatabaseBinding,
  TenantDatabaseSyncBinding,
} from './database-manager-contract';
import { DatabaseRuntime } from './database-runtime';
import { PinnedDatabaseRuntimes } from './pinned-database-runtimes';
import type { IdentityAnchorState } from '../auth/identity-projection-types';

interface DatabaseAutomationRecoveryBinding {
  readonly router: DatabaseManagerActorRouter;
  readonly assertStarted: () => void;
}

const databaseAutomationRecoveryBindings =
  new WeakMap<DatabaseManager, DatabaseAutomationRecoveryBinding>();

export type {
  BindTenantDatabaseOptions,
  DatabaseManagerDiagnostics,
  DatabaseManagerOptions,
  DatabaseManagerState,
  DatabaseTenantEligibilityOptions,
  DatabaseTenantIdentityProjectionOptions,
  MultipleDatabaseManagerOptions,
  TenantDatabaseBinding,
  TenantDatabaseSyncBinding,
} from './database-manager-contract';

/**
 * Owns startup/shutdown order and trusted routing for all database planes.
 * Process-pinned infrastructure runtimes are explicit; actor-backed named and
 * tenant runtimes are delegated to a narrow trusted router.
 */
export class DatabaseManager implements AsyncDisposable {
  readonly systemRuntime: DatabaseRuntime;
  readonly appRuntime: DatabaseRuntime;
  /** Compatibility alias retained for code which names the application plane default. */
  readonly defaultRuntime: DatabaseRuntime;

  readonly #pinnedRuntimes: PinnedDatabaseRuntimes;
  readonly #actorRouter: DatabaseManagerActorRouter;
  readonly #authority: AuthorityCommitCoordinator | null;
  readonly #automationSourceCatalog: DatabaseAutomationSourceCatalog | null;
  #state: DatabaseManagerState = 'created';
  #closeTask: Promise<void> | null = null;

  constructor(options: DatabaseManagerOptions) {
    if (!options || typeof options !== 'object'
      || !(options.systemRuntime instanceof DatabaseRuntime)
      || !(options.appRuntime instanceof DatabaseRuntime)) {
      throw configInvalid('Database manager requires system and application runtimes.');
    }
    if (options.systemRuntime === options.appRuntime) {
      throw configInvalid('Database manager runtimes must be separate.');
    }
    if (options.systemRuntime.role !== 'system'
      || options.systemRuntime.diagnostics().closed) {
      throw configInvalid('Database manager system runtime is invalid.');
    }
    if (options.appRuntime.role !== 'default'
      || options.appRuntime.diagnostics().closed) {
      throw configInvalid('Database manager application runtime is invalid.');
    }
    const serviceRuntimes = options.serviceRuntimes ?? [];
    if (!Array.isArray(serviceRuntimes)) {
      throw configInvalid('Database manager service runtimes are invalid.');
    }
    for (const binding of serviceRuntimes) {
      if (binding?.plane === 'system'
        || binding?.plane === 'application'
        || binding?.plane === 'default') {
        throw configInvalid('Database manager service runtime uses a reserved plane.');
      }
      if (binding?.runtime?.role !== 'service') {
        throw configInvalid('Database manager service runtimes must use the service role.');
      }
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
    if (options.authorityCommitCoordinator !== undefined
      && !(options.authorityCommitCoordinator instanceof AuthorityCommitCoordinator)) {
      throw configInvalid('Pinned database authority coordinator is invalid.');
    }
    if (options.authorityCommitCoordinator
      && multiple?.authorityCommitCoordinator
      && options.authorityCommitCoordinator !== multiple.authorityCommitCoordinator) {
      throw configInvalid('Database manager authority coordinators must match.');
    }
    if (options.automationSourceCatalog !== undefined
      && (!(options.automationSourceCatalog instanceof DatabaseAutomationSourceCatalog)
        || !options.automationSourceCatalog.isBoundToSystemRuntime(
          options.systemRuntime,
        ))) {
      throw configInvalid(
        'Database automation source catalog must use the manager system runtime.',
      );
    }
    if (multiple?.tenantDatabases !== undefined
      && typeof multiple.tenantDatabases !== 'boolean') {
      throw configInvalid('Tenant-database policy is invalid.');
    }
    if (multiple?.tenantDatabases === true
      && !multiple.authorityCommitCoordinator
      && !options.authorityCommitCoordinator) {
      throw configInvalid('Tenant databases require an authority coordinator.');
    }
    if (multiple?.tenantIdentityProjection !== undefined
      && (!multiple.tenantIdentityProjection
        || typeof multiple.tenantIdentityProjection.installationId !== 'string'
        || typeof multiple.tenantIdentityProjection.targetIdForTenant !== 'function'
        || typeof multiple.tenantIdentityProjection.reconcile !== 'function')) {
      throw configInvalid('Tenant identity projection configuration is invalid.');
    }
    if (multiple?.tenantIdentityProjection && multiple.tenantDatabases !== true) {
      throw configInvalid('Tenant identity projection requires tenant databases.');
    }
    if (multiple?.tenantDatabaseEligibility !== undefined
      && (!multiple.tenantDatabaseEligibility
        || typeof multiple.tenantDatabaseEligibility.assertEligible !== 'function')) {
      throw configInvalid('Tenant database eligibility configuration is invalid.');
    }
    if (multiple?.tenantDatabaseEligibility && multiple.tenantDatabases !== true) {
      throw configInvalid('Tenant database eligibility requires tenant databases.');
    }
    const actorRealmHasDurableFunctions = multiple?.coordinator.realm.automations
      ?.listFunctions()
      .some(({ mode }) => mode === 'durable') ?? false;
    if (actorRealmHasDurableFunctions && !options.automationSourceCatalog) {
      throw configInvalid(
        'Durable actor database functions require an automation source catalog.',
      );
    }

    this.systemRuntime = options.systemRuntime;
    this.appRuntime = options.appRuntime;
    this.defaultRuntime = options.appRuntime;
    this.#pinnedRuntimes = new PinnedDatabaseRuntimes([
      { plane: 'system', runtime: options.systemRuntime },
      { plane: 'application', runtime: options.appRuntime },
      ...serviceRuntimes,
    ]);
    this.#authority = options.authorityCommitCoordinator
      ?? multiple?.authorityCommitCoordinator
      ?? null;
    this.#automationSourceCatalog = options.automationSourceCatalog ?? null;
    this.#actorRouter = new DatabaseManagerActorRouter({
      coordinator: multiple?.coordinator ?? null,
      authority: this.#authority,
      tenantDatabases: multiple?.tenantDatabases ?? false,
      tenantIdentityProjection: multiple?.tenantIdentityProjection ?? null,
      tenantDatabaseEligibility: multiple?.tenantDatabaseEligibility ?? null,
      automationSourceCatalog: this.#automationSourceCatalog,
    });
    databaseAutomationRecoveryBindings.set(this, Object.freeze({
      router: this.#actorRouter,
      assertStarted: () => this.#assertStarted(),
    }));
  }

  /** Start system before application services, then claim the actor database root. */
  start(): void {
    if (this.#state === 'started') return;
    if (this.#state !== 'created') throw closedError();
    try {
      this.#pinnedRuntimes.start();
      this.#actorRouter.start();
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
    return await this.#actorRouter.acquireNamed(input);
  }

  /** Bind one request/background capability from trusted tenant authority. */
  async bindTenant(
    options: BindTenantDatabaseOptions,
  ): Promise<TenantDatabaseBinding> {
    this.#assertStarted();
    return await this.#actorRouter.bindTenant(options);
  }

  /** Bind the persistent, generation-aware capability consumed by Zero Sync. */
  async bindTenantSync(
    options: BindTenantDatabaseOptions,
  ): Promise<TenantDatabaseSyncBinding> {
    this.#assertStarted();
    return await this.#actorRouter.bindTenantSync(options);
  }

  /** Provision/reconcile one authoritative tenant target for lifecycle work. */
  async ensureTenantIdentityProjection(tenantId: string): Promise<void> {
    this.#assertStarted();
    await this.#actorRouter.ensureTenantIdentityProjection(tenantId);
  }

  /** Inspect one existing tenant target without creating or reconciling it. */
  async inspectTenantIdentityProjection(
    tenantId: string,
  ): Promise<IdentityAnchorState | null> {
    this.#assertStarted();
    return await this.#actorRouter.inspectTenantIdentityProjection(tenantId);
  }

  /** Drain actors, then authority leases, then pinned database planes. */
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
    const systemDiagnostics = this.systemRuntime.diagnostics();
    const appDiagnostics = this.appRuntime.diagnostics();
    const application = runtimeSummary(appDiagnostics);
    return Object.freeze({
      state: this.#state,
      multipleEnabled: this.#actorRouter.multipleEnabled,
      tenantDatabasesEnabled: this.#actorRouter.tenantDatabasesEnabled,
      system: runtimeSummary(systemDiagnostics),
      application,
      default: application,
      planes: this.#pinnedRuntimes.diagnostics(),
      coordinator: this.#actorRouter.diagnostics(),
      authority: this.#authority?.diagnostics() ?? null,
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async #closeOnce(): Promise<void> {
    this.#state = 'draining';
    try {
      await this.#actorRouter.close();
      if ((this.#actorRouter.diagnostics()?.heldAuthorityLeases ?? 0) > 0) {
        // Settlement proof failed closed. Begin gate drain to reject new work,
        // but retain all local planes for a later operator retry.
        void this.#authority?.close().catch(() => undefined);
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database authority settlement is incomplete.',
          { retryable: false, outcome: 'unknown' },
        );
      }
      this.#automationSourceCatalog?.close();
      if (this.#authority) await this.#authority.close();
      this.#pinnedRuntimes.close();
      this.#state = 'closed';
    } catch (error) {
      this.#state = 'close-failed';
      throw error;
    }
  }

  #assertStarted(): void {
    if (this.#state !== 'started') throw closedError();
  }
}

/**
 * @internal Acquire one catalog-proven existing actor source for host recovery.
 *
 * This helper is intentionally absent from the public databases barrel and
 * request service projections. The returned lease remains caller-owned.
 */
export async function acquireDatabaseAutomationSourceForRecovery(
  manager: DatabaseManager,
  source: DatabaseAutomationSourceRecord,
): Promise<DatabaseCoordinatorLease | null> {
  const binding = databaseAutomationRecoveryBindings.get(manager);
  if (!binding) {
    throw configInvalid('Database automation recovery manager is invalid.');
  }
  binding.assertStarted();
  return await binding.router.acquireAutomationSourceForRecovery(source);
}

/** @internal Revalidate catalog and tenant eligibility for one host effect. */
export function assertDatabaseAutomationSourceAuthorityCurrent(
  manager: DatabaseManager,
  source: DatabaseAutomationSourceRecord,
): void {
  const binding = databaseAutomationRecoveryBindings.get(manager);
  if (!binding) {
    throw configInvalid('Database automation authority manager is invalid.');
  }
  binding.assertStarted();
  binding.router.assertAutomationSourceAuthorityCurrent(source);
}

function runtimeSummary(
  diagnostics: ReturnType<DatabaseRuntime['diagnostics']>,
) {
  return Object.freeze({
    role: diagnostics.role,
    started: diagnostics.started,
    closed: diagnostics.closed,
  });
}

function configInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message);
}

function closedError(): DatabaseError {
  return new DatabaseError('DATABASE_CLOSED', 'Database manager is not accepting work.');
}
