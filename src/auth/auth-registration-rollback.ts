/** Strict whole-graph rollback for registrations that cannot finish provisioning. */

import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type {
  RegistrationProvisioningReceipt,
  UserStore,
} from './user-store';

export function rollbackRegistration(params: {
  store: UserStore;
  provisioning: RegistrationProvisioningReceipt;
  nativeAuthorization: NativeAuthorizationService | null;
  nativeContinuation: string | null;
}): { cleanupSucceeded: boolean; continuationReleased: boolean } {
  // UserStore releases every provisional native binding and removes the
  // complete domain graph inside one SQLite transaction. A cleanup failure is
  // deliberately allowed to throw: returning the original provider error
  // while silently retaining half-installed authority would be unsafe.
  const cleanupSucceeded = params.store.rollbackRegistrationProvisioning(
    params.provisioning,
  );
  const continuationReleased = params.nativeContinuation
    ? Boolean(params.nativeAuthorization?.validateAvailableContinuation(
        params.nativeContinuation,
      ))
    : true;
  return { cleanupSucceeded, continuationReleased };
}
