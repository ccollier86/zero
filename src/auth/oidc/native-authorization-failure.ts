/** Safe authorization error delivery after exact redirect validation. */

import { NativeAuthorizationError } from '../native';
import type { NativeAuthorizationErrorTarget } from './native-authorization-error-target';
import { authorizationProblem } from './native-authorize-helpers';
import { appendAuthorizationResult, nativeRedirect } from './native-http';
import { NativeTokenError } from './native-token-error';

export function nativeAuthorizationFailure(
  issuer: string,
  error: unknown,
  target: NativeAuthorizationErrorTarget | null,
): Response {
  const oauth = asAuthorizationError(error);
  if (!target) return authorizationProblem(oauth.description);
  return nativeRedirect(appendAuthorizationResult(target.redirectUri, {
    error: oauth.code,
    error_description: oauth.description,
    state: target.state,
    iss: issuer,
  }));
}

function asAuthorizationError(error: unknown): NativeAuthorizationError {
  if (error instanceof NativeAuthorizationError) return error;
  if (error instanceof NativeTokenError && error.code === 'invalid_request') {
    return new NativeAuthorizationError('invalid_request', error.message, error.status);
  }
  return new NativeAuthorizationError('server_error', 'Authorization failed.', 500);
}
