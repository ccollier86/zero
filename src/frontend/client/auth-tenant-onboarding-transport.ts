/** Browser transport for invitation acceptance and active-tenant onboarding review. */

import type {
  AuthCompletionResult,
  AuthTenantAcceptInvitationParams,
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantDenyJoinRequestParams,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestListParams,
  AuthTenantJoinRequestPage,
  AuthTenantReviewJoinRequestParams,
} from './auth-types';
import type { AuthAuthenticationAttempt } from './auth-authentication-attempt';

export interface AuthTenantOnboardingTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  optionalAuthenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
  beginAuthentication: () => AuthAuthenticationAttempt;
  failAuthentication: (message: string, attempt: AuthAuthenticationAttempt) => void;
  completeAuthentication: (
    result: AuthCompletionResult,
    attempt: AuthAuthenticationAttempt,
  ) => Promise<AuthCompletionResult>;
}

export class AuthTenantOnboardingTransport {
  constructor(private readonly options: AuthTenantOnboardingTransportOptions) {}

  inspectInvitation(token: string): Promise<AuthTenantInvitationInspection> {
    return this.publicRequest(
      '/auth/invitations/inspect',
      jsonRequest('POST', { token }),
      'Invitation is unavailable',
    );
  }

  async acceptInvitation(
    params: AuthTenantAcceptInvitationParams,
  ): Promise<AuthTenantInvitationAcceptanceResult> {
    const attempt = this.options.beginAuthentication();
    try {
      const response = await this.options.optionalAuthenticatedFetch(
        `${this.options.baseUrl}/auth/invitations/accept`,
        { ...jsonRequest('POST', params), signal: attempt.signal },
      );
      attempt.assertCurrent();
      const body = await response.json().catch(() => null);
      attempt.assertCurrent();
      if (!response.ok) {
        const error = this.options.createResponseError(
          response,
          body,
          'Failed to accept invitation',
        );
        this.options.failAuthentication(error.message, attempt);
        throw error;
      }
      return this.options.completeAuthentication(
        body as AuthTenantInvitationAcceptanceResult,
        attempt,
      ) as Promise<AuthTenantInvitationAcceptanceResult>;
    } finally {
      attempt.dispose();
    }
  }

  submitJoinRequest(params: {
    tenantSlug: string;
    continuation?: string;
  }): Promise<{ submitted: true }> {
    return this.optionalRequest(
      '/auth/tenant-join-requests',
      jsonRequest('POST', params),
      'Failed to request tenant access',
    );
  }

  listInvitations(
    params: AuthTenantInvitationListParams = {},
  ): Promise<AuthTenantInvitationPage> {
    return this.authenticatedRequest(
      `/auth/tenant/invitations${query(params)}`,
      undefined,
      'Failed to load tenant invitations',
    );
  }

