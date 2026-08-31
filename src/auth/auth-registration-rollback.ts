/** Best-effort rollback for registrations that cannot finish provisioning. */

import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { UserStore } from './user-store';

export function rollbackRegistration(params: {
  store: UserStore;
  userId: string;
  nativeAuthorization: NativeAuthorizationService | null;
  nativeContinuation: string | null;
}): { cleanupSucceeded: boolean; continuationReleased: boolean } {
  const continuationReleased = params.nativeContinuation
    ? Boolean(params.nativeAuthorization?.releaseContinuationForUser(
        params.nativeContinuation,
        params.userId
      ))
    : true;
  let cleanupSucceeded = false;
  try {
    cleanupSucceeded = params.store.deleteUser(params.userId)
      || params.store.getUserById(params.userId) === null;
  } catch {
    cleanupSucceeded = false;
  }
  return { cleanupSucceeded, continuationReleased };
}
