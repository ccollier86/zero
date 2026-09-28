/** Transport for current-user MFA enrollment and challenge flows. */

import { createAuthClientError } from './auth-errors';
import type { AuthAuthenticationAttempt } from './auth-authentication-attempt';
import type {
  AuthCompletionResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
} from './auth-types';

export interface AuthMfaTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  optionalAuthenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  assertResponseCurrent: (response: Response) => void;
  beginAuthentication: (markLoading?: boolean) => AuthAuthenticationAttempt;
  failAuthentication: (message: string, attempt: AuthAuthenticationAttempt) => void;
  completeAuthentication: (
    result: AuthCompletionResult,
    attempt: AuthAuthenticationAttempt,
  ) => Promise<AuthCompletionResult>;
}

export class AuthMfaTransport {
  constructor(private readonly options: AuthMfaTransportOptions) {}

  async listMfaMethods(): Promise<{ methods: AuthMfaMethod[]; required: boolean }> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}/auth/mfa/methods`,
    );
    if (!response.ok) throw await responseError(response, 'Auth request failed');
    const text = await response.text();
    const result = (text ? JSON.parse(text) : undefined) as {
      methods: AuthMfaMethod[];
      required: boolean;
    };
    this.options.assertResponseCurrent(response);
    return result;
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
    const result = await response.json() as AuthMfaSetupStartResult;
    this.options.assertResponseCurrent(response);
    return result;
  }

  async verifyMfaSetup(params: {
    verificationToken: string;
    code: string;
  }): Promise<AuthMfaSetupVerifyResult> {
    const attempt = this.options.beginAuthentication(false);
    try {
      const response = await fetch(
        `${this.options.baseUrl}/auth/mfa/setup/verify`,
        { ...jsonRequest(params), signal: attempt.signal },
      );
      attempt.assertCurrent();
      if (!response.ok) throw await responseError(response, 'Failed to verify MFA setup');

      const data = await response.json();
      attempt.assertCurrent();
      return data && typeof data === 'object' && 'user' in data
        ? await this.options.completeAuthentication(
          data as AuthCompletionResult,
          attempt,
        ) as AuthMfaSetupVerifyResult
        : data;
    } finally {
      attempt.dispose();
    }
  }

  async verifyMfaChallenge(params: {
    challengeToken: string;
    code: string;
  }): Promise<AuthCompletionResult> {
    const attempt = this.options.beginAuthentication();
    try {
      const response = await fetch(
        `${this.options.baseUrl}/auth/mfa/challenge/verify`,
        { ...jsonRequest(params), signal: attempt.signal },
      );
      attempt.assertCurrent();
      if (!response.ok) {
        const error = await responseError(response, 'Failed to verify MFA challenge');
        attempt.assertCurrent();
        this.options.failAuthentication(error.message, attempt);
        throw error;
      }
      const result = await response.json() as AuthCompletionResult;
      attempt.assertCurrent();
      return this.options.completeAuthentication(result, attempt);
    } finally {
      attempt.dispose();
    }
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
