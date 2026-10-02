/** Validation, freezing, and bounded encoding for private authority seals. */

import type { AuthRequestAuthorityReference } from '../auth/auth-api-key-types';
import type { AuthContextAuthorityReference } from '../auth/types';
import { WorkflowError } from './workflow-error';
import { freezeWorkflowExecutionIdentity } from './workflow-execution-authority-factory';
import type {
  WorkflowExecutionIdentity,
  WorkflowPersistedExecutionAuthority,
} from './workflow-execution-authority-types';

const MAX_AUTHORITY_JSON_BYTES = 32 * 1024;

export function serializeWorkflowExecutionAuthority(
  authority: WorkflowPersistedExecutionAuthority,
): string {
  const json = JSON.stringify(authority);
  if (Buffer.byteLength(json, 'utf8') > MAX_AUTHORITY_JSON_BYTES) {
    throw new WorkflowError(
      'Workflow execution authority seal exceeds its storage limit',
      'WORKFLOW_RUNTIME_LIMIT_EXCEEDED',
      500,
    );
  }
  return json;
}

export function parseWorkflowExecutionAuthority(
  json: string,
): WorkflowPersistedExecutionAuthority | null {
  if (Buffer.byteLength(json, 'utf8') > MAX_AUTHORITY_JSON_BYTES) return null;
  try {
    const value = JSON.parse(json) as unknown;
    return isPersistedAuthority(value) ? freezePersistedAuthority(value) : null;
  } catch {
    return null;
  }
}

