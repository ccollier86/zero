/** Authenticated transport for the current browser authorization snapshot. */

import type { AuthAuthorizationSnapshot } from './auth-authorization-types';

export interface AuthAuthorizationTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
}

export class AuthAuthorizationTransport {
  constructor(private readonly options: AuthAuthorizationTransportOptions) {}

  async getCurrent(signal?: AbortSignal): Promise<AuthAuthorizationSnapshot> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}/auth/authorization`,
      { method: 'GET', signal, cache: 'no-store' },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw this.options.createResponseError(
        response,
        body,
        'Failed to load current authorization',
      );
    }
    const snapshot = parseAuthAuthorizationSnapshot(body);
    this.options.assertResponseCurrent(response);
    return snapshot;
  }
}

/** Fail closed when an unexpected server/proxy response crosses the SDK boundary. */
export function parseAuthAuthorizationSnapshot(value: unknown): AuthAuthorizationSnapshot {
  if (!isRecord(value) || value.version !== 1 || typeof value.revision !== 'string') {
    throw invalidSnapshot();
  }
  const identity = value.identity;
  const profile = value.profile;
  if (!isRecord(identity)
    || !isNonEmptyString(identity.userId)
    || !isNonEmptyString(identity.platformRole)
    || !isRecord(profile)
    || (profile.tenancy !== 'single' && profile.tenancy !== 'multi')
    || (profile.authorization !== 'simple' && profile.authorization !== 'advanced')) {
    throw invalidSnapshot();
  }

  let scope: AuthAuthorizationSnapshot['scope'] = null;
  if (value.scope !== null) {
    if (!isRecord(value.scope)
      || (value.scope.kind !== 'application' && value.scope.kind !== 'tenant')
      || !isNonEmptyString(value.scope.scopeId)
      || !isStringArray(value.scope.roles)
      || !isStringArray(value.scope.permissions)
      || typeof value.scope.allPermissions !== 'boolean'
      || !isNonEmptyString(value.scope.revision)
      || (value.scope.tenantId !== undefined && !isNonEmptyString(value.scope.tenantId))
      || (value.scope.membershipId !== undefined
        && !isNonEmptyString(value.scope.membershipId))) {
      throw invalidSnapshot();
    }
    if ((value.scope.kind === 'tenant') !== (profile.tenancy === 'multi')
      || (value.scope.kind === 'tenant'
        && (!value.scope.tenantId || !value.scope.membershipId
          || value.scope.scopeId !== value.scope.tenantId))
      || (value.scope.kind === 'application'
        && (value.scope.tenantId !== undefined || value.scope.membershipId !== undefined))) {
      throw invalidSnapshot();
    }
    scope = Object.freeze({
      kind: value.scope.kind,
      scopeId: value.scope.scopeId,
      roles: Object.freeze([...value.scope.roles]),
      permissions: Object.freeze([...value.scope.permissions]),
      allPermissions: value.scope.allPermissions,
      revision: value.scope.revision,
      ...(value.scope.tenantId ? { tenantId: value.scope.tenantId } : {}),
      ...(value.scope.membershipId ? { membershipId: value.scope.membershipId } : {}),
    });
  }

  return Object.freeze({
    version: 1,
    identity: Object.freeze({
      userId: identity.userId,
      platformRole: identity.platformRole,
    }),
    profile: Object.freeze({
      tenancy: profile.tenancy,
      authorization: profile.authorization,
    }),
    scope,
    revision: value.revision,
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function invalidSnapshot(): Error {
  return new Error('[client] Zero returned an invalid current-authorization snapshot.');
}
