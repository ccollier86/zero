/** OIDC authorization callback target, parameter, state, and issuer validation. */

import { NativeAuthError } from './errors';

export interface NativeAuthorizationCallback {
  code: string;
}

/** Validate a callback before an authorization code is sent to the token endpoint. */
export function validateAuthorizationCallback(
  callbackUrl: string,
  expected: { redirectUri: string; state: string; issuer: string },
): NativeAuthorizationCallback {
  const callback = parseUrl(callbackUrl, 'callback');
  const redirect = parseUrl(expected.redirectUri, 'redirect');
  assertSameTarget(callback, redirect);

  const state = single(callback, 'state');
  const issuer = single(callback, 'iss');
  if (!state || state !== expected.state) {
    throw new NativeAuthError('Authorization state did not match.', 'OIDC_STATE_MISMATCH');
  }
  if (!issuer || issuer !== expected.issuer) {
    throw new NativeAuthError('Authorization response issuer did not match.', 'OIDC_RESPONSE_ISS_MISMATCH');
  }

  const oauthError = single(callback, 'error');
  if (oauthError) {
    throw new NativeAuthError('Authorization was not completed.', `OIDC_${safeCode(oauthError)}`);
  }
  const code = single(callback, 'code');
  if (!code) throw new NativeAuthError('Authorization code was missing.', 'OIDC_CODE_MISSING');
  return { code };
}

function single(url: URL, key: string): string | null {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) {
    throw new NativeAuthError(`Authorization response repeated ${key}.`, 'OIDC_CALLBACK_INVALID');
  }
  return values[0] ?? null;
}

function assertSameTarget(actual: URL, expected: URL): void {
  const fields: Array<keyof URL> = ['protocol', 'username', 'password', 'hostname', 'port', 'pathname'];
  if (fields.some((field) => actual[field] !== expected[field]) || actual.hash) {
    throw new NativeAuthError('Authorization callback target did not match.', 'OIDC_REDIRECT_MISMATCH');
  }
  for (const key of new Set(expected.searchParams.keys())) {
    const actualValues = actual.searchParams.getAll(key).sort();
    const expectedValues = expected.searchParams.getAll(key).sort();
    if (actualValues.length !== expectedValues.length
      || actualValues.some((item, index) => item !== expectedValues[index])) {
      throw new NativeAuthError('Authorization callback query did not match.', 'OIDC_REDIRECT_MISMATCH');
    }
  }
}

function parseUrl(value: string, kind: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new NativeAuthError(`Authorization ${kind} URL was invalid.`, 'OIDC_CALLBACK_INVALID');
  }
}

function safeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 64) || 'AUTHORIZATION_ERROR';
}
