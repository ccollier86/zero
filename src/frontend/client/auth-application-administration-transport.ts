import type {
  AuthApplicationAdministrationConfig,
  AuthApplicationAdminSdkSurface,
  AuthApplicationOwnershipTransferResult,
  AuthApplicationRoleMutationResult,
  AuthApplicationUserListParams,
  AuthApplicationUserPage,
} from './auth-application-administration-types';

export interface AuthApplicationAdministrationTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
  /** Refresh the bearer and reconnect scoped clients after a self-authority change. */
  refreshAuthorization: (response: Response) => Promise<boolean>;
}

/** Authenticated transport for the implicit single-application scope. */
export class AuthApplicationAdministrationTransport
implements AuthApplicationAdminSdkSurface {
  constructor(private readonly options: AuthApplicationAdministrationTransportOptions) {}

  async getConfig(): Promise<AuthApplicationAdministrationConfig> {
    const request = await this.request<AuthApplicationAdministrationConfig>(
      '/auth/application/config',
      undefined,
      'Failed to load application access',
    );
    this.options.assertResponseCurrent(request.response);
    return request.result;
  }

  async listUsers(
    params: AuthApplicationUserListParams = {},
  ): Promise<AuthApplicationUserPage> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    const suffix = query.size > 0 ? `?${query}` : '';
    const request = await this.request<AuthApplicationUserPage>(
      `/auth/application/users${suffix}`,
      undefined,
      'Failed to load application users',
    );
    this.options.assertResponseCurrent(request.response);
    return request.result;
  }

  replaceUserRoles(
    userId: string,
    roles: readonly string[],
    expectedRevision: string,
  ): Promise<AuthApplicationRoleMutationResult> {
    return this.mutation(
      `/auth/application/users/${encodeURIComponent(userId)}/roles`,
      jsonRequest('PATCH', { roles, expectedRevision }),
      'Failed to update application roles',
    );
  }

  transferOwnership(userId: string): Promise<AuthApplicationOwnershipTransferResult> {
    return this.mutation(
      '/auth/application/ownership/transfer',
      jsonRequest('POST', { userId }),
      'Failed to transfer application ownership',
    );
  }

  private async mutation<T extends { actorAuthorizationChanged: boolean }>(
    path: string,
    init: RequestInit,
    fallback: string,
  ): Promise<T> {
    const { result, response } = await this.request<T>(path, init, fallback);
    this.options.assertResponseCurrent(response);
    if (result.actorAuthorizationChanged) {
      // The mutation is already committed. Reconnection is best-effort and a
      // local refresh failure must not turn success into a retryable write.
      try {
        const responseScopeRemainsCurrent = await this.options.refreshAuthorization(response);
        if (!responseScopeRemainsCurrent) return result;
      } catch {
        // A transient same-scope refresh failure does not erase the committed
        // result, but an external scope replacement still fails this check.
        this.options.assertResponseCurrent(response);
      }
    }
    this.options.assertResponseCurrent(response);
    return result;
  }

  private async request<T>(
    path: string,
    init: RequestInit | undefined,
    fallback: string,
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
    return { result: body as T, response };
  }
}

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
