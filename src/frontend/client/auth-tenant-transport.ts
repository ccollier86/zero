/** Browser transport for tenant selection and refresh-family-backed switching. */

import { AuthClientError, createAuthClientError } from './auth-errors';
import {
  parseAuthSessionResult,
  parseAuthTenantListResult,
} from './auth-completion-parser';
import type {
  AuthSessionResult,
  AuthSessionTransitionOperation,
  AuthTenantCreateParams,
  AuthTenantListResult,
} from './auth-types';

export interface AuthTenantTransportOptions {
  baseUrl: string;
  getRefreshToken: () => string | null;
  getRevision: () => number;
  runCredentialOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  commitScopeAuthentication: (result: AuthSessionResult) => AuthSessionResult;
  expireSessionAtRevision: (revision: number) => Promise<void>;
  beginScopeTransition: (operation: AuthSessionTransitionOperation) => void;
  completeScopeTransition: () => Promise<void>;
  abortScopeTransition: () => Promise<void>;
}

export class AuthTenantTransport {
  private switchPromise: Promise<AuthSessionResult> | null = null;
  private createPromise: Promise<AuthSessionResult> | null = null;

  constructor(private readonly options: AuthTenantTransportOptions) {}

  async selectTenant(
    continuation: string,
    tenantId: string,
    assertStartingScopeCurrent: () => void = () => {},
  ): Promise<AuthSessionResult> {
    return this.options.runCredentialOperation(async () => {
      assertStartingScopeCurrent();
      this.options.beginScopeTransition('tenant-select');
      let committed = false;
      try {
        const response = await fetch(
          `${this.options.baseUrl}/auth/tenants/select`,
          jsonRequest({ continuation, tenantId }),
        );
        if (!response.ok) {
          throw await responseError(response, 'Failed to select tenant');
        }
        const result = this.options.commitScopeAuthentication(
          parseAuthSessionResult(await response.json()),
        );
        committed = true;
        await this.options.completeScopeTransition();
        return result;
      } catch (error) {
        if (!committed) await this.options.abortScopeTransition();
        throw error;
      }
    });
  }

  async listTenants(
    signal?: AbortSignal,
    assertStartingScopeCurrent: () => void = () => {},
  ): Promise<AuthTenantListResult> {
    let revision: number | null = null;
    let expireRejectedSession = false;
    try {
      // Listing proves the live refresh family without rotating it. It must
      // still share the browser-wide credential lock with refresh/switch:
      // dispatching an old proof after a concurrent rotation is interpreted
      // by the server as a replay and deliberately revokes the whole family.
      return await this.options.runCredentialOperation(async () => {
        assertStartingScopeCurrent();
        const refreshToken = this.requireRefreshToken();
        revision = this.options.getRevision();
        const response = await fetch(
          `${this.options.baseUrl}/auth/tenants/list`,
          { ...jsonRequest({ refreshToken }), signal },
        );
        if (!response.ok) {
          expireRejectedSession = response.status === 401;
          throw await responseError(response, 'Failed to load tenants');
        }
        return parseAuthTenantListResult(await response.json());
      });
    } catch (error) {
      // Session expiry takes the same credential lock, so perform it only
      // after the listing operation has released that lock.
      if (expireRejectedSession && revision !== null) {
        await this.options.expireSessionAtRevision(revision);
      }
      throw error;
    }
  }

  /** Create and activate an owned tenant using onboarding or refresh proof. */
  createTenant(
    params: AuthTenantCreateParams,
    assertStartingScopeCurrent: () => void = () => {},
  ): Promise<AuthSessionResult> {
    if (this.createPromise) return this.createPromise;
    const operation = this.performCreate(params, assertStartingScopeCurrent);
    this.createPromise = operation;
    void operation.finally(() => {
      if (this.createPromise === operation) this.createPromise = null;
    }).catch(() => undefined);
    return operation;
  }

  private async performCreate(
    params: AuthTenantCreateParams,
    assertStartingScopeCurrent: () => void,
  ): Promise<AuthSessionResult> {
    const revision = this.options.getRevision();
    let expireRejectedSession = false;
    try {
      return await this.options.runCredentialOperation(async () => {
        assertStartingScopeCurrent();
        const proof = params.continuation
          ? { continuation: params.continuation }
          : { refreshToken: this.requireRefreshToken() };
        this.options.beginScopeTransition('tenant-create');
        let committed = false;
        try {
          const response = await fetch(
            `${this.options.baseUrl}/auth/tenants/create`,
            jsonRequest({
              name: params.name,
              ...(params.slug ? { slug: params.slug } : {}),
              ...proof,
            }),
          );
          if (!response.ok) {
            expireRejectedSession = !params.continuation && response.status === 401;
            throw await responseError(response, 'Failed to create tenant');
          }
          const result = this.options.commitScopeAuthentication(
            parseAuthSessionResult(await response.json()),
          );
          committed = true;
          await this.options.completeScopeTransition();
          return result;
        } catch (error) {
          if (!committed) await this.options.abortScopeTransition();
          throw error;
        }
      });
    } catch (error) {
      if (expireRejectedSession) await this.options.expireSessionAtRevision(revision);
      throw error;
    }
  }

  /** Deduplicate browser switch calls so one stored refresh token is used once. */
  switchTenant(
    tenantId: string,
    assertStartingScopeCurrent: () => void = () => {},
  ): Promise<AuthSessionResult> {
    if (this.switchPromise) return this.switchPromise;
    const operation = this.performSwitch(tenantId, assertStartingScopeCurrent);
    this.switchPromise = operation;
    void operation.finally(() => {
      if (this.switchPromise === operation) this.switchPromise = null;
    }).catch(() => undefined);
    return operation;
  }

  private async performSwitch(
    tenantId: string,
    assertStartingScopeCurrent: () => void,
  ): Promise<AuthSessionResult> {
    const revision = this.options.getRevision();
    let expireRejectedSession = false;
    try {
      return await this.options.runCredentialOperation(async () => {
        assertStartingScopeCurrent();
        const refreshToken = this.requireRefreshToken();
        this.options.beginScopeTransition('tenant-switch');
        let committed = false;
        try {
          const response = await fetch(
            `${this.options.baseUrl}/auth/tenants/switch`,
            jsonRequest({ refreshToken, tenantId }),
          );
          if (!response.ok) {
            expireRejectedSession = response.status === 401;
            throw await responseError(response, 'Failed to switch tenant');
          }
          const result = this.options.commitScopeAuthentication(
            parseAuthSessionResult(await response.json()),
          );
          committed = true;
          await this.options.completeScopeTransition();
          return result;
        } catch (error) {
          if (!committed) await this.options.abortScopeTransition();
          throw error;
        }
      });
    } catch (error) {
      if (expireRejectedSession) await this.options.expireSessionAtRevision(revision);
      throw error;
    }
  }

  private requireRefreshToken(): string {
    const refreshToken = this.options.getRefreshToken();
    if (!refreshToken) {
      throw new AuthClientError(
        'A current browser session is required',
        401,
        'UNAUTHORIZED',
        null,
      );
    }
    return refreshToken;
  }
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return createAuthClientError(response, body, fallback);
}
