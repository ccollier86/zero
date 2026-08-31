/** Transport for login, registration, public config, and account operations. */

import { createAuthClientError } from './auth-errors';
import type {
  AuthCompletionResult,
  AuthPublicConfig,
  RegisterParams,
} from './auth-types';

export interface AuthAccountTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  beginAuthentication: () => void;
  failAuthentication: (message: string) => void;
  completeAuthentication: (result: AuthCompletionResult) => AuthCompletionResult;
  updateTokens: (accessToken: string, refreshToken: string) => void;
}

export class AuthAccountTransport {
  constructor(private readonly options: AuthAccountTransportOptions) {}

  login(username: string, password: string): Promise<AuthCompletionResult> {
    return this.authenticate('/auth/login', { username, password }, 'Login failed');
  }

  register(params: RegisterParams): Promise<AuthCompletionResult> {
    return this.authenticate('/auth/register', params, 'Registration failed');
  }

  async getConfig(): Promise<AuthPublicConfig> {
    const response = await fetch(`${this.options.baseUrl}/auth/config`);
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

    const data = await response.json();
    this.options.updateTokens(data.accessToken, data.refreshToken);
  }

  private async authenticate(
    path: '/auth/login' | '/auth/register',
    body: unknown,
    fallback: string,
  ): Promise<AuthCompletionResult> {
    this.options.beginAuthentication();
    const response = await fetch(`${this.options.baseUrl}${path}`, jsonRequest(body));
    if (!response.ok) {
      const error = await responseError(response, fallback);
      this.options.failAuthentication(error.message);
      throw error;
    }
    return this.options.completeAuthentication(await response.json());
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
