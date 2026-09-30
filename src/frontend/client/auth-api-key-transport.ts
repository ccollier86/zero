/** Authenticated browser transport for Guardian API-key management. */

import {
  parseAuthApiKeyPage,
  parseAuthApiKeySummary,
  parseIssuedAuthApiKey,
} from './auth-api-key-parser';
import type {
  AuthApiKeyApplicationAdminSdkSurface,
  AuthApiKeyIssueInput,
  AuthApiKeyListQuery,
  AuthApiKeyPlatformAdminSdkSurface,
  AuthApiKeySdkSurface,
  AuthApiKeySelfSdkSurface,
  AuthApiKeyTenantAdminSdkSurface,
  AuthPlatformApiKeyListQuery,
} from './auth-api-key-types';

export interface AuthApiKeyTransportOptions {
  readonly baseUrl: string;
  readonly authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly createResponseError: (
    response: Response,
    body: unknown,
    fallback: string,
  ) => Error;
  readonly assertResponseCurrent: (response: Response) => void;
}

export class AuthApiKeyTransport implements AuthApiKeySdkSurface {
  readonly self: AuthApiKeySelfSdkSurface;
  readonly applicationAdmin: AuthApiKeyApplicationAdminSdkSurface;
  readonly tenantAdmin: AuthApiKeyTenantAdminSdkSurface;
  readonly platformAdmin: AuthApiKeyPlatformAdminSdkSurface;

  constructor(private readonly options: AuthApiKeyTransportOptions) {
    this.self = Object.freeze({
      list: (query: AuthApiKeyListQuery = {}) => this.list('/auth/api-keys', query),
      issue: (input: AuthApiKeyIssueInput) => this.issue('/auth/api-keys', input),
      rotate: (keyId: string, input: AuthApiKeyIssueInput) => this.issue(
        `/auth/api-keys/${segment(keyId)}/rotate`, input,
      ),
      revoke: (keyId: string) => this.revoke(`/auth/api-keys/${segment(keyId)}`),
    });
    this.applicationAdmin = Object.freeze({
      listUser: (userId: string, query: AuthApiKeyListQuery = {}) => this.list(
        `/auth/admin/users/${segment(userId)}/api-keys`, query,
      ),
      issueUser: (userId: string, input: AuthApiKeyIssueInput) => this.issue(
        `/auth/admin/users/${segment(userId)}/api-keys`, input,
      ),
      rotate: (keyId: string, input: AuthApiKeyIssueInput) => this.issue(
        `/auth/admin/api-keys/${segment(keyId)}/rotate`, input,
      ),
      revoke: (keyId: string) => this.revoke(
        `/auth/admin/api-keys/${segment(keyId)}`,
      ),
    });
    this.tenantAdmin = Object.freeze({
      listMember: (membershipId: string, query: AuthApiKeyListQuery = {}) => this.list(
        `/auth/tenant/members/${segment(membershipId)}/api-keys`, query,
      ),
      issueMember: (membershipId: string, input: AuthApiKeyIssueInput) => this.issue(
        `/auth/tenant/members/${segment(membershipId)}/api-keys`, input,
      ),
      rotate: (keyId: string, input: AuthApiKeyIssueInput) => this.issue(
        `/auth/tenant/api-keys/${segment(keyId)}/rotate`, input,
      ),
      revoke: (keyId: string) => this.revoke(
        `/auth/tenant/api-keys/${segment(keyId)}`,
      ),
    });
    this.platformAdmin = Object.freeze({
      list: (query: AuthPlatformApiKeyListQuery = {}) => this.platformList(query),
      listMember: (
        tenantId: string,
        membershipId: string,
        query: AuthApiKeyListQuery = {},
      ) => this.list(this.platformMemberPath(tenantId, membershipId), query),
      issueMember: (
        tenantId: string,
        membershipId: string,
        input: AuthApiKeyIssueInput,
      ) => this.issue(this.platformMemberPath(tenantId, membershipId), input),
      rotate: (keyId: string, input: AuthApiKeyIssueInput) => this.issue(
        `/auth/platform/api-keys/${segment(keyId)}/rotate`, input,
      ),
      revoke: (keyId: string) => this.revoke(
        `/auth/platform/api-keys/${segment(keyId)}`,
      ),
    });
  }

  private list(path: string, query: AuthApiKeyListQuery) {
    return this.request(
      `${path}${listQuery(query)}`,
      undefined,
      'Failed to load API keys',
      parseAuthApiKeyPage,
    );
  }

  private platformList(query: AuthPlatformApiKeyListQuery) {
    const values = listQueryValues(query);
    if (query.tenantId !== undefined && query.tenantId !== '') {
      values.set('tenantId', query.tenantId);
    }
    return this.request(
      `/auth/platform/api-keys${values.size ? `?${values}` : ''}`,
      undefined,
      'Failed to load platform API keys',
      parseAuthApiKeyPage,
    );
  }

  private issue(path: string, input: AuthApiKeyIssueInput) {
    return this.request(
      path,
      jsonRequest(input),
      'Failed to issue API key',
      parseIssuedAuthApiKey,
    );
  }

  private revoke(path: string) {
    return this.request(
      path,
      { method: 'DELETE' },
      'Failed to revoke API key',
      parseAuthApiKeySummary,
    );
  }

  private platformMemberPath(tenantId: string, membershipId: string): string {
    return `/auth/platform/tenants/${segment(tenantId)}`
      + `/members/${segment(membershipId)}/api-keys`;
  }

  private async request<T>(
    path: string,
    init: RequestInit | undefined,
    fallback: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}${path}`,
      { ...init, cache: 'no-store' },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw this.options.createResponseError(response, body, fallback);
    }
    const result = parse(body);
    this.options.assertResponseCurrent(response);
    return result;
  }
}

function listQuery(query: AuthApiKeyListQuery): string {
  const values = listQueryValues(query);
  return values.size ? `?${values}` : '';
}

function listQueryValues(query: AuthApiKeyListQuery): URLSearchParams {
  const values = new URLSearchParams();
  if (query.limit !== undefined) values.set('limit', String(query.limit));
  if (query.cursor !== undefined && query.cursor !== '') values.set('cursor', query.cursor);
  return values;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function jsonRequest(body: AuthApiKeyIssueInput): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