  issueInvitation(
    params: AuthTenantIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult> {
    return this.authenticatedRequest(
      '/auth/tenant/invitations',
      jsonRequest('POST', params),
      'Failed to issue tenant invitation',
    );
  }

  revokeInvitation(invitationId: string): Promise<{
    invitation: AuthTenantIssueInvitationResult['invitation'];
  }> {
    return this.authenticatedRequest(
      `/auth/tenant/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' },
      'Failed to revoke tenant invitation',
    );
  }

  async listJoinRequests(
    params: AuthTenantJoinRequestListParams = {},
  ): Promise<AuthTenantJoinRequestPage> {
    return parseJoinRequestPage(await this.authenticatedRequest(
      `/auth/tenant/join-requests${query(params)}`,
      undefined,
      'Failed to load tenant join requests',
    ));
  }

  approveJoinRequest(
    joinRequestId: string,
    params: AuthTenantReviewJoinRequestParams,
  ): Promise<{ request: AuthTenantJoinRequestPage['requests'][number] }> {
    return this.joinRequestMutation(
      this.joinRequestPath(joinRequestId, 'approve'),
      jsonRequest('POST', params),
      'Failed to approve tenant join request',
    );
  }

  denyJoinRequest(
    joinRequestId: string,
    params: AuthTenantDenyJoinRequestParams,
  ): Promise<{
    request: AuthTenantJoinRequestPage['requests'][number];
  }> {
    return this.joinRequestMutation(
      this.joinRequestPath(joinRequestId, 'deny'),
      jsonRequest('POST', params),
      'Failed to deny tenant join request',
    );
  }

  private async joinRequestMutation(
    path: string,
    init: RequestInit,
    fallback: string,
  ): Promise<{ request: AuthTenantJoinRequest }> {
    return parseJoinRequestMutation(await this.authenticatedRequest(
      path,
      init,
      fallback,
    ));
  }

  private joinRequestPath(id: string, decision: 'approve' | 'deny'): string {
    return `/auth/tenant/join-requests/${encodeURIComponent(id)}/${decision}`;
  }

  private publicRequest<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
    return request(fetch, `${this.options.baseUrl}${path}`, init,
      this.options.createResponseError, fallback);
  }

  private optionalRequest<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
    return request(this.options.optionalAuthenticatedFetch,
      `${this.options.baseUrl}${path}`, init, this.options.createResponseError, fallback,
      this.options.assertResponseCurrent);
  }

  private authenticatedRequest<T>(
    path: string,
    init: RequestInit | undefined,
    fallback: string,
  ): Promise<T> {
    return request(this.options.authenticatedFetch,
      `${this.options.baseUrl}${path}`, init, this.options.createResponseError, fallback,
      this.options.assertResponseCurrent);
  }
}

async function request<T>(
  send: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit | undefined,
  createError: AuthTenantOnboardingTransportOptions['createResponseError'],
  fallback: string,
  assertResponseCurrent?: (response: Response) => void,
): Promise<T> {
  const response = await send(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw createError(response, body, fallback);
  assertResponseCurrent?.(response);
  return body as T;
}

function jsonRequest(method: 'POST', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function query(params: object): string {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      values.set(key, String(value));
    }
  }
  return values.size ? `?${values}` : '';
}

const JOIN_REQUEST_ID = /^[A-Za-z0-9_-]+$/;
const JOIN_REQUEST_ROLE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const JOIN_REQUEST_STATUSES = new Set(['pending', 'approved', 'denied', 'cancelled']);
const MEMBERSHIP_STATUSES = new Set(['active', 'suspended', 'removed']);

/** Fail closed before an untrusted response can drive reviewer controls. */
export function parseJoinRequestPage(value: unknown): AuthTenantJoinRequestPage {
  const pageValue = requireExactRecord(value, ['requests', 'page']);
  const requestsValue = pageValue.requests;
  if (!Array.isArray(requestsValue) || requestsValue.length > 100) throw invalidJoinDto();
  const requests = Object.freeze(requestsValue.map(parseJoinRequest));
  const page = requireExactRecord(pageValue.page, [
    'limit', 'count', 'hasMore', 'nextCursor',
  ]);
  if (!safeInteger(page.limit, 1, 100)
    || !safeInteger(page.count, 0, 100)
    || page.count !== requests.length
    || typeof page.hasMore !== 'boolean'
    || !(page.nextCursor === null
      || boundedString(page.nextCursor, 1, 512))
    || page.hasMore !== (page.nextCursor !== null)) throw invalidJoinDto();
  return Object.freeze({
    requests: [...requests],
    page: Object.freeze({
      limit: page.limit,
      count: page.count,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    }),
  });
}

/** Validate approve/deny responses through the same browser trust boundary. */
export function parseJoinRequestMutation(
  value: unknown,
): { request: AuthTenantJoinRequest } {
  const result = requireExactRecord(value, ['request']);
  return Object.freeze({ request: parseJoinRequest(result.request) });
}

function parseJoinRequest(value: unknown): AuthTenantJoinRequest {
  const request = requireExactRecord(value, [
    'joinRequestId', 'applicant', 'status', 'requestRevision', 'requestedAt',
    'createdAt', 'updatedAt', 'reviewedAt', 'lastDecision', 'membership',
    'reactivationRequired', 'approvalPolicy',
  ]);
  if (!boundedString(request.joinRequestId, 1, 200)
    || !JOIN_REQUEST_ID.test(request.joinRequestId)
    || !JOIN_REQUEST_STATUSES.has(String(request.status))
    || !safeInteger(request.requestRevision, 1, Number.MAX_SAFE_INTEGER)
    || !timestamp(request.requestedAt)
    || !timestamp(request.createdAt)
    || !timestamp(request.updatedAt)
    || !(request.reviewedAt === null || timestamp(request.reviewedAt))
    || !(request.lastDecision === null
      || request.lastDecision === 'approved'
      || request.lastDecision === 'denied')
    || typeof request.reactivationRequired !== 'boolean') throw invalidJoinDto();

  const applicant = requireExactRecord(request.applicant, [
    'userId', 'username', 'email', 'firstName', 'lastName',
  ]);
  if (!boundedString(applicant.userId, 1, 200)
    || !boundedString(applicant.username, 1, 200)
    || !boundedString(applicant.email, 3, 320)
    || !nullableString(applicant.firstName, 200)
    || !nullableString(applicant.lastName, 200)) throw invalidJoinDto();

  let membership: AuthTenantJoinRequest['membership'] = null;
  if (request.membership !== null) {
    const candidate = requireExactRecord(request.membership, [
      'membershipId', 'status', 'roles',
    ]);
    if (!boundedString(candidate.membershipId, 1, 200)
      || !MEMBERSHIP_STATUSES.has(String(candidate.status))) throw invalidJoinDto();
    const roles = parseRoleKeys(candidate.roles, 0);
    membership = Object.freeze({
      membershipId: candidate.membershipId,
      status: candidate.status as NonNullable<AuthTenantJoinRequest['membership']>['status'],
      roles: [...roles],
    });
  }

  return Object.freeze({
    joinRequestId: request.joinRequestId,
    applicant: Object.freeze({
      userId: applicant.userId,
      username: applicant.username,
      email: applicant.email,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
    }),
    status: request.status as AuthTenantJoinRequest['status'],
    requestRevision: request.requestRevision,
    requestedAt: request.requestedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    reviewedAt: request.reviewedAt,
    lastDecision: request.lastDecision,
    membership,
    reactivationRequired: request.reactivationRequired,
    approvalPolicy: parseApprovalPolicy(request.approvalPolicy),
  });
}

function parseApprovalPolicy(
  value: unknown,
): AuthTenantJoinRequest['approvalPolicy'] {
  const policy = requireExactRecord(value, ['canApprove', 'roleSelection']);
  if (typeof policy.canApprove !== 'boolean') throw invalidJoinDto();
  const selection = requireRecord(policy.roleSelection);
  const mode = selection.mode;
  if (mode === 'fixed' || mode === 'default') {
    assertExactKeys(selection, ['mode', 'roles']);
    const roles = parseApprovalRoles(selection.roles);
    if (roles.length !== 1) throw invalidJoinDto();
    return Object.freeze({
      canApprove: policy.canApprove,
      roleSelection: Object.freeze({ mode, roles: [...roles] }),
    });
  }
  if (mode !== 'selectable') throw invalidJoinDto();
  assertExactKeys(selection, ['mode', 'defaultRoleKeys', 'maxRoleCount', 'roles']);
  const roles = parseApprovalRoles(selection.roles);
  const defaultRoleKeys = parseRoleKeys(selection.defaultRoleKeys, 1);
  if (!safeInteger(selection.maxRoleCount, 1, 32)
    || roles.length < 1
    || defaultRoleKeys.length > selection.maxRoleCount
    || defaultRoleKeys.some((key) => !roles.some((role) => role.key === key))) {
    throw invalidJoinDto();
  }
  return Object.freeze({
    canApprove: policy.canApprove,
    roleSelection: Object.freeze({
      mode,
      defaultRoleKeys: [...defaultRoleKeys],
      maxRoleCount: selection.maxRoleCount,
      roles: [...roles],
    }),
  });
}

function parseApprovalRoles(
  value: unknown,
): AuthTenantJoinRequest['approvalPolicy']['roleSelection']['roles'] {
  if (!Array.isArray(value) || value.length > 32) throw invalidJoinDto();
  const seen = new Set<string>();
  return value.map((entry) => {
    const role = requireExactRecord(entry, ['key', 'label']);
    if (!boundedString(role.key, 1, 64) || !JOIN_REQUEST_ROLE.test(role.key)
      || !boundedString(role.label, 1, 200) || seen.has(role.key)) throw invalidJoinDto();
    seen.add(role.key);
    return Object.freeze({ key: role.key, label: role.label });
  });
}

function parseRoleKeys(value: unknown, minimum: 0 | 1): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 32) {
    throw invalidJoinDto();
  }
  const roles = value.filter((key): key is string => (
    boundedString(key, 1, 64) && JOIN_REQUEST_ROLE.test(key)
  ));
  if (roles.length !== value.length || new Set(roles).size !== roles.length) {
    throw invalidJoinDto();
  }
  return Object.freeze(roles);
}

function requireExactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, any> {
  const record = requireRecord(value);
  assertExactKeys(record, keys);
  return record;
}

function requireRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidJoinDto();
  return value as Record<string, any>;
}

function assertExactKeys(value: Record<string, any>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) throw invalidJoinDto();
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function nullableString(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maximum);
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function timestamp(value: unknown): value is number {
  return safeInteger(value, 0, 8_640_000_000_000_000);
}

function invalidJoinDto(): Error {
  return new Error('[client] Zero returned an invalid tenant join-request response.');
}
