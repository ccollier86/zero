/** Transport for current-user MFA enrollment and challenge flows. */

import { createAuthClientError } from './auth-errors';
import { isAuthSessionResult } from './auth-types';
import type {
  AuthCompletionResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthSessionResult,
} from './auth-types';

export interface AuthMfaTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  optionalAuthenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  completeAuthentication: (result: AuthCompletionResult) => AuthCompletionResult;
}

export class AuthMfaTransport {
  constructor(private readonly options: AuthMfaTransportOptions) {}

  async listMfaMethods(): Promise<{ methods: AuthMfaMethod[]; required: boolean }> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}/auth/mfa/methods`,
    );
    if (!response.ok) throw await responseError(response, 'Auth request failed');
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as {
      methods: AuthMfaMethod[];
      required: boolean;
    };
  }

  async startMfaSetup(params: {
    setupToken?: string;
    method: AuthMfaMethodType;
    label?: string;
  }): Promise<AuthMfaSetupStartResult> {
    const response = await this.options.optionalAuthenticatedFetch(
      `${this.options.baseUrl}/auth/mfa/setup`,
      jsonRequest(params),
    );
    if (!response.ok) throw await responseError(response, 'Failed to start MFA setup');
    return response.json();
  }

  async verifyMfaSetup(params: {
    verificationToken: string;
    code: string;
  }): Promise<AuthMfaSetupVerifyResult> {
    const response = await fetch(
      `${this.options.baseUrl}/auth/mfa/setup/verify`,
      jsonRequest(params),
    );
    if (!response.ok) throw await responseError(response, 'Failed to verify MFA setup');

    const data = await response.json();
    return isAuthSessionResult(data)
      ? this.options.completeAuthentication(data) as AuthSessionResult
      : data;
  }

  async verifyMfaChallenge(params: {
    challengeToken: string;
    code: string;
  }): Promise<AuthSessionResult> {
    const response = await fetch(
      `${this.options.baseUrl}/auth/mfa/challenge/verify`,
      jsonRequest(params),
    );
    if (!response.ok) {
      throw await responseError(response, 'Failed to verify MFA challenge');
    }
    return this.options.completeAuthentication(await response.json()) as AuthSessionResult;
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
