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

export interface AuthTenantScopeAttempt {
  /** Cancel preflight I/O when another browser authorization scope wins. */
  readonly signal?: AbortSignal;
  /** Assert the request still belongs to the scope that dispatched it. */
  assertCurrent(): void;
  /** Hand lifecycle ownership to the transition immediately before commit. */
  consumeStartingScope(): void;
}

interface PendingTenantOperation {
  readonly key: string;
  readonly promise: Promise<AuthSessionResult>;
}

export class AuthTenantTransport {
  private scopeOperation: PendingTenantOperation | null = null;

  constructor(private readonly options: AuthTenantTransportOptions) {}

  selectTenant(
    continuation: string,
    tenantId: string,
    attempt: AuthTenantScopeAttempt = NOOP_SCOPE_ATTEMPT,
  ): Promise<AuthSessionResult> {
    return this.startScopeOperation(
      selectIntentKey(this.options.getRevision(), continuation, tenantId),
      'AUTH_TENANT_SELECT_IN_PROGRESS',
      'Another tenant scope change is already in progress; selection was not started.',
      () => this.performSelect(continuation, tenantId, attempt),
    );
  }

  private performSelect(
    continuation: string,
    tenantId: string,
    attempt: AuthTenantScopeAttempt,
  ): Promise<AuthSessionResult> {
    return this.options.runCredentialOperation(async () => {
      attempt.assertCurrent();
      const response = await fetch(
        `${this.options.baseUrl}/auth/tenants/select`,
        { ...jsonRequest({ continuation, tenantId }), signal: attempt.signal },
      );
      if (!response.ok) {
        const error = await responseError(response, 'Failed to select tenant');
        attempt.assertCurrent();
        throw error;
      }
      const result = await parseCurrentSession(response, attempt);
      attempt.consumeStartingScope();
      let committed = false;
      try {
        this.options.beginScopeTransition('tenant-select');
        this.options.commitScopeAuthentication(result);
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
    attempt: AuthTenantScopeAttempt = NOOP_SCOPE_ATTEMPT,
  ): Promise<AuthSessionResult> {
    return this.startScopeOperation(
      createIntentKey(this.options.getRevision(), params),
      'AUTH_TENANT_CREATE_IN_PROGRESS',
      'Another tenant scope change is already in progress; creation was not started.',
      () => this.performCreate(params, attempt),
    );
  }

  private async performCreate(
    params: AuthTenantCreateParams,
    attempt: AuthTenantScopeAttempt,
  ): Promise<AuthSessionResult> {
    const revision = this.options.getRevision();
    let expireRejectedSession = false;
    try {
      return await this.options.runCredentialOperation(async () => {
        attempt.assertCurrent();
        const proof = params.continuation
          ? { continuation: params.continuation }
          : { refreshToken: this.requireRefreshToken() };
        const response = await fetch(
          `${this.options.baseUrl}/auth/tenants/create`,
          {
            ...jsonRequest({
              name: params.name,
              ...(params.slug ? { slug: params.slug } : {}),
              ...proof,
            }),
            signal: attempt.signal,
          },
        );
        if (!response.ok) {
          expireRejectedSession = !params.continuation && response.status === 401;
          const error = await responseError(response, 'Failed to create tenant');
          attempt.assertCurrent();
          throw error;
        }
        const result = await parseCurrentSession(response, attempt);
        attempt.consumeStartingScope();
        let committed = false;
        try {
          this.options.beginScopeTransition('tenant-create');
          this.options.commitScopeAuthentication(result);
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
    attempt: AuthTenantScopeAttempt = NOOP_SCOPE_ATTEMPT,
  ): Promise<AuthSessionResult> {
    return this.startScopeOperation(
      switchIntentKey(this.options.getRevision(), tenantId),
      'AUTH_TENANT_SWITCH_IN_PROGRESS',
      'Another tenant scope change is already in progress; switch was not started.',
      () => this.performSwitch(tenantId, attempt),
    );
  }

  private startScopeOperation(
    key: string,
    conflictCode: string,
    conflictMessage: string,
    start: () => Promise<AuthSessionResult>,
  ): Promise<AuthSessionResult> {
    if (this.scopeOperation) {
      if (this.scopeOperation.key === key) return this.scopeOperation.promise;
      return Promise.reject(tenantOperationConflict(conflictCode, conflictMessage));
    }
    const operation = start();
    this.scopeOperation = { key, promise: operation };
    void operation.finally(() => {
      if (this.scopeOperation?.promise === operation) this.scopeOperation = null;
    }).catch(() => undefined);
    return operation;
  }

  private async performSwitch(
    tenantId: string,
    attempt: AuthTenantScopeAttempt,
  ): Promise<AuthSessionResult> {
    const revision = this.options.getRevision();
    let expireRejectedSession = false;
    try {
      return await this.options.runCredentialOperation(async () => {
        attempt.assertCurrent();
        const refreshToken = this.requireRefreshToken();
        const response = await fetch(
          `${this.options.baseUrl}/auth/tenants/switch`,
          { ...jsonRequest({ refreshToken, tenantId }), signal: attempt.signal },
        );
        if (!response.ok) {
          expireRejectedSession = response.status === 401;
          const error = await responseError(response, 'Failed to switch tenant');
          attempt.assertCurrent();
          throw error;
        }
        const result = await parseCurrentSession(response, attempt);
        attempt.consumeStartingScope();
        let committed = false;
        try {
          this.options.beginScopeTransition('tenant-switch');
          this.options.commitScopeAuthentication(result);
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

const NOOP_SCOPE_ATTEMPT: AuthTenantScopeAttempt = Object.freeze({
  assertCurrent() {},
  consumeStartingScope() {},
});

function selectIntentKey(
  revision: number,
  continuation: string,
  tenantId: string,
): string {
  return JSON.stringify(['select', revision, continuation, tenantId]);
}

function createIntentKey(revision: number, params: AuthTenantCreateParams): string {
  return JSON.stringify([
    'create',
    revision,
    params.name,
    params.slug ?? null,
    params.continuation ?? null,
  ]);
}

function switchIntentKey(revision: number, tenantId: string): string {
  return JSON.stringify(['switch', revision, tenantId]);
}

function tenantOperationConflict(code: string, message: string): AuthClientError {
  return new AuthClientError(message, 409, code, null);
}

async function parseCurrentSession(
  response: Response,
  attempt: AuthTenantScopeAttempt,
): Promise<AuthSessionResult> {
  try {
    const result = parseAuthSessionResult(await response.json());
    attempt.assertCurrent();
    return result;
  } catch (cause) {
    attempt.assertCurrent();
    throw cause;
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
