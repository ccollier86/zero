/** Canonical ownership boundary for persisted workflow definitions. */

import type { ServiceDataScope } from '../auth/service-data-scope';
import type {
  WorkflowDefinitionCatalogRecord,
  WorkflowDefinitionScope,
} from './workflow-definition-version-types';

export const APPLICATION_WORKFLOW_DEFINITION_SCOPE = Object.freeze({
  type: 'application',
  id: '',
}) satisfies Required<WorkflowDefinitionScope>;

export function workflowDefinitionScopeFromServiceDataScope(
  scope: ServiceDataScope,
): Required<WorkflowDefinitionScope> {
  return scope.scopeKind === 'tenant'
    ? Object.freeze({ type: 'tenant', id: scope.tenantId })
    : APPLICATION_WORKFLOW_DEFINITION_SCOPE;
}

export function workflowDefinitionScopeFromTenantId(
  tenantId: string | null,
): Required<WorkflowDefinitionScope> {
  return tenantId === null
    ? APPLICATION_WORKFLOW_DEFINITION_SCOPE
    : Object.freeze({ type: 'tenant', id: tenantId });
}

export function workflowDefinitionCatalogMatchesScope(
  catalog: WorkflowDefinitionCatalogRecord,
  scope: WorkflowDefinitionScope,
): boolean {
  return catalog.scope_type === scope.type
    && catalog.scope_id === (scope.id ?? '');
}

export function isApplicationWorkflowDefinition(
  catalog: WorkflowDefinitionCatalogRecord,
): boolean {
  return workflowDefinitionCatalogMatchesScope(
    catalog,
    APPLICATION_WORKFLOW_DEFINITION_SCOPE,
  );
}
