/**
 * admin-password-recovery-service.ts
 *
 * Owns the exceptional administrator recovery path for an account that was
 * already gated without a usable setup/reset link.
 */

import { assertAdminMayClearPasswordChangeRequirement } from './admin-user-guards';
import { AuthError } from './types';
import type { UserStore } from './user-store';

export class AdminPasswordRecoveryService {
  constructor(private readonly store: UserStore) {}

  /** Clear an existing gate and invalidate every credential-bound token. */
  clearPasswordChangeRequirement(userId: string, actorId: string) {
    const user = this.store.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    assertAdminMayClearPasswordChangeRequirement(actorId, user);
    if (!user.passwordChangeRequired) {
      throw new AuthError(
        'Password change is not required for this user',
        'PASSWORD_CHANGE_NOT_REQUIRED',
        409
      );
    }

    if (!this.store.clearPasswordChangeRequired(userId)) {
      throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    }
    return this.store.getUserById(userId)!;
  }
}
