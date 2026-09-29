/** Authenticated browser transport for protected platform administration. */

import type {
  AuthTenantAddMemberParams,
  AuthTenantInvitation,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantUpdateMemberParams,
} from './auth-types';
import type {
  AuthPlatformAdministrationConfig,
  AuthPlatformAdminSdkSurface,
  AuthPlatformTenantCreateParams,
  AuthPlatformTenantCreateResult,
  AuthPlatformTenantListParams,
  AuthPlatformTenantPage,
  AuthPlatformTenantUpdateParams,
  AuthPlatformTenantUpdateResult,
} from './auth-platform-administration-types';
import {
  parsePlatformAdministrationConfig,
  parsePlatformInvitationIssue,
  parsePlatformInvitationPage,
  parsePlatformInvitationReceipt,
  parsePlatformMemberMutation,
  parsePlatformMemberPage,
  parsePlatformOwnershipTransfer,
  parsePlatformTenantCreate,
  parsePlatformTenantPage,
  parsePlatformTenantUpdate,
} from './auth-platform-administration-parser';

export interface AuthPlatformAdministrationTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
  expireSession: (response: Response) => void;
}

/**
 * Uses only server-derived administration scope. The administration tenant ID
 * is intentionally absent from every member and invitation request.
 */
export class AuthPlatformAdministrationTransport
implements AuthPlatformAdminSdkSurface {
  constructor(private readonly options: AuthPlatformAdministrationTransportOptions) {}

  getConfig(): Promise<AuthPlatformAdministrationConfig> {
    return this.read(
      '/auth/platform/config',
      'Failed to load platform administration',
      parsePlatformAdministrationConfig,
    );
  }

  listMembers(params: AuthTenantMemberListParams = {}): Promise<AuthTenantMemberPage> {
    return this.read(
      `/auth/platform/members${query(params)}`,
      'Failed to load administration members',
      parsePlatformMemberPage,
    );
  }

  addMember(params: AuthTenantAddMemberParams): Promise<AuthTenantMemberMutationResult> {
    return this.memberMutation(
      '/auth/platform/members',
      jsonRequest('POST', params),
      'Failed to add administration member',
      parsePlatformMemberMutation,
    );
  }

  updateMember(
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMemberMutationResult> {
    return this.memberMutation(
      this.memberPath(membershipId),
      jsonRequest('PATCH', params),
      'Failed to update administration member',
      parsePlatformMemberMutation,
    );
  }

  removeMember(membershipId: string): Promise<AuthTenantMemberMutationResult> {
    return this.memberMutation(
      this.memberPath(membershipId),
      { method: 'DELETE' },
      'Failed to remove administration member',
      parsePlatformMemberMutation,
    );
  }

  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult> {
    return this.memberMutation(
      '/auth/platform/ownership/transfer',
      jsonRequest('POST', { membershipId }),
      'Failed to transfer administration ownership',
      parsePlatformOwnershipTransfer,
    );
  }

  listInvitations(
    params: AuthTenantInvitationListParams = {},
  ): Promise<AuthTenantInvitationPage> {
    return this.read(
      `/auth/platform/invitations${query(params)}`,
      'Failed to load administration invitations',
      parsePlatformInvitationPage,
    );
  }

  issueInvitation(
    params: AuthTenantIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult> {
    return this.write(
      '/auth/platform/invitations',
      jsonRequest('POST', params),
      'Failed to issue administration invitation',
      parsePlatformInvitationIssue,
    );
  }

  revokeInvitation(invitationId: string): Promise<{ invitation: AuthTenantInvitation }> {
    return this.write(
      `/auth/platform/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' },
      'Failed to revoke administration invitation',
      parsePlatformInvitationReceipt,
    );
  }

  listTenants(params: AuthPlatformTenantListParams = {}): Promise<AuthPlatformTenantPage> {
    return this.read(
      `/auth/platform/tenants${query(params)}`,
      'Failed to load customer organizations',
      parsePlatformTenantPage,
    );
  }

  createTenant(
    params: AuthPlatformTenantCreateParams,
  ): Promise<AuthPlatformTenantCreateResult> {
    return this.write(
      '/auth/platform/tenants',
      jsonRequest('POST', params),
      'Failed to create customer organization',
      parsePlatformTenantCreate,
    );
  }

  updateTenant(
    tenantId: string,
    params: AuthPlatformTenantUpdateParams,
  ): Promise<AuthPlatformTenantUpdateResult> {
    return this.write(
      `/auth/platform/tenants/${encodeURIComponent(tenantId)}`,
      jsonRequest('PATCH', params),
      'Failed to update customer organization',
      parsePlatformTenantUpdate,
    );
  }

  listTenantMembers(
    tenantId: string,
    params: AuthTenantMemberListParams = {},
  ): Promise<AuthTenantMemberPage> {
    return this.read(
      `/auth/platform/tenants/${encodeURIComponent(tenantId)}/members${query(params)}`,
      'Failed to load customer organization members',
      parsePlatformMemberPage,
    );
  }

  private memberPath(membershipId: string): string {
    return `/auth/platform/members/${encodeURIComponent(membershipId)}`;
  }

  private async memberMutation<T extends { actorSessionInvalidated: boolean }>(
    path: string,
    init: RequestInit,
    fallback: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const request = await this.request(path, init, fallback, parse);
    this.options.assertResponseCurrent(request.response);
    if (request.result.actorSessionInvalidated) {
      this.options.expireSession(request.response);
      return request.result;
    }
    this.options.assertResponseCurrent(request.response);
    return request.result;
  }

  private async read<T>(
    path: string,
    fallback: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const request = await this.request(path, undefined, fallback, parse);
    this.options.assertResponseCurrent(request.response);
    return request.result;
  }

  private async write<T>(
    path: string,
    init: RequestInit,
    fallback: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const request = await this.request(path, init, fallback, parse);
    this.options.assertResponseCurrent(request.response);
    return request.result;
  }

  private async request<T>(
    path: string,
    init: RequestInit | undefined,
    fallback: string,
    parse: (value: unknown) => T,
  ): Promise<{ result: T; response: Response }> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}${path}`,
      { ...init, cache: 'no-store' },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw this.options.createResponseError(response, body, fallback);
    }
    this.options.assertResponseCurrent(response);
    return { result: parse(body), response };
  }
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

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
