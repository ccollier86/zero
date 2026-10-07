/** Stable presentation for contact ceremonies; no raw address, password, token or provider error reaches UI/logs. */
export function userContactError(cause: unknown): string {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  switch (code) {
    case 'AUTH_CONTACT_REVISION_CONFLICT': return 'Your contact settings changed elsewhere. Review the latest details before trying again.';
    case 'AUTH_CONTACT_COOLDOWN': return 'Please wait a little before requesting another verification.';
    case 'AUTH_CONTACT_DELIVERY_UNAVAILABLE':
    case 'AUTH_CONTACT_ADAPTER_UNAVAILABLE': return 'Verification delivery is unavailable. Your saved contact has not been verified.';
    case 'AUTH_CONTACT_CODE_INVALID': return 'That verification code was not accepted. Check it and try again.';
    case 'AUTH_CONTACT_CHALLENGE_INVALID': return 'This verification has expired or is no longer available. Request a new one.';
    case 'INVALID_PASSWORD': return 'Your current password was not accepted.';
    case 'DUPLICATE_EMAIL': return 'That email address is unavailable. Choose another address.';
    case 'AUTH_CONTACT_SCOPE_REQUIRED':
    case 'AUTH_CONTACT_FIELD_NOT_EDITABLE': return 'This session does not allow that contact change.';
    case 'AUTH_CONTACT_NOT_READY': return 'Contact settings need a database migration or a ready server. Contact your administrator.';
    default: return 'These contact settings could not be updated. Please try again.';
  }
}
