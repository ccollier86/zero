/** Fail-closed native continuation checks for self-service registration. */

import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import { AuthError } from './types';

export function requireRegistrationContinuation(
  service: NativeAuthorizationService | null,
  supplied: string | undefined
): string | null {
  if (supplied === undefined) return null;
  const continuation = service?.validateAvailableContinuation(supplied) ?? null;
  if (!continuation) throw unavailableContinuation();
  return continuation;
}

export function claimRegistrationContinuation(
  service: NativeAuthorizationService | null,
  continuation: string | null,
  userId: string
): void {
  if (!continuation) return;
  if (service?.claimContinuationForUser(continuation, userId) !== continuation) {
    throw unavailableContinuation();
  }
}

function unavailableContinuation(): AuthError {
  return new AuthError(
    'Native authorization continuation is invalid or unavailable',
    'NATIVE_CONTINUATION_INVALID',
    400
  );
}
