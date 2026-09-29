/** Privacy-safe operational reporting for normalized native OAuth failures. */

import { OBS_CODES } from '../../observability/codes';
import { NativeAuthorizationError } from '../native';
import type { NativeAuthHttpConfig } from './native-plugin-types';
import { NativeTokenError } from './native-token-error';

const NATIVE_RUNTIME_UNAVAILABLE = Symbol('zero.native-runtime-unavailable');

interface NativeRuntimeUnavailableError extends Error {
  [NATIVE_RUNTIME_UNAVAILABLE]: true;
}

export type NativeRequestOperation =
  | 'authorize.get'
  | 'authorize.post'
  | 'token.exchange'
  | 'token.revoke'
  | 'tenant.list'
  | 'tenant.switch';

/** Mark missing lazy runtime state without turning it into a client protocol error. */
export function nativeRuntimeUnavailableError(): Error {
  const error = new Error('Native authentication runtime is unavailable.');
  error.name = 'NativeRuntimeUnavailableError';
  Object.defineProperty(error, NATIVE_RUNTIME_UNAVAILABLE, { value: true });
  return error;
}

/** Identify only Zero's internal missing-runtime marker. */
export function isNativeRuntimeUnavailableError(
  error: unknown,
): error is NativeRuntimeUnavailableError {
  return error instanceof Error
    && (error as Partial<NativeRuntimeUnavailableError>)[NATIVE_RUNTIME_UNAVAILABLE] === true;
}

/**
 * Protocol errors are expected request outcomes. Report only failures that the
 * HTTP boundary is about to hide behind a generic OAuth response, and never
 * attach the original error because provider/database messages may be private.
 */
export function emitUnexpectedNativeRequestFailure(
  config: NativeAuthHttpConfig,
  operation: NativeRequestOperation,
  error: unknown,
): void {
  if (error instanceof NativeAuthorizationError && error.code !== 'server_error') return;
  if (error instanceof NativeTokenError) return;
  config.emitCode(OBS_CODES.AUTH_NATIVE_REQUEST_FAILED, {
    metadata: { operation },
  });
}
