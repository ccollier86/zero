/**
 * auth-admin-transport.ts
 *
 * Browser transport for administrator-facing auth routes. Authentication and
 * token refresh are injected by AuthClient so this module owns only admin URL,
 * payload, timeout, and response handling.
 */

import type { AuthUser } from './auth-types';
import type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaResetResult,
  AuthAdminUpdateUserParams,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthAdminUserMfaStatus,
} from './auth-admin-types';

export const AUTH_ADMIN_REQUEST_TIMEOUT_MS = 15_000;

export type AuthenticatedFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface AuthAdminTransportOptions {
  baseUrl: string;
  authenticatedFetch: AuthenticatedFetch;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  createTimeoutError: () => Error;
  /** Test/internal override. Production callers use the 15-second default. */
  requestTimeoutMs?: number;
}

/** Focused transport used by AuthClient's compatibility delegators. */
export class AuthAdminTransport {
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: AuthAdminTransportOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? AUTH_ADMIN_REQUEST_TIMEOUT_MS;
  }

  getAdminConfig(): Promise<AuthAdminConfig> {
    return this.requestJson<AuthAdminConfig>('/auth/admin/config');
  }

  listAdminUsers(
    params: AuthAdminUserListParams = {},
  ): Promise<AuthAdminUserListResult> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }

    const suffix = query.size > 0 ? `?${query}` : '';
    return this.requestJson<AuthAdminUserListResult>(`/auth/admin/users${suffix}`);
  }

  async getAdminUser(userId: string): Promise<AuthUser> {
    const data = await this.requestJson<{ user: AuthUser }>(this.userPath(userId));
    return data.user;
  }

  createAdminUser(
    params: AuthAdminCreateUserParams,
  ): Promise<{ user: AuthUser; setupEmailSent: boolean }> {
    return this.requestJson('/auth/admin/users', jsonRequest('POST', params));
  }

  async updateAdminUser(
    userId: string,
    params: AuthAdminUpdateUserParams,
  ): Promise<AuthUser> {
    const data = await this.requestJson<{ user: AuthUser }>(
      this.userPath(userId),
      jsonRequest('PATCH', params),
    );
    return data.user;
  }

  async setAdminUserProperty(userId: string, key: string, value: unknown): Promise<void> {
    await this.requestJson(
      `${this.userPath(userId)}/properties/${encodeURIComponent(key)}`,
      jsonRequest('PUT', { value }),
    );
  }

  async deleteAdminUserProperty(userId: string, key: string): Promise<void> {
    await this.requestJson(
      `${this.userPath(userId)}/properties/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
  }

  async deleteAdminUser(userId: string): Promise<void> {
    await this.requestJson(this.userPath(userId), { method: 'DELETE' });
  }

  async sendAdminSetupEmail(userId: string): Promise<boolean> {
    const data = await this.requestJson<{ ok: boolean; setupEmailSent: boolean }>(
      `${this.userPath(userId)}/send-setup-email`,
      { method: 'POST' },
    );
    return data.setupEmailSent;
  }

  async sendAdminPasswordReset(userId: string): Promise<void> {
    await this.requestJson(`${this.userPath(userId)}/send-password-reset`, {
      method: 'POST',
    });
  }

  async clearAdminPasswordChangeRequirement(userId: string): Promise<AuthUser> {
    return this.userMutation(
      `${this.userPath(userId)}/clear-password-change-requirement`,
    );
  }

  async resetAdminPassword(userId: string, password: string): Promise<void> {
    await this.requestJson(
      `${this.userPath(userId)}/reset-password`,
      jsonRequest('POST', { password }),
    );
  }

  async suspendAdminUser(userId: string): Promise<AuthUser> {
    return this.userMutation(`${this.userPath(userId)}/suspend`);
  }

  async activateAdminUser(userId: string): Promise<AuthUser> {
    return this.userMutation(`${this.userPath(userId)}/activate`);
  }

  async revokeAdminUserSessions(userId: string): Promise<void> {
    await this.requestJson(`${this.userPath(userId)}/revoke-sessions`, {
      method: 'POST',
    });
  }

  getAdminUserMfa(userId: string): Promise<AuthAdminUserMfaStatus> {
    return this.requestJson(`${this.userPath(userId)}/mfa`);
  }

  async requireAdminUserMfa(userId: string): Promise<AuthUser> {
    return this.userMutation(`${this.userPath(userId)}/mfa/require`);
  }

  async clearAdminUserMfaRequirement(userId: string): Promise<AuthUser> {
    return this.userMutation(`${this.userPath(userId)}/mfa/clear-requirement`);
  }

  resetAdminUserMfa(userId: string): Promise<AuthAdminMfaResetResult> {
    return this.requestJson(`${this.userPath(userId)}/mfa/reset`, { method: 'POST' });
  }

  async sendAdminVerificationEmail(userId: string): Promise<void> {
    await this.requestJson(`${this.userPath(userId)}/send-verification-email`, {
      method: 'POST',
    });
  }

  async verifyAdminUserEmail(userId: string): Promise<AuthUser> {
    return this.userMutation(`${this.userPath(userId)}/verify-email`);
  }

  private userPath(userId: string): string {
    return `/auth/admin/users/${encodeURIComponent(userId)}`;
  }

  private async userMutation(path: string): Promise<AuthUser> {
    const data = await this.requestJson<{ user: AuthUser }>(path, { method: 'POST' });
    return data.user;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const callerSignal = init?.signal;
    let rejectCallerAbort!: (reason?: unknown) => void;
    const callerAbort = new Promise<never>((_resolve, reject) => {
      rejectCallerAbort = reject;
    });
    const abortFromCaller = () => {
      const reason = callerSignal?.reason
        ?? new DOMException('Admin auth request aborted', 'AbortError');
      controller.abort(reason);
      rejectCallerAbort(reason);
    };
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

    let timedOut = false;
    let timeoutError: Error | undefined;
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const absoluteTimeout = new Promise<never>((_resolve, reject) => {
      timeout = globalThis.setTimeout(() => {
        timedOut = true;
        timeoutError = this.options.createTimeoutError();
        controller.abort(new DOMException('Admin auth request timed out', 'TimeoutError'));
        reject(timeoutError);
      }, this.requestTimeoutMs);
    });

    try {
      const request = Promise.resolve().then(async () => {
        const response = await this.options.authenticatedFetch(
          `${this.options.baseUrl}${path}`,
          {
            ...init,
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw this.options.createResponseError(
            response,
            body,
            'Admin auth request failed',
          );
        }

        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      });
      return await Promise.race([request, absoluteTimeout, callerAbort]);
    } catch (error) {
      if (timedOut) throw timeoutError ?? this.options.createTimeoutError();
      throw error;
    } finally {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

function jsonRequest(method: 'POST' | 'PATCH' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
