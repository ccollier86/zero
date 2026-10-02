/** Shared workflow scope and definition authority policies. */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import {
  canManageServiceDataScope,
  effectiveServiceDataRoles,
} from '../auth/service-data-authority';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { PermissionKey } from '../auth/types';
import type { WorkflowExecutionIdentity } from './workflow-execution-authority';
import type {
  WorkflowAccessRule,
  WorkflowDefinition,
  WorkflowDefinitionAccessPolicy,
} from './types';
import { WorkflowError } from './workflow-error';

/** Tenant permission which grants administration of every workflow in scope. */
export const WORKFLOW_MANAGE_PERMISSION = 'workflows:manage' as PermissionKey;

/**
 * Single mode preserves the historical global-platform-admin behavior.
 * Multi mode deliberately ignores users.role=admin: tenant owner,
 * allPermissions, or workflows:manage must come from the live tenant scope.
 */
export function canManageWorkflowScope(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): boolean {
  return canManageServiceDataScope(access, scope, WORKFLOW_MANAGE_PERMISSION);
}

export type WorkflowDefinitionCapability = 'start' | 'inspect';

export interface WorkflowAccessPrincipal {
  role: string;
  /** Effective roles from the current server-validated application/tenant scope. */
  roles?: readonly string[];
  /** Explicitly set by request boundaries to avoid global-admin tenant bleed. */
  administrator?: boolean;
}

export function workflowAccessPrincipal(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): WorkflowAccessPrincipal {
  const actor = access.requireUser();
  return Object.freeze({
    role: actor.role,
    roles: effectiveServiceDataRoles(access, scope),
    administrator: canManageWorkflowScope(access, scope),
  });
}

/** Build the same access principal from a freshly captured, sealed execution identity. */
export function workflowAccessPrincipalFromExecutionIdentity(
  identity: WorkflowExecutionIdentity,
): WorkflowAccessPrincipal {
  if (identity.kind === 'system') {
    return Object.freeze({ role: 'system', roles: Object.freeze([]), administrator: true });
  }
  const application = identity.scopeKind === 'application';
  const roles = application
    ? [...new Set([...identity.roles, identity.platformRole])]
    : [...identity.roles];
  const administrator = application
    ? identity.platformRole === 'admin'
    : identity.allPermissions
      || identity.roles.includes('owner')
      || identity.permissions.includes(WORKFLOW_MANAGE_PERMISSION);
  return Object.freeze({
    role: identity.platformRole,
    roles: Object.freeze(roles),
    administrator,
  });
}

/** Validate, defensively copy, and freeze one optional definition policy. */
export function freezeWorkflowAccessPolicy(
  value: WorkflowDefinitionAccessPolicy | undefined,
  workflowName: string,
): WorkflowDefinitionAccessPolicy | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidAccess(workflowName, 'access must be an object');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'start' && key !== 'inspect') {
      throw invalidAccess(workflowName, `access.${key} is not supported`);
    }
  }

  const start = freezeAccessRule(value.start, workflowName, 'start');
  const inspect = freezeAccessRule(value.inspect, workflowName, 'inspect');
  return Object.freeze({
    ...(start === undefined ? {} : { start }),
    ...(inspect === undefined ? {} : { inspect }),
  });
}

/**
 * Evaluate one definition capability. Authentication is explicit even though
 * current HTTP routes call this only after requireAuth().
 */
export function canAccessWorkflowDefinition(
  definition: Pick<WorkflowDefinition, 'access'>,
  capability: WorkflowDefinitionCapability,
  principal: WorkflowAccessPrincipal | null,
): boolean {
  if (!principal) return false;
  const administrator = principal.administrator
    ?? (principal.roles === undefined && principal.role === 'admin');
  if (administrator) return true;

  const start = definition.access?.start ?? 'authenticated';
  const requirement = capability === 'inspect'
    ? definition.access?.inspect ?? start
    : start;

  if (requirement === 'authenticated') return true;
  if (requirement === 'admin') return false;
  const roles = principal.roles ?? [principal.role];
  return requirement.some((role) => roles.includes(role));
}

function freezeAccessRule(
  value: WorkflowAccessRule | undefined,
  workflowName: string,
  capability: WorkflowDefinitionCapability,
): WorkflowAccessRule | undefined {
  if (value === undefined) return undefined;
  if (value === 'authenticated' || value === 'admin') return value;
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidAccess(
      workflowName,
      `access.${capability} must be "authenticated", "admin", or a non-empty role array`,
    );
  }

  const roles = value.map((role) => {
    if (typeof role !== 'string' || !role.trim()) {
      throw invalidAccess(
        workflowName,
        `access.${capability} role names must not be empty`,
      );
    }
    return role.trim();
  });
  return Object.freeze([...new Set(roles)]);
}

function invalidAccess(workflowName: string, detail: string): WorkflowError {
  return new WorkflowError(
    `Workflow "${workflowName}" ${detail}`,
    'WORKFLOW_DEFINITION_INVALID',
    500,
  );
}
