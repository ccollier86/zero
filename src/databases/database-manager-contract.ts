/** Public contracts for the application database ownership boundary. */

import type { IdentityProjectionTarget } from '../auth/identity-projection-types';
import type { DatabaseAutomationSourceCatalog } from '../database-automations/automation-source-catalog-store';
import type { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import type {
  DatabaseCoordinator,
  DatabaseCoordinatorDiagnostics,
} from './database-coordinator';
import type { AsyncDatabaseClient } from './database-operations';
import type { DatabaseRuntime, DatabaseRuntimeRole } from './database-runtime';
import type { DatabaseTenantSyncBinding } from './database-tenant-sync';
import type { DatabaseTrustedWriteExecutor } from './database-trusted-writer';
import type {
  PinnedDatabaseRuntimeBinding,
  PinnedDatabaseRuntimeDiagnostics,
} from './pinned-database-runtimes';

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
  /** Framework-owned Guardian admission for actor-backed tenant files. */
  readonly tenantIdentityProjection?: DatabaseTenantIdentityProjectionOptions;
  /** Framework-owned tenant-purpose admission checked before file creation. */
  readonly tenantDatabaseEligibility?: DatabaseTenantEligibilityOptions;
}

export interface DatabaseTenantEligibilityOptions {
  readonly assertEligible: (tenantId: string) => undefined;
}

export interface DatabaseTenantIdentityProjectionOptions {
  readonly installationId: string;
  readonly targetIdForTenant: (tenantId: string) => string;
  readonly reconcile: (
    tenantId: string,
    targetId: string,
    target: IdentityProjectionTarget,
  ) => Promise<void>;
}

export interface DatabaseManagerOptions {
  /** Zero-owned control-plane runtime used by Guardian and platform services. */
  readonly systemRuntime: DatabaseRuntime;
  /** Application runtime used by zero.db and zero.sql. */
  readonly appRuntime: DatabaseRuntime;
  /** Optional process-pinned service planes, started after the app plane. */
  readonly serviceRuntimes?: readonly PinnedDatabaseRuntimeBinding[];
  /** Shared/exclusive fence between the pinned system and application planes. */
  readonly authorityCommitCoordinator?: AuthorityCommitCoordinator;
  /**
   * Optional manager-owned durable source catalog bound to `systemRuntime`.
   * Required when an actor realm declares durable database functions.
   */
  readonly automationSourceCatalog?: DatabaseAutomationSourceCatalog;
  /** Omit when actor-backed databases are disabled. */
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
  /** @internal Framework logical-request receipt capability. */
  readonly trustedWriter: DatabaseTrustedWriteExecutor;
  readonly released: boolean;
  release(): void;
}

/** @internal Persistent tenant database capability reserved for Zero Sync. */
export type TenantDatabaseSyncBinding = DatabaseTenantSyncBinding;

export interface DatabaseManagerDiagnostics {
  readonly state: DatabaseManagerState;
  readonly multipleEnabled: boolean;
  readonly tenantDatabasesEnabled: boolean;
  readonly system: DatabaseRuntimeSummary;
  readonly application: DatabaseRuntimeSummary;
  /** Compatibility diagnostics alias for the application runtime. */
  readonly default: DatabaseRuntimeSummary;
  /** Ordered diagnostics for every process-pinned database plane. */
  readonly planes: readonly PinnedDatabaseRuntimeDiagnostics[];
  readonly coordinator: DatabaseCoordinatorDiagnostics | null;
  readonly authority: ReturnType<AuthorityCommitCoordinator['diagnostics']> | null;
}

interface DatabaseRuntimeSummary {
  readonly role: DatabaseRuntimeRole;
  readonly started: boolean;
  readonly closed: boolean;
}