/** Length-prefix every field so domains and bound values cannot collide. */
export function workflowAuthoritySealPayload(
  domain: string,
  boundValue: string,
  authorityJson: string,
): string {
  return [domain, boundValue, authorityJson]
    .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`)
    .join('|');
}

export function canonicalWorkflowAuthorityProperties(
  properties: Readonly<Record<string, string>>,
): string {
  return JSON.stringify(Object.entries(properties).sort(([left], [right]) =>
    compareText(left, right)));
}

function isPersistedAuthority(value: unknown): value is WorkflowPersistedExecutionAuthority {
  if (!isRecord(value) || value.version !== 1) return false;
  if (value.kind === 'system') return isSystemIdentity(value.identity);
  if (value.kind !== 'actor'
    || !isActorIdentity(value.identity)
    || !isAuthorityReference(value.reference)
    || !isHexDigest(value.propertiesMac)) return false;
  return actorIdentityMatchesReference(value.identity, value.reference);
}

function isActorIdentity(
  value: unknown,
): value is Extract<WorkflowExecutionIdentity, { kind: 'actor' }> {
  return isRecord(value)
    && value.kind === 'actor'
    && boundedString(value.userId, 256)
    && boundedString(value.platformRole, 128)
    && isActorCredentialShape(value)
    && isScopeShape(value)
    && nullableBoundedString(value.membershipId, 256)
    && stringArray(value.roles, 128, 128)
    && stringArray(value.permissions, 1024, 256)
    && typeof value.allPermissions === 'boolean'
    && boundedString(value.authorizationRevision, 1024);
}

function isActorCredentialShape(value: Record<string, unknown>): boolean {
  if (value.credentialKind === 'api-key') {
    return boundedString(value.credentialId, 256)
      && value.sessionKind === null
      && value.clientId === null;
  }
  return (value.credentialKind === undefined || value.credentialKind === 'session')
    && (value.credentialId === undefined || value.credentialId === null)
    && (value.sessionKind === 'web' || value.sessionKind === 'native')
    && nullableBoundedString(value.clientId, 256);
}

function isSystemIdentity(
  value: unknown,
): value is Extract<WorkflowExecutionIdentity, { kind: 'system' }> {
  return isRecord(value)
    && value.kind === 'system'
    && boundedString(value.principal, 120)
    && boundedString(value.reason, 500)
    && isScopeShape(value)
    && Array.isArray(value.roles) && value.roles.length === 0
    && Array.isArray(value.permissions) && value.permissions.length === 0
    && value.allPermissions === true
    && typeof value.legacyCompatibility === 'boolean';
}

function isScopeShape(value: Record<string, unknown>): boolean {
  if (value.scopeKind === 'application') {
    return value.scopeId === 'application' && value.tenantId === null;
  }
  return value.scopeKind === 'tenant'
    && boundedString(value.scopeId, 256)
    && value.tenantId === value.scopeId;
}

function isAuthorityReference(
  value: unknown,
): value is AuthContextAuthorityReference | AuthRequestAuthorityReference {
  if (!isRecord(value)) return false;
  if (value.kind === 'session') return isSessionAuthorityReference(value.reference);
  if (value.kind === 'api-key') {
    return value.version === 1
      && boundedString(value.keyId, 256)
      && generation(value.keyGeneration)
      && boundedString(value.userId, 256)
      && (value.scopeKind === 'application' || value.scopeKind === 'tenant')
      && boundedString(value.scopeId, 256)
      && (value.scopeKind === 'tenant' || value.scopeId === 'application');
  }
  return isSessionAuthorityReference(value);
}

function isSessionAuthorityReference(value: unknown): value is AuthContextAuthorityReference {
  if (!isRecord(value)
    || value.version !== 1
    || !boundedString(value.userId, 256)
    || !boundedString(value.platformRole, 128)
    || !generation(value.authGeneration)
    || (value.sessionKind !== 'web' && value.sessionKind !== 'native')
    || !boundedString(value.sessionId, 512)
    || !nullableGeneration(value.sessionGeneration)
    || !nullableBoundedString(value.clientId, 256)
    || !stringArray(value.identityScopes, 64, 128)
    || (value.sessionScopeKind !== 'application' && value.sessionScopeKind !== 'tenant')
    || !boundedString(value.sessionScopeId, 256)
    || !nullableBoundedString(value.tenantId, 256)
    || !nullableBoundedString(value.membershipId, 256)
    || !nullableBoundedString(value.tenantRole, 128)
    || !nullableGeneration(value.tenantAuthorizationGeneration)
    || !nullableGeneration(value.membershipAuthorizationGeneration)
    || !nullableBoundedString(value.authorizationAssignmentRevision, 1024)) return false;
  if (value.sessionKind === 'web') {
    if (value.sessionGeneration === null || value.clientId !== null) return false;
  } else if (value.sessionGeneration !== null || value.clientId === null) return false;
  return value.sessionScopeKind === 'application'
    ? value.sessionScopeId === 'application'
      && value.tenantId === null
      && value.membershipId === null
      && value.tenantAuthorizationGeneration === null
      && value.membershipAuthorizationGeneration === null
    : value.tenantId === value.sessionScopeId
      && value.membershipId !== null
      && value.tenantAuthorizationGeneration !== null
      && value.membershipAuthorizationGeneration !== null;
}

function actorIdentityMatchesReference(
  identity: Extract<WorkflowExecutionIdentity, { kind: 'actor' }>,
  reference: AuthContextAuthorityReference | AuthRequestAuthorityReference,
): boolean {
  if ('kind' in reference && reference.kind === 'api-key') {
    return identity.credentialKind === 'api-key'
      && identity.credentialId === reference.keyId
      && identity.userId === reference.userId
      && identity.scopeKind === reference.scopeKind
      && identity.scopeId === reference.scopeId;
  }
  const session = 'kind' in reference ? reference.reference : reference;
  return identity.credentialKind !== 'api-key'
    && identity.userId === session.userId
    && identity.platformRole === session.platformRole
    && identity.sessionKind === session.sessionKind
    && identity.clientId === session.clientId
    && identity.scopeKind === session.sessionScopeKind
    && identity.scopeId === session.sessionScopeId
    && identity.tenantId === session.tenantId
    && identity.membershipId === session.membershipId;
}

function freezePersistedAuthority(
  authority: WorkflowPersistedExecutionAuthority,
): WorkflowPersistedExecutionAuthority {
  if (authority.kind === 'system') {
    return Object.freeze({
      ...authority,
      identity: freezeWorkflowExecutionIdentity(authority.identity),
    });
  }
  return Object.freeze({
    ...authority,
    reference: freezeAuthorityReference(authority.reference),
    identity: freezeWorkflowExecutionIdentity(authority.identity),
  });
}

function freezeAuthorityReference(
  reference: AuthContextAuthorityReference | AuthRequestAuthorityReference,
): AuthContextAuthorityReference | AuthRequestAuthorityReference {
  if ('kind' in reference) {
    if (reference.kind === 'api-key') return Object.freeze({ ...reference });
    return Object.freeze({
      kind: 'session' as const,
      reference: Object.freeze({
        ...reference.reference,
        identityScopes: Object.freeze([...reference.reference.identityScopes]),
      }),
    });
  }
  return Object.freeze({
    ...reference,
    identityScopes: Object.freeze([...reference.identityScopes]),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function nullableBoundedString(value: unknown, max: number): value is string | null {
  return value === null || boundedString(value, max);
}

function generation(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nullableGeneration(value: unknown): value is number | null {
  return value === null || generation(value);
}

function stringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((entry) => typeof entry === 'string'
      && entry.length > 0
      && entry.length <= maxLength);
}

function isHexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
