/**
 * workflow-scope-boundary.ts
 *
 * Owns the application-versus-tenant data boundary for workflow service
 * operations. It resolves configured scope defaults and hides runs outside
 * the caller's trusted scope; it does not mutate workflow state.
 */

import {
  applicationServiceDataScope,
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import { WorkflowError, workflowNotFound } from './workflow-error';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowInstanceRecord } from './types';

/** Enforce one WorkflowService instance's configured tenancy boundary. */
export class WorkflowScopeBoundary {
  constructor(
    private readonly tenancyMode: 'single' | 'multi',
    private readonly repository: Pick<WorkflowRepository, 'getInstance'>,
  ) {}

  /** Report whether callers must always supply an explicit tenant scope. */
  requiresExplicitScope(): boolean {
    return this.tenancyMode === 'multi';
  }

  /** Resolve a trusted scope, applying the single-tenant application default. */
  requireScope(scope: ServiceDataScope | undefined): ServiceDataScope {
    const resolved = scope ?? (this.tenancyMode === 'single'
      ? applicationServiceDataScope()
      : null);
    if (!resolved) {
      throw new WorkflowError(
        'A validated tenant data scope is required in multi-tenant mode',
        'WORKFLOW_SCOPE_REQUIRED',
        403,
      );
    }
    this.assertCompatible(resolved);
    return resolved;
  }

  /** Reject a scope whose kind cannot exist in the configured tenancy mode. */
  assertCompatible(scope: ServiceDataScope): void {
    if ((this.tenancyMode === 'single' && scope.scopeKind !== 'application')
      || (this.tenancyMode === 'multi' && scope.scopeKind !== 'tenant')) {
      throw new WorkflowError(
        'Workflow scope is incompatible with the configured tenancy mode',
        'WORKFLOW_SCOPE_INVALID',
        403,
      );
    }
  }

  /** Return a run only when it belongs to the exact trusted data scope. */
  findInstance(
    instanceId: string,
    scope: ServiceDataScope,
  ): WorkflowInstanceRecord | null {
    const instance = this.repository.getInstance(instanceId);
    return instance && serviceDataScopeMatchesTenant(scope, instance.tenant_id)
      ? instance
      : null;
  }

  /** Require a visible run while hiding cross-scope identifiers as not found. */
  requireInstance(
    instanceId: string,
    scope: ServiceDataScope,
  ): WorkflowInstanceRecord {
    const instance = this.findInstance(instanceId, scope);
    if (!instance) throw workflowNotFound();
    return instance;
  }

  /** Test whether a durable tenant marker belongs to the trusted scope. */
  matchesTenant(scope: ServiceDataScope, tenantId: unknown): boolean {
    return serviceDataScopeMatchesTenant(scope, tenantId);
  }
}

/** Narrow the overloaded event/start argument without trusting its contents. */
export function isWorkflowServiceDataScope(value: unknown): value is ServiceDataScope {
  return Boolean(value && typeof value === 'object'
    && 'scopeKind' in value
    && ((value as { scopeKind?: unknown }).scopeKind === 'application'
      || (value as { scopeKind?: unknown }).scopeKind === 'tenant'));
}
