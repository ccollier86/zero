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
import {
  parseJoinRequestMutation,
  parseJoinRequestPage,
  parseTenantInvitationAcceptance,
  parseTenantInvitationInspection,
} from './auth-tenant-onboarding-parser';
import {
  parseTenantInvitationIssue,
  parseTenantInvitationPage,
  parseTenantInvitationReceipt,
  parseTenantJoinRequestSubmission,
} from './auth-tenant-administration-parser';

// Keep these parser exports stable for callers that used the original
// transport module as their response-boundary entry point.
export {
  parseJoinRequestMutation,
  parseJoinRequestPage,
  parseTenantInvitationAcceptance,
  parseTenantInvitationInspection,
} from './auth-tenant-onboarding-parser';

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

  async inspectInvitation(token: string): Promise<AuthTenantInvitationInspection> {
    return parseTenantInvitationInspection(await this.publicRequest(
      '/auth/invitations/inspect',
      jsonRequest('POST', { token }),
      'Invitation is unavailable',
    ));
  }

  async acceptInvitation(
    params: AuthTenantAcceptInvitationParams,
  ): Promise<AuthTenantInvitationAcceptanceResult> {
    const attempt = this.options.beginAuthentication();
    try {
      const response = await this.options.optionalAuthenticatedFetch(
        `${this.options.baseUrl}/auth/invitations/accept`,
        { ...jsonRequest('POST', params), signal: attempt.signal, cache: 'no-store' },
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
      let result: AuthTenantInvitationAcceptanceResult;
      try {
        result = parseTenantInvitationAcceptance(body);
      } catch (error) {
        attempt.assertCurrent();
        this.options.failAuthentication('Invalid invitation response', attempt);
        throw error;
      }
      return this.options.completeAuthentication(
        result,
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
    ).then(parseTenantJoinRequestSubmission);
  }

  listInvitations(
    params: AuthTenantInvitationListParams = {},
  ): Promise<AuthTenantInvitationPage> {
    return this.authenticatedRequest(
      `/auth/tenant/invitations${query(params)}`,
      undefined,
      'Failed to load tenant invitations',
    ).then(parseTenantInvitationPage);
  }

  issueInvitation(
    params: AuthTenantIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult> {
    return this.authenticatedRequest(
      '/auth/tenant/invitations',
      jsonRequest('POST', params),
      'Failed to issue tenant invitation',
    ).then(parseTenantInvitationIssue);
  }

  revokeInvitation(invitationId: string): Promise<{
    invitation: AuthTenantIssueInvitationResult['invitation'];
  }> {
    return this.authenticatedRequest(
      `/auth/tenant/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' },
      'Failed to revoke tenant invitation',
    ).then(parseTenantInvitationReceipt);
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
  ): Promise<{ request: AuthTenantJoinRequestPage['requests'][number] }> {
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
  const response = await send(url, { ...init, cache: 'no-store' });
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
