/** Transport for login, registration, public config, and account operations. */

import { createAuthClientError } from './auth-errors';
import {
  parseAuthCompletionResult,
  parseAuthRefreshResponse,
  parseAuthRegistrationResult,
} from './auth-completion-parser';
import type { AuthAuthenticationAttempt } from './auth-authentication-attempt';
import type {
  AuthCompletionResult,
  AuthPublicConfig,
  AuthRegistrationResult,
  RegisterParams,
} from './auth-types';

export interface AuthAccountTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  beginAuthentication: () => AuthAuthenticationAttempt;
  failAuthentication: (message: string, attempt: AuthAuthenticationAttempt) => void;
  completeAuthentication: (
    result: AuthCompletionResult,
    attempt: AuthAuthenticationAttempt,
  ) => Promise<AuthCompletionResult>;
  updateTokens: (
    accessToken: string,
    refreshToken: string,
    response: Response,
  ) => Promise<void>;
}

export class AuthAccountTransport {
  constructor(private readonly options: AuthAccountTransportOptions) {}

  login(username: string, password: string): Promise<AuthCompletionResult> {
    return this.authenticate('/auth/login', { username, password }, 'Login failed');
  }

  register(params: RegisterParams): Promise<AuthRegistrationResult> {
    return this.authenticate('/auth/register', params, 'Registration failed');
  }

  async getConfig(signal?: AbortSignal): Promise<AuthPublicConfig> {
    const response = await fetch(`${this.options.baseUrl}/auth/config`, { signal });
    if (!response.ok) {
      throw await responseError(response, 'Failed to load auth config');
    }
    return response.json();
  }

  async forgotPassword(email: string, nativeContinuation?: string): Promise<void> {
    await this.genericEmailRequest(
      '/auth/forgot-password',
      email,
      'Failed to request password reset',
      nativeContinuation,
    );
  }

  async resendVerificationEmail(email: string, nativeContinuation?: string): Promise<void> {
    await this.genericEmailRequest(
      '/auth/resend-verification',
      email,
      'Failed to request verification email',
      nativeContinuation,
    );
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}/auth/change-password`,
      jsonRequest({ currentPassword, newPassword }),
    );
    if (!response.ok) {
      throw await responseError(response, 'Failed to change password');
    }

    const data = parseAuthRefreshResponse(await response.json());
    await this.options.updateTokens(data.accessToken, data.refreshToken, response);
  }

  private async authenticate<TResult extends AuthCompletionResult = AuthCompletionResult>(
    path: '/auth/login' | '/auth/register',
    body: unknown,
    fallback: string,
  ): Promise<TResult> {
    const attempt = this.options.beginAuthentication();
    try {
      const response = await fetch(
        `${this.options.baseUrl}${path}`,
        { ...jsonRequest(body), signal: attempt.signal },
      );
      attempt.assertCurrent();
      if (!response.ok) {
        const error = await responseError(response, fallback);
        attempt.assertCurrent();
        this.options.failAuthentication(error.message, attempt);
        throw error;
      }
      let result: AuthCompletionResult;
      try {
        const bodyValue = await response.json();
        attempt.assertCurrent();
        result = path === '/auth/register'
          ? parseAuthRegistrationResult(bodyValue)
          : parseAuthCompletionResult(bodyValue);
      } catch (error) {
        attempt.assertCurrent();
        this.options.failAuthentication('Invalid authentication response', attempt);
        throw error;
      }
      return this.options.completeAuthentication(result, attempt) as Promise<TResult>;
    } finally {
      attempt.dispose();
    }
  }

  private async genericEmailRequest(
    path: '/auth/forgot-password' | '/auth/resend-verification',
    email: string,
    fallback: string,
    nativeContinuation?: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.options.baseUrl}${path}`,
      jsonRequest({
        email,
        ...(nativeContinuation ? { nativeContinuation } : {}),
      }),
    );
    if (!response.ok) throw await responseError(response, fallback);
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
