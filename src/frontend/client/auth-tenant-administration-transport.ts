/** Authenticated browser transport for the active tenant control plane. */

import type {
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantUpdateMemberParams,
} from './auth-types';
import {
  parseTenantAdministrationConfig,
  parseTenantMemberMutation,
  parseTenantMemberPage,
  parseTenantOwnershipTransfer,
} from './auth-tenant-administration-parser';

export interface AuthTenantAdministrationTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
  expireSession: (response: Response) => void;
}

export class AuthTenantAdministrationTransport {
  constructor(private readonly options: AuthTenantAdministrationTransportOptions) {}

  async getConfig(): Promise<AuthTenantAdministrationConfig> {
    const request = await this.request(
      '/auth/tenant/config', undefined, 'Failed to load tenant access',
      parseTenantAdministrationConfig,
    );
    this.options.assertResponseCurrent(request.response);
    return request.result;
  }

  async listMembers(
    params: AuthTenantMemberListParams = {},
  ): Promise<AuthTenantMemberPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }
    const suffix = query.size ? `?${query}` : '';
    const request = await this.request(
      `/auth/tenant/members${suffix}`,
      undefined,
      'Failed to load tenant members',
      parseTenantMemberPage,
    );
    this.options.assertResponseCurrent(request.response);
    return request.result;
  }

  addMember(params: AuthTenantAddMemberParams): Promise<AuthTenantMemberMutationResult> {
    return this.mutation(
      '/auth/tenant/members',
      jsonRequest('POST', params),
      'Failed to add tenant member',
      parseTenantMemberMutation,
    );
  }

  updateMember(
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMemberMutationResult> {
    return this.mutation(
      this.memberPath(membershipId),
      jsonRequest('PATCH', params),
      'Failed to update tenant member',
      parseTenantMemberMutation,
    );
  }

  removeMember(membershipId: string): Promise<AuthTenantMemberMutationResult> {
    return this.mutation(
      this.memberPath(membershipId),
      { method: 'DELETE' },
      'Failed to remove tenant member',
      parseTenantMemberMutation,
    );
  }

  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult> {
    return this.mutation(
      '/auth/tenant/ownership/transfer',
      jsonRequest('POST', { membershipId }),
      'Failed to transfer tenant ownership',
      parseTenantOwnershipTransfer,
    );
  }

  private memberPath(membershipId: string): string {
    return `/auth/tenant/members/${encodeURIComponent(membershipId)}`;
  }

  private async mutation<T extends { actorSessionInvalidated: boolean }>(
    path: string,
    init: RequestInit,
    fallback: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const { result, response } = await this.request(path, init, fallback, parse);
    this.options.assertResponseCurrent(response);
    if (result.actorSessionInvalidated) {
      // The response was proven current immediately before the mutation's
      // intentional local logout. Do not classify that owned transition as a
      // stale external completion.
      this.options.expireSession(response);
      return result;
    }
    this.options.assertResponseCurrent(response);
    return result;
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

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
