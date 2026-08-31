/** Transport for email verification and password action-token flows. */

import { createAuthClientError } from './auth-errors';
import type { AuthActionTokenInfo, AuthCompletionResult } from './auth-types';

export interface AuthActionTransportOptions {
  baseUrl: string;
  beginAuthentication: () => void;
  failAuthentication: (message: string) => void;
  completeAuthentication: (result: AuthCompletionResult) => AuthCompletionResult;
}

export class AuthActionTransport {
  constructor(private readonly options: AuthActionTransportOptions) {}

  async verifyEmail(token: string): Promise<AuthCompletionResult> {
    this.options.beginAuthentication();
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
    this.options.beginAuthentication();
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
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      const error = createAuthClientError(response, responseBody, fallback);
      this.options.failAuthentication(error.message);
      throw error;
    }
    return this.options.completeAuthentication(await response.json());
  }
}
