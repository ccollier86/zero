/** Authenticated transport for the current browser authorization snapshot. */

import type { AuthAuthorizationSnapshot } from './auth-authorization-types';
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';

export interface AuthAuthorizationTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
  /** @internal Deterministic deadline injection; normal reads use 15 seconds. */
  requestTimeoutMs?: number;
}

export class AuthAuthorizationTransport {
  constructor(private readonly options: AuthAuthorizationTransportOptions) {}

  async getCurrent(signal?: AbortSignal): Promise<AuthAuthorizationSnapshot> {
    // A masked post-purge view must not wait forever on an automatic read.
    // Bound both headers and body in the SDK transport, not just its Retry UI.
    const request = new AuthSessionRecoveryRequest(this.options.requestTimeoutMs);
    const cancel = () => request.cancel();
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await request.run(async (ownedSignal) => {
        const response = await this.options.authenticatedFetch(
          `${this.options.baseUrl}/auth/authorization`,
          { method: 'GET', signal: ownedSignal, cache: 'no-store' },
        );
        ownedSignal.throwIfAborted();
        // Definitive admission denial is in the status, not an optional body.
        // A stalled proxy error body must not defer revocation until timeout.
        if (response.status === 401 || response.status === 403) {
          throw this.options.createResponseError(response, null, 'Failed to load current authorization');
        }
        const body = await response.json().catch(() => null);
        ownedSignal.throwIfAborted();
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
      });
    } finally {
      signal?.removeEventListener('abort', cancel);
      request.cancel();
    }
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

  const scope = parseScope(value.scope, profile.tenancy, false);
  const applicationScope = value.applicationScope === undefined
    ? undefined
    : parseScope(value.applicationScope, profile.tenancy, true);
  if (applicationScope
    && (profile.tenancy !== 'multi'
      || scope?.kind !== 'tenant'
      || applicationScope.scopeId !== 'application')) {
    throw invalidSnapshot();
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
    ...(applicationScope !== undefined ? { applicationScope } : {}),
    revision: value.revision,
  });
}

function parseScope(
  value: unknown,
  tenancy: 'single' | 'multi',
  applicationOnly: boolean,
): AuthAuthorizationSnapshot['scope'] {
  if (value === null) return null;
  if (!isRecord(value)
    || (value.kind !== 'application' && value.kind !== 'tenant')
    || !isNonEmptyString(value.scopeId)
    || !isBoundedKeyArray(value.roles, 128, ROLE_KEY_PATTERN, 64)
    || !isBoundedKeyArray(value.permissions, 512, PERMISSION_KEY_PATTERN, 128)
    || typeof value.allPermissions !== 'boolean'
    || !isNonEmptyString(value.revision)
    || (value.tenantId !== undefined && !isNonEmptyString(value.tenantId))
    || (value.membershipId !== undefined && !isNonEmptyString(value.membershipId))) {
    throw invalidSnapshot();
  }
  if ((applicationOnly && value.kind !== 'application')
    || (!applicationOnly && (value.kind === 'tenant') !== (tenancy === 'multi'))
    || (value.kind === 'tenant'
      && (!value.tenantId || !value.membershipId || value.scopeId !== value.tenantId))
    || (value.kind === 'application'
      && (value.tenantId !== undefined || value.membershipId !== undefined))) {
    throw invalidSnapshot();
  }
  return Object.freeze({
    kind: value.kind,
    scopeId: value.scopeId,
    roles: Object.freeze([...value.roles]),
    permissions: Object.freeze([...value.permissions]),
    allPermissions: value.allPermissions,
    revision: value.revision,
    ...(value.tenantId ? { tenantId: value.tenantId } : {}),
    ...(value.membershipId ? { membershipId: value.membershipId } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*(?::[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)+$/;

function isBoundedKeyArray(
  value: unknown,
  maxItems: number,
  pattern: RegExp,
  maxLength: number,
): value is string[] {
  if (!Array.isArray(value) || value.length > maxItems) return false;
  const unique = new Set<string>();
  for (const key of value) {
    if (typeof key !== 'string' || key.length < 1 || key.length > maxLength
      || !pattern.test(key) || unique.has(key)) return false;
    unique.add(key);
  }
  return true;
}

function invalidSnapshot(): Error {
  return new Error('[client] Zero returned an invalid current-authorization snapshot.');
}
