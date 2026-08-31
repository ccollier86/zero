/** Reject credential-bearing client authentication for native public clients. */

import { NativeTokenError } from './native-token-error';

const AUTH_SCHEME = /^([!#$%&'*+.^_`|~0-9A-Za-z-]{1,64})(?:[ \t]|$)/;

export function rejectNativeClientAuthorization(request: Request): void {
  const authorization = request.headers.get('authorization');
  if (!authorization) return;
  const scheme = AUTH_SCHEME.exec(authorization)?.[1];
  if (!scheme) {
    throw new NativeTokenError('invalid_request', 'Authorization header is malformed.');
  }
  throw new NativeTokenError(
    'invalid_client',
    'Native public clients do not authenticate.',
    401,
    `${scheme} realm="Zero native OAuth"`,
  );
}
