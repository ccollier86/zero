/**
 * resource-crud-contracts.ts
 *
 * Defines the framework-neutral public contracts shared by generated Resource
 * CRUD dispatch and its storage-plane engines. This file owns types only; it
 * does not evaluate policy, acquire tenant databases, or mutate persistence.
 */

import type { AuthContext } from '../auth/types';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import type { UserStore } from '../auth/user-store';
import type { AsyncDatabaseClient } from '../databases/database-operations';
import type { DatabaseTrustedWriteExecutor } from '../databases/database-trusted-writer';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
  PlatformObservabilityRuntime,
} from '../observability/types';
import type { ReactiveDB, TableSchema } from '../sync';
import type { ResourcePolicyAuthConfig } from './resource-policy-types';
import type { ResourceRegistry } from './resource-registry';
import type { ResourceTenantDatabaseScope } from './resource-realm';

/** @internal Capability projection used by the generated HTTP plugin. */
export type ResourceTenantDatabaseClientProvider = (input: Readonly<{
  /** Verified resource realm; never request/path/body input. */
  scope: ResourceTenantDatabaseScope;
  /** Full captured policy authority, checked synchronously at actor boundaries. */
  assertCurrentAuthoritySync: () => undefined;
}>) => Promise<ResourceTenantDatabaseAccess | null>;

/** @internal Verified physical-tenant data and receipt capability. */
export interface ResourceTenantDatabaseAccess {
  readonly client: AsyncDatabaseClient;
  readonly trustedWriter: DatabaseTrustedWriteExecutor;
  /** Release the request-owned physical database lease exactly once. */
  release(): void;
}

/** Request context accepted by resource CRUD service methods. */
export interface ResourceCrudRequestContext {
  authContext?: AuthContext | null;
  /**
   * Resolve the same bearer again after asynchronous policy work. Generated
   * HTTP routes provide this automatically so a revoked session, membership,
   * role, or trusted property cannot authorize one final read/write.
   */
  revalidateAuthContext?: () => Promise<AuthContext | null>;
  /**
   * Synchronously resolve the captured durable authority at the SQLite commit
   * boundary. Generated routes provide this for session-bound Zero tokens.
   */
  resolveAuthContextAtCommit?: () => AuthContext | null;
  /** Request-local normalized key used to derive durable mutation receipts. */
  idempotencyKey?: string;
}

/** Configuration for generated resource CRUD behavior. */
export interface ResourceCrudServiceOptions {
  db: ReactiveDB;
  registry: ResourceRegistry;
  tables: Record<string, TableSchema>;
  authConfig: ResourcePolicyAuthConfig;
  userStore?: UserStore | null;
  authorizationKernel?: AuthorizationKernel | null;
  roleAssignments?: AuthorizationRoleAssignmentResolver | null;
  /** @internal Opaque verified-scope projection for physical tenant files. */
  getTenantDatabaseClient?: ResourceTenantDatabaseClientProvider;
  /** App-local sink. Standalone service construction may omit it. */
  observability?: PlatformObservabilityRuntime | null;
  /** App-local emitter compatibility seam for standalone service composition. */
  emitCode?: (
    definition: PlatformCodeDefinition,
    options?: PlatformCodeEmitOptions,
  ) => PlatformEvent;
  defaultLimit?: number;
  maxLimit?: number;
}

/** Successful resource service result. */
export interface ResourceCrudSuccess<TBody = unknown> {
  ok: true;
  status: number;
  body: TBody;
}

/** Stable failed resource service result returned by every storage plane. */
export interface ResourceCrudFailure {
  ok: false;
  status: number;
  body: {
    error: string;
    code?: string;
    retryable?: boolean;
    /** A retry is safe only when it reuses the original Idempotency-Key. */
    requiresSameIdempotencyKey?: boolean;
  };
}

/** Resource service method result. */
export type ResourceCrudResult<TBody = unknown> =
  | ResourceCrudSuccess<TBody>
  | ResourceCrudFailure;
