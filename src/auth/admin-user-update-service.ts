/**
 * admin-user-update-service.ts
 *
 * Owns validated administrator profile/security transitions and durable token
 * invalidation. It does not register HTTP routes.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import {
  assertAdminUserTransition,
  type AdminUserEligibilityTransition,
} from './admin-user-guards';
import { assertMfaRequirementAvailable, type AuthAdminPluginConfig } from './auth-admin-dependencies';
import { hasAuthenticationBoundaryChange } from './auth-user-security-state';
import { AuthError, type UserStatus } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import { canonicalizeEmail } from './auth-email-identity';

export interface AdminUpdateUserInput {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: UserStatus;
  passwordChangeRequired?: boolean;
  mfaRequired?: boolean;
  properties?: Record<string, unknown>;
}

export class AdminUserUpdateService {
  constructor(
    private readonly store: UserStore,
    private readonly properties: UserPropertyService,
    private readonly config: AuthAdminPluginConfig
  ) {}

  /** Validate all policy inputs before atomically ordered user/property writes. */
  update(userId: string, input: AdminUpdateUserInput, actorId: string) {
    const existing = this.store.getUserById(userId);
    if (!existing) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    if (input.passwordChangeRequired === true && !existing.passwordChangeRequired) {
      throw new AuthError(
        'Use a setup or reset email to require a password change',
        'PASSWORD_CHANGE_REQUIREMENT_REQUIRES_EMAIL',
        409
      );
    }
    const properties = this.properties.validateWrites(input.properties, 'admin');
    if (input.mfaRequired === true && !existing.mfaRequired) {
      assertMfaRequirementAvailable(this.config);
    }

    const email = input.email === undefined ? undefined : canonicalizeEmail(input.email);
    const emailChanged = email !== undefined
      && email !== canonicalizeEmail(existing.email);
    const eligibility: AdminUserEligibilityTransition = {};
    if (input.role !== undefined) eligibility.role = input.role;
    if (input.status !== undefined) eligibility.status = input.status;
    if (input.passwordChangeRequired !== undefined) {
      eligibility.passwordChangeRequired = input.passwordChangeRequired;
    }
    if (emailChanged) {
      eligibility.emailVerifiedAt = null;
      eligibility.emailVerificationRequired = this.config
        .getAuthConfig().account.requireEmailVerification;
    }
    assertAdminUserTransition({ store: this.store, actorUserId: actorId, user: existing, changes: eligibility });

    const updated = this.store.updateUser(userId, {
      username: input.username,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: input.status,
      passwordChangeRequired: input.passwordChangeRequired,
      emailVerifiedAt: eligibility.emailVerifiedAt,
      emailVerificationRequired: eligibility.emailVerificationRequired,
      mfaRequired: input.mfaRequired,
    });
    if (!updated) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    if (hasAuthenticationBoundaryChange(existing, updated)) this.store.revokeAllUserTokens(userId);
    this.store.setProperties(userId, properties);

    const user = this.store.getUserById(userId)!;
    emitPlatformCode(OBS_CODES.AUTH_ADMIN_USER_UPDATED, {
      userId: actorId,
      metadata: { updatedUserId: userId },
    });
    return user;
  }
}
