/** Safe avatar operation feedback; storage paths, signed grants and decoder errors never become UI copy. */
export function userAvatarError(cause: unknown): string {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  if (code === 'AUTH_AVATAR_REVISION_CONFLICT' || code === 'AUTH_PROFILE_REVISION_CONFLICT') return 'Your profile changed elsewhere. Review the latest version before saving this picture.';
  if (code === 'AUTH_AVATAR_NOT_READY') return 'Profile pictures need the required database migration and storage service. Contact your administrator.';
  if (code === 'AUTH_AVATAR_IMAGE_INVALID') return 'Choose a valid JPEG, PNG or WebP image within the configured size limits.';
  if (code === 'AUTH_AVATAR_READ_ONLY' || code === 'AUTH_AVATAR_SESSION_REQUIRED') return 'Profile picture changes are not available for this session.';
  return 'Your profile picture could not be loaded or saved. Please try again.';
}
