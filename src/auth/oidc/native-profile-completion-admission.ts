/** Normalize expected first-use admission failures at the native grant boundary. */
import type { TokenService } from '../token-service';
import { AuthError } from '../types';
import { NativeTokenError } from './native-token-error';

export function assertNativeProfileCompletion(tokens: TokenService, userId: string): void {
  try { tokens.assertFullSessionAdmission(userId); }
  catch (error) { throw nativeProfileCompletionError(error); }
}

export function nativeProfileCompletionError(error: unknown): unknown {
  if (!(error instanceof AuthError)) return error;
  if (error.code === 'AUTH_PROFILE_COMPLETION_REQUIRED') {
    return new NativeTokenError('invalid_grant', 'Sign in and complete the required profile before continuing.');
  }
  if (error.code === 'AUTH_PROFILE_COMPLETION_CHANGED' || error.code === 'AUTH_PROFILE_COMPLETION_NOT_READY'
    || error.code === 'AUTH_PROFILE_POLICY_CHANGED' || error.code === 'AUTH_PROFILE_NOT_READY') {
    return new NativeTokenError('temporarily_unavailable', 'Profile completion is temporarily unavailable.', 503);
  }
  return error;
}
