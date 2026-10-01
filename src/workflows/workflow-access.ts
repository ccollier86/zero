/**
 * workflow-access.ts
 *
 * Validates immutable definition access policy and evaluates it for the HTTP
 * boundary. The workflow service remains a trusted server-side API; callers
 * at that layer apply their own application authority.
 */

import type {
  WorkflowAccessRule,
  WorkflowDefinition,
  WorkflowDefinitionAccessPolicy,
} from './types';
import { WorkflowError } from './workflow-error';

export type WorkflowDefinitionCapability = 'start' | 'inspect';

export interface WorkflowAccessPrincipal {
  role: string;
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
  definition: WorkflowDefinition,
  capability: WorkflowDefinitionCapability,
  principal: WorkflowAccessPrincipal | null,
): boolean {
  if (!principal) return false;
  if (principal.role === 'admin') return true;

  const start = definition.access?.start ?? 'authenticated';
  const requirement = capability === 'inspect'
    ? definition.access?.inspect ?? start
    : start;

  if (requirement === 'authenticated') return true;
  if (requirement === 'admin') return false;
  return requirement.includes(principal.role);
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
