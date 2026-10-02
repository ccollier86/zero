/** Construction and comparison of secret-free workflow execution identities. */

import type { AuthorizationScopeSnapshot } from '../auth/authorization-kernel';
import {
  trustedSystemServiceDataScope,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { AuthContext } from '../auth/types';
import { WorkflowError } from './workflow-error';
import type {
  WorkflowExecutionIdentity,
  WorkflowSystemExecutionAuthority,
} from './workflow-execution-authority-types';

const AUTHORITY_VERSION = 1 as const;

export function createActorIdentity(
  context: AuthContext,
  authorization: AuthorizationScopeSnapshot,
): Extract<WorkflowExecutionIdentity, { kind: 'actor' }> {
  const common = {
    kind: 'actor',
    userId: context.userId,
    platformRole: context.role,
    scopeKind: authorization.scopeKind,
    scopeId: authorization.scopeId,
    tenantId: authorization.tenantId ?? null,
    membershipId: authorization.membershipId ?? null,
    roles: [...authorization.roles].sort(compareText),
    permissions: [...authorization.permissions].sort(compareText),
    allPermissions: authorization.allPermissions === true,
    authorizationRevision: authorization.revision,
  } as const;

  if (context.credentialKind === 'api-key') {
    const credentialId = requireBoundedText(
      context.credentialId,
      'API-key credential id',
      256,
    );
    return freezeWorkflowExecutionIdentity({
      ...common,
      credentialKind: 'api-key',
      credentialId,
      sessionKind: null,
      clientId: null,
    });
  }

  if (context.sessionKind !== 'web' && context.sessionKind !== 'native') {
    throw invalidAuthorityConfig(
      'Workflow actor authority requires a web or native session kind',
    );
  }
  return freezeWorkflowExecutionIdentity({
    ...common,
    sessionKind: context.sessionKind,
    clientId: context.clientId ?? null,
  });
}

export function createSystemAuthority(input: {
  principal: string;
  reason: string;
  scope: ServiceDataScope;
  legacyCompatibility?: boolean;
}): WorkflowSystemExecutionAuthority {
  const principal = requireBoundedText(input.principal, 'system principal', 120);
  const reason = requireBoundedText(input.reason, 'system execution reason', 500);
  return Object.freeze({
    version: AUTHORITY_VERSION,
    kind: 'system',
    identity: freezeWorkflowExecutionIdentity({
      kind: 'system',
      principal,
      reason,
      scopeKind: input.scope.scopeKind,
      scopeId: input.scope.scopeId,
      tenantId: input.scope.tenantId,
      roles: [] as const,
      permissions: [] as const,
      allPermissions: true,
      legacyCompatibility: input.legacyCompatibility === true,
    }),
  });
}

export function scopeFromIdentity(identity: WorkflowExecutionIdentity): ServiceDataScope {
  if (identity.scopeKind === 'application') {
    return trustedSystemServiceDataScope({ scopeKind: 'application' });
  }
  if (!identity.tenantId || identity.scopeId !== identity.tenantId) {
    throw new WorkflowError(
      'Workflow execution identity has an invalid tenant scope',
      'WORKFLOW_STATE_INVALID',
      500,
    );
  }
  return trustedSystemServiceDataScope({
    scopeKind: 'tenant',
    tenantId: identity.tenantId,
  });
}

/** Compare the explicit canonical identity fields, independent of object/array order. */
export function sameExecutionIdentity(
  left: WorkflowExecutionIdentity,
  right: WorkflowExecutionIdentity,
): boolean {
  return canonicalWorkflowExecutionIdentity(left)
    === canonicalWorkflowExecutionIdentity(right);
}

/** Internal canonical representation shared by identity comparison and tests. */
export function canonicalWorkflowExecutionIdentity(
  identity: WorkflowExecutionIdentity,
): string {
  if (identity.kind === 'system') {
    return JSON.stringify([
      'system',
      identity.principal,
      identity.reason,
      identity.scopeKind,
      identity.scopeId,
      identity.tenantId,
      [...identity.roles].sort(compareText),
      [...identity.permissions].sort(compareText),
      identity.allPermissions,
      identity.legacyCompatibility,
    ]);
  }

  const credential = identity.credentialKind === 'api-key'
    ? ['api-key', identity.credentialId, null, null] as const
    : ['session', null, identity.sessionKind, identity.clientId] as const;
  return JSON.stringify([
    'actor',
    identity.userId,
    identity.platformRole,
    ...credential,
    identity.scopeKind,
    identity.scopeId,
    identity.tenantId,
    identity.membershipId,
    [...identity.roles].sort(compareText),
    [...identity.permissions].sort(compareText),
    identity.allPermissions,
    identity.authorizationRevision,
  ]);
}

export function freezeWorkflowExecutionIdentity<T extends WorkflowExecutionIdentity>(
  identity: T,
): T {
  return Object.freeze({
    ...identity,
    roles: Object.freeze([...identity.roles]),
    permissions: Object.freeze([...identity.permissions]),
  }) as T;
}

function requireBoundedText(
  value: unknown,
  label: string,
  max: number,
): string {
  if (typeof value !== 'string') {
    throw invalidAuthorityConfig(`Workflow ${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw invalidAuthorityConfig(
      `Workflow ${label} must contain 1-${max} characters`,
    );
  }
  return normalized;
}

function invalidAuthorityConfig(message: string): WorkflowError {
  return new WorkflowError(message, 'WORKFLOW_CONFIG_INVALID', 500);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
