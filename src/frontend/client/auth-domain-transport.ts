/** Strict browser transports for verified-domain administration and onboarding. */

import type {
  AuthDomainOnboardingAdmissionResult,
  AuthDomainOnboardingCompletion,
  AuthDomainOnboardingPendingRequest,
  AuthDomainOnboardingTenantSummary,
  AuthTenantDomainAdministration,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaim,
  AuthTenantDomainClaimResult,
  AuthTenantDomainDnsChallenge,
  AuthTenantDomainPolicy,
  AuthTenantDomainPolicyUpdate,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
  AuthTenantDomainRequestRole,
} from './auth-domain-types';

interface AuthDomainTransportOptions {
  baseUrl: string;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
}

export interface AuthTenantDomainTransportOptions extends AuthDomainTransportOptions {
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface AuthDomainOnboardingTransportOptions extends AuthDomainTransportOptions {
  optionalAuthenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export class AuthTenantDomainTransport {
  constructor(private readonly options: AuthTenantDomainTransportOptions) {}

  async getAdministration(signal?: AbortSignal): Promise<AuthTenantDomainAdministration> {
    return parseAuthTenantDomainAdministration(await this.request(
      '/auth/tenant/domains',
      { method: 'GET', signal },
      'Failed to load verified domains',
    ));
  }

  async createClaim(domain: string): Promise<AuthTenantDomainChallengeResult> {
    return parseAuthTenantDomainChallengeResult(await this.request(
      '/auth/tenant/domains',
      jsonRequest('POST', { domain }),
      'Failed to create domain claim',
    ));
  }

  async issueChallenge(
    claimId: string,
    expectedRevision: string,
  ): Promise<AuthTenantDomainChallengeResult> {
    return parseAuthTenantDomainChallengeResult(await this.request(
      `${claimPath(claimId)}/challenges`,
      jsonRequest('POST', { expectedRevision }),
      'Failed to rotate DNS challenge',
    ));
  }

  async verifyClaim(
    claimId: string,
    expectedRevision: string,
  ): Promise<AuthTenantDomainClaimResult> {
    return parseAuthTenantDomainClaimResult(await this.request(
      `${claimPath(claimId)}/verify`,
      jsonRequest('POST', { expectedRevision }),
      'Failed to verify domain claim',
    ));
  }

  async updatePolicy(
    claimId: string,
    update: AuthTenantDomainPolicyUpdate,
  ): Promise<AuthTenantDomainClaimResult> {
    return parseAuthTenantDomainClaimResult(await this.request(
      `${claimPath(claimId)}/policy`,
      jsonRequest('PATCH', update),
      'Failed to update domain onboarding policy',
    ));
  }

  async releaseClaim(
    claimId: string,
    input: AuthTenantDomainReleaseInput,
  ): Promise<AuthTenantDomainReleaseResult> {
    return parseAuthTenantDomainReleaseResult(await this.request(
      `${claimPath(claimId)}/release`,
      jsonRequest('POST', input),
      'Failed to release verified domain',
    ));
  }

  private async request(path: string, init: RequestInit, fallback: string): Promise<unknown> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}${path}`,
      { ...init, cache: 'no-store' },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) throw this.options.createResponseError(response, body, fallback);
    this.options.assertResponseCurrent(response);
    return body;
  }
}

export class AuthDomainOnboardingTransport {
  constructor(private readonly options: AuthDomainOnboardingTransportOptions) {}

  async start(identityContinuation?: string): Promise<{ accepted: true }> {
    const body = await this.request(
      '/auth/onboarding/domain/start',
      jsonRequest('POST', identityContinuation ? { identityContinuation } : {}),
      'Unable to start company email verification',
    );
    if (!isRecord(body) || body.accepted !== true) throw invalidResponse();
    return Object.freeze({ accepted: true });
  }

  async complete(proofToken: string): Promise<AuthDomainOnboardingCompletion> {
    return parseAuthDomainOnboardingCompletion(await this.request(
      '/auth/onboarding/domain/complete',
      jsonRequest('POST', { proofToken }),
      'Unable to verify company email',
    ));
  }

  async admit(
    continuation: string,
    identityContinuation?: string,
  ): Promise<AuthDomainOnboardingAdmissionResult> {
    return parseAuthDomainOnboardingAdmissionResult(await this.request(
      '/auth/onboarding/domain/admit',
      jsonRequest('POST', {
        continuation,
        ...(identityContinuation ? { identityContinuation } : {}),
      }),
      'Unable to request tenant access',
    ));
  }

  private async request(path: string, init: RequestInit, fallback: string): Promise<unknown> {
    const response = await this.options.optionalAuthenticatedFetch(
      `${this.options.baseUrl}${path}`,
      { ...init, cache: 'no-store' },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) throw this.options.createResponseError(response, body, fallback);
    this.options.assertResponseCurrent(response);
    return body;
  }
}

export function parseAuthTenantDomainAdministration(
  value: unknown,
): AuthTenantDomainAdministration {
  if (!isRecord(value) || !isRecord(value.actor) || !isRecord(value.actor.capabilities)
    || !Array.isArray(value.requestRoles) || !Array.isArray(value.claims)) {
    throw invalidResponse();
  }
  const capabilities = value.actor.capabilities;
  for (const key of [
    'canReadDomains',
    'canCreateDomains',
    'canVerifyDomains',
    'canManagePolicy',
    'canReleaseDomains',
  ]) {
    if (typeof capabilities[key] !== 'boolean') throw invalidResponse();
  }
  return Object.freeze({
    actor: Object.freeze({
      capabilities: Object.freeze({
        canReadDomains: capabilities.canReadDomains,
        canCreateDomains: capabilities.canCreateDomains,
        canVerifyDomains: capabilities.canVerifyDomains,
        canManagePolicy: capabilities.canManagePolicy,
        canReleaseDomains: capabilities.canReleaseDomains,
      }),
    }),
    requestRoles: Object.freeze(value.requestRoles.map(parseRole)),
    claims: Object.freeze(value.claims.map(parseClaim)),
  });
}

export function parseAuthTenantDomainChallengeResult(
  value: unknown,
): AuthTenantDomainChallengeResult {
  if (!isRecord(value)) throw invalidResponse();
  return Object.freeze({
    claim: parseClaim(value.claim),
    challenge: parseChallenge(value.challenge),
  });
}

export function parseAuthTenantDomainClaimResult(value: unknown): AuthTenantDomainClaimResult {
  if (!isRecord(value)) throw invalidResponse();
  return Object.freeze({ claim: parseClaim(value.claim) });
}

export function parseAuthTenantDomainReleaseResult(
  value: unknown,
): AuthTenantDomainReleaseResult {
  if (!isRecord(value) || !isRecord(value.release)
    || !isNonEmptyString(value.release.claimId)
    || !isNonEmptyString(value.release.domain)
    || !isTimestamp(value.release.releasedAt)
    || !isTimestamp(value.release.quarantineUntil)
    || value.release.quarantineUntil < value.release.releasedAt) {
    throw invalidResponse();
  }
  return Object.freeze({
    release: Object.freeze({
      claimId: value.release.claimId,
      domain: value.release.domain,
      releasedAt: value.release.releasedAt,
      quarantineUntil: value.release.quarantineUntil,
    }),
  });
}

export function parseAuthDomainOnboardingCompletion(
  value: unknown,
): AuthDomainOnboardingCompletion {
  if (!isRecord(value) || !isRecord(value.option)) throw invalidResponse();
  if (value.option.action === 'unavailable') {
    return Object.freeze({ option: Object.freeze({ action: 'unavailable' }) });
  }
  const tenant = parseTenantSummary(value.option.tenant);
  if (value.option.action === 'request-pending') {
    return Object.freeze({
      option: Object.freeze({
        action: 'request-pending',
        tenant,
        request: parsePendingRequest(value.option.request),
      }),
    });
  }
  if (value.option.action !== 'request-to-join'
    || !isNonEmptyString(value.continuation)
    || !isTimestamp(value.expiresAt)) throw invalidResponse();
  return Object.freeze({
    option: Object.freeze({ action: 'request-to-join', tenant }),
    continuation: value.continuation,
    expiresAt: value.expiresAt,
  });
}

export function parseAuthDomainOnboardingAdmissionResult(
  value: unknown,
): AuthDomainOnboardingAdmissionResult {
  if (!isRecord(value) || !isRecord(value.request)) throw invalidResponse();
  const request = parsePendingRequest(value.request);
  return Object.freeze({
    request: Object.freeze({
      ...request,
      tenant: parseTenantSummary(value.request.tenant),
    }),
  });
}

function parseClaim(value: unknown): AuthTenantDomainClaim {
  if (!isRecord(value)
    || !isNonEmptyString(value.claimId)
    || !isNonEmptyString(value.domain)
    || !isClaimStatus(value.status)
    || value.proofMethod !== 'dns-txt'
    || !isNullableTimestamp(value.verifiedAt)
    || !isNullableTimestamp(value.lastCheckedAt)
    || !isNullableTimestamp(value.nextCheckAt)
    || !isNullableTimestamp(value.validUntil)
    || !isNullableTimestamp(value.challengeExpiresAt)
    || !isNonEmptyString(value.revision)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)) throw invalidResponse();
  return Object.freeze({
    claimId: value.claimId,
    domain: value.domain,
    status: value.status,
    proofMethod: 'dns-txt',
    verifiedAt: value.verifiedAt,
    lastCheckedAt: value.lastCheckedAt,
    nextCheckAt: value.nextCheckAt,
    validUntil: value.validUntil,
    challengeExpiresAt: value.challengeExpiresAt,
    policy: parsePolicy(value.policy),
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function parsePolicy(value: unknown): AuthTenantDomainPolicy {
  if (!isRecord(value)
    || typeof value.enabled !== 'boolean'
    || value.admission !== 'request-to-join'
    || (value.requestRoleKey !== null && !isNonEmptyString(value.requestRoleKey))
    || !isNonEmptyString(value.revision)) throw invalidResponse();
  return Object.freeze({
    enabled: value.enabled,
    admission: 'request-to-join',
    requestRoleKey: value.requestRoleKey,
    revision: value.revision,
  });
}

function parseRole(value: unknown): AuthTenantDomainRequestRole {
  if (!isRecord(value) || !isNonEmptyString(value.key) || !isNonEmptyString(value.label)
    || (value.description !== undefined && typeof value.description !== 'string')) {
    throw invalidResponse();
  }
  return Object.freeze({
    key: value.key,
    label: value.label,
    ...(value.description ? { description: value.description } : {}),
  });
}

function parseChallenge(value: unknown): AuthTenantDomainDnsChallenge {
  if (!isRecord(value) || value.recordType !== 'TXT'
    || !isNonEmptyString(value.name) || !isNonEmptyString(value.value)
    || !isTimestamp(value.expiresAt)) throw invalidResponse();
  return Object.freeze({
    recordType: 'TXT',
    name: value.name,
    value: value.value,
    expiresAt: value.expiresAt,
  });
}

function parseTenantSummary(value: unknown): AuthDomainOnboardingTenantSummary {
  if (!isRecord(value) || !isNonEmptyString(value.name) || !isNonEmptyString(value.slug)) {
    throw invalidResponse();
  }
  return Object.freeze({ name: value.name, slug: value.slug });
}

function parsePendingRequest(value: unknown): AuthDomainOnboardingPendingRequest {
  if (!isRecord(value) || !isNonEmptyString(value.joinRequestId)
    || value.status !== 'pending' || !isTimestamp(value.createdAt)) throw invalidResponse();
  return Object.freeze({
    joinRequestId: value.joinRequestId,
    status: 'pending',
    createdAt: value.createdAt,
  });
}

function claimPath(claimId: string): string {
  return `/auth/tenant/domains/${encodeURIComponent(claimId)}`;
}

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

function isClaimStatus(value: unknown): value is AuthTenantDomainClaim['status'] {
  return value === 'pending' || value === 'verified' || value === 'grace'
    || value === 'lost';
}

function invalidResponse(): Error {
  return new Error('[client] Zero returned an invalid verified-domain response.');
}
