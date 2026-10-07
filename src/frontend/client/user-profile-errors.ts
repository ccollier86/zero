/** Static own-profile error presentation shared by hooks and editors; no private payload reaches UI. */

/** Map known Guardian failure codes to actionable copy without exposing the original message. */
export function userProfileError(cause: unknown): string {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  if (code === 'DUPLICATE_USERNAME') return 'That username is already in use. Choose another username.';
  if (code === 'AUTH_PROFILE_REVISION_CONFLICT') return 'Your profile changed elsewhere. Review the latest version before saving.';
  if (code === 'AUTH_PROFILE_NOT_READY') return 'Profile settings are not ready. An administrator needs to apply the required database migration.';
  return 'Your profile could not be loaded or saved. Please try again.';
}
