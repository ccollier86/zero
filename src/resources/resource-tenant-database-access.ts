/**
 * resource-tenant-database-access.ts
 *
 * Acquires request-owned physical tenant database capabilities from verified
 * Resource scope and fences authority before, during, and after binding. It
 * does not evaluate Resource policy or execute database operations.
 */

import type {
  ResourceCrudFailure,
  ResourceCrudRequestContext,
  ResourceTenantDatabaseAccess,
  ResourceTenantDatabaseClientProvider,
} from './resource-crud-contracts';
import { DatabaseError } from '../databases/database-error';
import type { ResourceCrudFailureMapper } from './resource-crud-failures';
import {
  resourceAuthorityChangedFailure,
  tenantDatabaseUnavailableFailure,
} from './resource-crud-results';
import type {
  ResourcePolicyAuthorityService,
  ResourcePolicyAuthoritySnapshot,
} from './resource-policy-authority';
import type { ResourceAction } from './resource-policy-types';
import type { RegisteredResourceDefinition } from './resource-registry';
import type { ResourceTenantDatabaseScope } from './resource-realm';

/** Resolve only verified, authority-bound physical tenant capabilities. */
export class ResourceTenantDatabaseAccessResolver {
  constructor(
    private readonly provider: ResourceTenantDatabaseClientProvider | undefined,
    private readonly authority: ResourcePolicyAuthorityService,
    private readonly failures: ResourceCrudFailureMapper,
  ) {}

  /**
   * Acquire one short-lived tenant binding and recheck authority after await.
   * The returned capability remains caller-owned and must be released once.
   */
  async resolve(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantDatabaseScope,
    context: ResourceCrudRequestContext,
    captured: ResourcePolicyAuthoritySnapshot,
    action: ResourceAction,
    operation: 'read' | 'write',
  ): Promise<ResourceTenantDatabaseAccess | { failure: ResourceCrudFailure }> {
    const isCapturedAuthorityCurrent = (): boolean =>
      this.authority.isCurrentForTenantDatabase(context, captured);

    if (!isCapturedAuthorityCurrent()) {
      return { failure: resourceAuthorityChangedFailure() };
    }
    if (!this.provider) {
      return { failure: tenantDatabaseUnavailableFailure() };
    }

    const assertCurrentAuthoritySync = (): undefined => {
      if (!isCapturedAuthorityCurrent()) {
        throw new DatabaseError(
          'DATABASE_AUTHORITY_CHANGED',
          'Resource tenant database authority changed.',
        );
      }
      return undefined;
    };

    try {
      const access = await this.provider({ scope, assertCurrentAuthoritySync });
      if (!access) return { failure: tenantDatabaseUnavailableFailure() };
      // Binding may await actor capacity/open. Never return a capability after
      // the durable authority that selected its file has changed.
      if (!isCapturedAuthorityCurrent()) {
        access.release();
        return { failure: resourceAuthorityChangedFailure() };
      }
      return access;
    } catch (error) {
      return {
        failure: this.failures.tenantDatabase(
          error,
          resource,
          action,
          operation,
        ),
      };
    }
  }
}
