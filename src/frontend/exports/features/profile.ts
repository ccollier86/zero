/** Profile, contact, avatar and presence integration. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

export { useUserProfile } from '../../client/user-profile-hooks';
export { useUserContacts } from '../../client/user-contact-hooks';
export type { UseUserContactsOptions, UseUserContactsResult } from '../../client/user-contact-hooks';
export { useUserAvatar } from '../../client/user-avatar-hooks';
export type { UseUserAvatarOptions, UseUserAvatarResult } from '../../client/user-avatar-hooks';
export { useGuardianPresence, useAvatarPresence } from '../../client/guardian-presence-hooks';
export type { GuardianPresenceClient, GuardianPresenceClientSnapshot } from '../../client/guardian-presence-client';
export type { GuardianPresenceOwnSnapshot } from '../../client/guardian-presence-parser';
export { UserPresenceSettings, type UserPresenceSettingsProps } from '../../../components/profile-settings/user-presence-settings';
export type { UseUserProfileOptions, UseUserProfileResult } from '../../client/user-profile-hooks';
export type * from '../../../auth/auth-user-profile-types';
export type * from '../../../auth/auth-user-profile-completion-types';
export type * from '../../../auth/auth-presence-types';
export type * from '../../../auth/auth-user-contact-types';
export type * from '../../../auth/auth-user-avatar-types';
export { UserProfileSettings, UserProfileIdentitySummary, UserProfileFields,
  UserRegionalSettings, UserProfileSecurity, UserContactSettings, UserContactProofBadge, ContactEmailVerification } from '../../../components/profile-settings';
export type { UserProfileSettingsProps, UserProfileFieldsProps, UserRegionalSettingsProps,
  UserContactSettingsProps, ContactEmailVerificationProps } from '../../../components/profile-settings';
