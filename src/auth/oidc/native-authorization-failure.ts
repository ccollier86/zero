/** Safe authorization error delivery after exact redirect validation. */

import { NativeAuthorizationError } from '../native';
import type { NativeAuthorizationErrorTarget } from './native-authorization-error-target';
import { authorizationProblem } from './native-authorize-helpers';
import { appendAuthorizationResult, nativeRedirect } from './native-http';
import { isNativeRuntimeUnavailableError } from './native-request-failure';
import { NativeTokenError } from './native-token-error';

export function nativeAuthorizationFailure(
  issuer: string,
  error: unknown,
  target: NativeAuthorizationErrorTarget | null,
): Response {
  const oauth = asAuthorizationError(error);
  if (!target) return authorizationProblem(oauth.description, oauth.status);
  return nativeRedirect(appendAuthorizationResult(target.redirectUri, {
    error: oauth.code,
    error_description: oauth.description,
    state: target.state,
    iss: issuer,
  }));
}

function asAuthorizationError(error: unknown): NativeAuthorizationError {
  if (error instanceof NativeAuthorizationError && error.code !== 'server_error') return error;
  if (error instanceof NativeTokenError && error.code === 'invalid_request') {
    return new NativeAuthorizationError('invalid_request', error.message, error.status);
  }
  if (error instanceof NativeTokenError && error.code === 'temporarily_unavailable') {
    return new NativeAuthorizationError(
      'temporarily_unavailable',
      'Native authentication is temporarily unavailable.',
      error.status,
    );
  }
  if (isNativeRuntimeUnavailableError(error)) {
    return new NativeAuthorizationError(
      'temporarily_unavailable',
      'Native authentication is temporarily unavailable.',
      503,
    );
  }
  return new NativeAuthorizationError('server_error', 'Authorization failed.', 500);
}
