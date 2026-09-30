/** Transport for email verification and password action-token flows. */

import { createAuthClientError } from './auth-errors';
import { parseAuthCompletionResult } from './auth-completion-parser';
import {
  failCurrentAuthenticationCompletion,
  failCurrentAuthenticationAttempt,
  type AuthAuthenticationAttempt,
} from './auth-authentication-attempt';
import type { AuthActionTokenInfo, AuthCompletionResult } from './auth-types';

export interface AuthActionTransportOptions {
  baseUrl: string;
  beginAuthentication: () => AuthAuthenticationAttempt;
  failAuthentication: (message: string, attempt: AuthAuthenticationAttempt) => void;
  completeAuthentication: (
    result: AuthCompletionResult,
    attempt: AuthAuthenticationAttempt,
  ) => Promise<AuthCompletionResult>;
}

export class AuthActionTransport {
  constructor(private readonly options: AuthActionTransportOptions) {}

  async verifyEmail(token: string): Promise<AuthCompletionResult> {
    return this.completeAction(
      '/auth/verify-email',
      { token },
      'Failed to verify email',
    );
  }

  async inspectActionToken(token: string): Promise<AuthActionTokenInfo> {
    const response = await fetch(
      `${this.options.baseUrl}/auth/action-token/${encodeURIComponent(token)}`,
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw createAuthClientError(response, body, 'Invalid or expired action token');
    }
    return response.json();
  }

  resetPassword(token: string, newPassword: string): Promise<AuthCompletionResult> {
    return this.completePasswordAction('/auth/reset-password', token, newPassword);
  }

  setupPassword(token: string, newPassword: string): Promise<AuthCompletionResult> {
    return this.completePasswordAction('/auth/setup-password', token, newPassword);
  }

  private async completePasswordAction(
    path: '/auth/reset-password' | '/auth/setup-password',
    token: string,
    newPassword: string,
  ): Promise<AuthCompletionResult> {
    return this.completeAction(
      path,
      { token, newPassword },
      'Failed to update password',
    );
  }

  private async completeAction(
    path: '/auth/verify-email' | '/auth/reset-password' | '/auth/setup-password',
    body: unknown,
    fallback: string,
  ): Promise<AuthCompletionResult> {
    const attempt = this.options.beginAuthentication();
    try {
      let result: AuthCompletionResult;
      let failureMessage = fallback;
      try {
        const response = await fetch(`${this.options.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: attempt.signal,
        });
        attempt.assertCurrent();
        if (!response.ok) {
          const responseBody = await response.json().catch(() => null);
          attempt.assertCurrent();
          const error = createAuthClientError(response, responseBody, fallback);
          failureMessage = error.message;
          throw error;
        }
        failureMessage = 'Invalid authentication response';
        const responseBody = await response.json();
        attempt.assertCurrent();
        result = parseAuthCompletionResult(responseBody);
      } catch (cause) {
        return failCurrentAuthenticationAttempt(
          attempt,
          this.options.failAuthentication,
          cause,
          failureMessage,
        );
      }
      try {
        return await this.options.completeAuthentication(result, attempt);
      } catch (cause) {
        return failCurrentAuthenticationCompletion(
          attempt,
          this.options.failAuthentication,
          cause,
          fallback,
        );
      }
    } finally {
      attempt.dispose();
    }
  }
}
