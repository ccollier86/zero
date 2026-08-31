/**
 * admin-user-guards.ts
 *
 * Central security invariants for administrator-initiated account transitions.
 * Route handlers validate input and then call these guards before any mutation.
 */

import { AuthError, type UserRecord } from './types';
import type { UserStore } from './user-store';

export type AdminUserEligibilityTransition = Partial<Pick<
  UserRecord,
  | 'role'
  | 'status'
  | 'passwordChangeRequired'
  | 'emailVerificationRequired'
  | 'emailVerifiedAt'
>>;

/** Protect self-service and last-active-admin invariants for a profile PATCH. */
export function assertAdminUserTransition(params: {
  store: UserStore;
  actorUserId: string;
  user: UserRecord;
  changes: AdminUserEligibilityTransition;
}): void {
  const next = { ...params.user, ...params.changes };

  if (params.actorUserId === params.user.userId && !isActiveAdmin(next)) {
    throw new AuthError(
      'Administrators cannot remove their own active admin access',
      'SELF_ADMIN_TRANSITION_FORBIDDEN',
      400
    );
  }

  assertLastActiveAdminPreserved(params.store, params.user, next);
}

/** Protect deletion from self-deletion and removal of the last active admin. */
export function assertAdminMayDeleteUser(
  store: UserStore,
  actorUserId: string,
  user: UserRecord
): void {
  assertNotSelf(actorUserId, user, 'delete their own account');
  assertLastActiveAdminPreserved(store, user, null);
}

/** Protect setup/reset-email flows that force the target to change password. */
export function assertAdminMayForcePasswordChange(
  store: UserStore,
  actorUserId: string,
  user: UserRecord
): void {
  assertNotSelf(actorUserId, user, 'force a password change on themselves');
  assertLastActiveAdminPreserved(store, user, {
    ...user,
    passwordChangeRequired: true,
  });
}

/** Emergency recovery may clear another user's existing password gate only. */
export function assertAdminMayClearPasswordChangeRequirement(
  actorUserId: string,
  user: UserRecord
): void {
  assertNotSelf(actorUserId, user, 'clear their own password-change requirement');
}

/** Direct admin password replacement is for other accounts only. */
export function assertAdminMayResetPassword(actorUserId: string, user: UserRecord): void {
  assertNotSelf(actorUserId, user, 'reset their own password through an admin route');
}

/** MFA reset destroys enrolled factors and therefore cannot target the actor. */
export function assertAdminMayResetMfa(actorUserId: string, user: UserRecord): void {
  assertNotSelf(actorUserId, user, 'reset their own MFA through an admin route');
}

/** Whether a user currently preserves the application's recoverable admin path. */
export function isActiveAdmin(user: UserRecord): boolean {
  return user.role === 'admin'
    && user.status === 'active'
    && !user.passwordChangeRequired
    && (!user.emailVerificationRequired || user.emailVerifiedAt !== null);
}

function assertNotSelf(actorUserId: string, user: UserRecord, action: string): void {
  if (actorUserId !== user.userId) return;
  throw new AuthError(
    `Administrators cannot ${action}`,
    'SELF_ADMIN_TRANSITION_FORBIDDEN',
    400
  );
}

function assertLastActiveAdminPreserved(
  store: UserStore,
  current: UserRecord,
  next: UserRecord | null
): void {
  if (!isActiveAdmin(current) || (next !== null && isActiveAdmin(next))) return;
  if (store.countActiveAdmins() > 1) return;

  throw new AuthError(
    'Cannot remove access from the last active administrator',
    'LAST_ACTIVE_ADMIN_REQUIRED',
    400
  );
}
