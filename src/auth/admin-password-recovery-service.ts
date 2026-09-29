/**
 * admin-password-recovery-service.ts
 *
 * Owns the exceptional administrator recovery path for an account that was
 * already gated without a usable setup/reset link.
 */

import { assertAdminMayClearPasswordChangeRequirement } from './admin-user-guards';
import { AuthError } from './types';
import type { AuthSecurityAuditContext, UserStore } from './user-store';
import {
  invokeAuthAdminMutationAuthority,
  type AssertAuthAdminMutationAuthority,
} from './auth-admin-mutation-authority';
import type { AuthPlatformCodeEmitter } from './auth-observability';

export class AdminPasswordRecoveryService {
  constructor(
    private readonly store: UserStore,
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {}

  /** Clear an existing gate and invalidate every credential-bound token. */
  clearPasswordChangeRequirement(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    audit?: AuthSecurityAuditContext,
  ) {
    return this.store.transaction(() => {
      const authority = invokeAuthAdminMutationAuthority(
        assertCurrentAuthority,
        { targetUserId: userId },
        { component: 'admin-password-recovery-service', emitCode: this.emitCode },
      );
      const user = this.store.getUserById(userId);
      if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      assertAdminMayClearPasswordChangeRequirement(authority.userId, user);
      if (!user.passwordChangeRequired) {
        throw new AuthError(
          'Password change is not required for this user',
          'PASSWORD_CHANGE_NOT_REQUIRED',
          409
        );
      }

      if (!this.store.clearPasswordChangeRequired(userId, audit)) {
        throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      }
      return this.store.getUserById(userId)!;
    });
  }
}
