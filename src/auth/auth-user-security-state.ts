/** Security-state comparisons shared by administrator account mutations. */

import type { UserRecord } from './types';
import { canonicalizeEmail } from './auth-email-identity';

/** Return true when cached access/transition identity must be invalidated. */
export function hasAuthenticationBoundaryChange(before: UserRecord, after: UserRecord): boolean {
  return before.role !== after.role
    || before.status !== after.status
    || before.passwordChangeRequired !== after.passwordChangeRequired
    || before.mfaRequired !== after.mfaRequired
    || canonicalizeEmail(before.email) !== canonicalizeEmail(after.email)
    || before.emailVerificationRequired !== after.emailVerificationRequired
    || before.emailVerifiedAt !== after.emailVerifiedAt;
}
