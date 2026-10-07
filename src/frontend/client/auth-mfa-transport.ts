/** Transport for current-user MFA enrollment and challenge flows. */

import { createAuthClientError } from './auth-errors';
import {
  parseAuthMfaChallenge,
  parseAuthMfaCompletionResult,
  parseAuthMfaMethod,
} from './auth-completion-parser';
import {
  failCurrentAuthenticationCompletion,
  failCurrentAuthenticationAttempt,
  type AuthAuthenticationAttempt,
} from './auth-authentication-attempt';
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
    const result = parseMfaMethodList(text ? JSON.parse(text) : undefined);
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
    const result = parseMfaSetupStart(await response.json());
    this.options.assertResponseCurrent(response);
    return result;
  }

  async verifyMfaSetup(params: {
    verificationToken: string;
    code: string;
  }): Promise<AuthMfaSetupVerifyResult> {
    const attempt = this.options.beginAuthentication(false);
    try {
      const response = await this.options.optionalAuthenticatedFetch(
        `${this.options.baseUrl}/auth/mfa/setup/verify`,
        { ...jsonRequest(params), signal: attempt.signal },
      );
      attempt.assertCurrent();
      if (!response.ok) throw await responseError(response, 'Failed to verify MFA setup');

      const data = await response.json();
      attempt.assertCurrent();
      if (hasOwn(data, 'user')) {
        const completion = parseAuthMfaCompletionResult(data);
        if (!('accessToken' in completion)
          && !('tenantSelectionRequired' in completion)
          && !('tenantOnboardingRequired' in completion)
          && !('profileCompletionRequired' in completion)) throw invalidMfaResponse();
        return await this.options.completeAuthentication(
          completion,
          attempt,
        ) as AuthMfaSetupVerifyResult;
      }
      return parseMfaSetupManagementResult(data);
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
      let result: AuthCompletionResult;
      let failureMessage = 'Failed to verify MFA challenge';
      try {
        const response = await fetch(
          `${this.options.baseUrl}/auth/mfa/challenge/verify`,
          { ...jsonRequest(params), signal: attempt.signal },
        );
        attempt.assertCurrent();
        if (!response.ok) {
          const error = await responseError(response, failureMessage);
          failureMessage = error.message;
          throw error;
        }
        failureMessage = 'Invalid MFA response';
        const body = await response.json();
        attempt.assertCurrent();
        result = parseAuthMfaCompletionResult(body);
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
          'Failed to verify MFA challenge',
        );
      }
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

type UnknownRecord = Record<string, unknown>;

function parseMfaMethodList(
  value: unknown,
): { methods: AuthMfaMethod[]; required: boolean } {
  const result = exact(value, ['methods', 'required']);
  if (!Array.isArray(result.methods) || typeof result.required !== 'boolean') {
    throw invalidMfaResponse();
  }
  const methods = result.methods.map(parseAuthMfaMethod);
  if (new Set(methods.map((method) => method.methodId)).size !== methods.length) {
    throw invalidMfaResponse();
  }
  return Object.freeze({
    methods: Object.freeze(methods) as AuthMfaMethod[],
    required: result.required,
  });
}

function parseMfaSetupStart(value: unknown): AuthMfaSetupStartResult {
  const result = allowed(
    value,
    ['setupRequired', 'method', 'challenge', 'totp', 'verificationToken'],
    ['setupRequired', 'method', 'verificationToken'],
  );
  if (typeof result.setupRequired !== 'boolean') throw invalidMfaResponse();
  return Object.freeze({
    setupRequired: result.setupRequired,
    method: parseAuthMfaMethod(result.method),
    ...(Object.hasOwn(result, 'challenge')
      ? { challenge: parseAuthMfaChallenge(result.challenge) }
      : {}),
    ...(Object.hasOwn(result, 'totp') ? { totp: parseTotp(result.totp) } : {}),
    verificationToken: text(result.verificationToken, 16_384),
  });
}

function parseMfaSetupManagementResult(value: unknown): AuthMfaSetupVerifyResult {
  const result = exact(value, ['ok', 'method', 'methods']);
  if (result.ok !== true || !Array.isArray(result.methods)) throw invalidMfaResponse();
  const method = parseAuthMfaMethod(result.method);
  const methods = result.methods.map(parseAuthMfaMethod);
  if (new Set(methods.map((entry) => entry.methodId)).size !== methods.length
    || !methods.some((entry) => entry.methodId === method.methodId)) {
    throw invalidMfaResponse();
  }
  return Object.freeze({
    ok: true,
    method,
    methods: Object.freeze(methods) as AuthMfaMethod[],
  });
}

function parseTotp(value: unknown): NonNullable<AuthMfaSetupStartResult['totp']> {
  const result = exact(value, ['secret', 'otpauthUrl', 'issuer', 'accountName']);
  return Object.freeze({
    secret: text(result.secret, 4096),
    otpauthUrl: text(result.otpauthUrl, 16_384),
    issuer: text(result.issuer, 200),
    accountName: text(result.accountName, 320),
  });
}

function hasOwn(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, key));
}

function exact(value: unknown, keys: readonly string[]): UnknownRecord {
  const result = record(value);
  if (Object.keys(result).length !== keys.length
    || keys.some((key) => !Object.hasOwn(result, key))) throw invalidMfaResponse();
  return result;
}

function allowed(
  value: unknown,
  keys: readonly string[],
  required: readonly string[],
): UnknownRecord {
  const result = record(value);
  const accepted = new Set(keys);
  if (Object.keys(result).some((key) => !accepted.has(key))
    || required.some((key) => !Object.hasOwn(result, key))) throw invalidMfaResponse();
  return result;
}

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidMfaResponse();
  }
  return value as UnknownRecord;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw invalidMfaResponse();
  }
  return value;
}

function invalidMfaResponse(): Error {
  return new Error('[client] Zero returned an invalid MFA response.');
}
