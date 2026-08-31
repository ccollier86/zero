/**
 * auth-user-response.ts
 *
 * Maps internal auth user records to the public payload returned by auth
 * routes. This keeps response shaping out of route composition code.
 */

import type { UserRecord } from './types';

/** Return the public user payload used by auth route responses. */
export function toAuthUserResponse(user: UserRecord): UserRecord {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    passwordChangeRequired: user.passwordChangeRequired,
    emailVerifiedAt: user.emailVerifiedAt,
    emailVerificationRequired: user.emailVerificationRequired,
    mfaRequired: user.mfaRequired,
    properties: user.properties,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
