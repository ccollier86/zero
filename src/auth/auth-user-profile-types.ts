/** Global identity profile contracts. These never confer authorization. */
import type { AuthUserContactConfig, ResolvedAuthUserContactConfig, UserContactCapabilities } from './auth-user-contact-types';
import type { AuthUserAvatarConfig, ResolvedAuthUserAvatarConfig, UserAvatarCapabilities } from './auth-user-avatar-types';
import type { AuthUserProfileCompletionConfig, ResolvedAuthUserProfileCompletionConfig } from './auth-user-profile-completion-types';
export const USER_PROFILE_FIELDS = [
  'firstName', 'lastName', 'username', 'preferredName', 'bio', 'website', 'socialLinks',
] as const;
export type UserProfileField = typeof USER_PROFILE_FIELDS[number];
export const USER_REGIONAL_FIELDS = ['locale', 'timeZone', 'timeFormat', 'weekStartsOn'] as const;
export type UserRegionalField = typeof USER_REGIONAL_FIELDS[number];

export interface UserProfileFieldPolicy {
  enabled?: boolean;
  editable?: boolean;
  required?: boolean;
}
export interface ResolvedUserProfileFieldPolicy {
  enabled: boolean;
  editable: boolean;
  required: boolean;
}
export interface UserSocialLink { label: string; url: string }
export interface UserRegionalPreferences {
  /** Null inherits the app default; inferred browser values are never silently saved. */
  locale: string | null;
  timeZone: string | null;
  timeFormat: '12h' | '24h' | null;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | null;
}
export interface UserRegionalConfig {
  enabled?: boolean;
  fields?: readonly UserRegionalField[];
  defaults?: Partial<UserRegionalPreferences>;
}
export interface ResolvedUserRegionalConfig {
  enabled: boolean;
  fields: readonly UserRegionalField[];
  defaults: UserRegionalPreferences;
}
export interface AuthUserProfileConfig {
  /** Core profile editing is enabled by default; expanded fields are opt-in. */
  enabled?: boolean;
  /** Presentation/edit admission, not a change to the login identifier contract. */
  usernameMode?: 'email' | 'separate';
  fields?: Partial<Record<UserProfileField, boolean | UserProfileFieldPolicy>>;
  regional?: boolean | UserRegionalConfig;
  /** Optional possession proof and contact-change ceremonies; not formatting validation. */
  contacts?: AuthUserContactConfig;
  avatars?: boolean | AuthUserAvatarConfig;
  completion?: AuthUserProfileCompletionConfig;
}
export interface ResolvedAuthUserProfileConfig {
  enabled: boolean;
  usernameMode: 'email' | 'separate';
  fields: Record<UserProfileField, ResolvedUserProfileFieldPolicy>;
  regional: ResolvedUserRegionalConfig;
  contacts: ResolvedAuthUserContactConfig;
  avatars: ResolvedAuthUserAvatarConfig;
  completion: ResolvedAuthUserProfileCompletionConfig;
}
export interface UserProfileValues {
  firstName: string | null;
  lastName: string | null;
  username: string;
  preferredName: string | null;
  bio: string | null;
  website: string | null;
  socialLinks: UserSocialLink[];
  regional: UserRegionalPreferences;
}
export interface UserProfileCapabilities {
  /** Optional backward-compatible public configuration projection; contacts have their own revision and ceremonies. */
  contacts?: UserContactCapabilities;
  /** Optional public media readiness/presentation; not a raw storage/configuration authority. */
  avatars?: UserAvatarCapabilities;
  state: 'ready' | 'blocked' | 'disabled';
  usernameMode: 'email' | 'separate';
  fields: Record<UserProfileField, ResolvedUserProfileFieldPolicy>;
  regional: ResolvedUserRegionalConfig & { editable: boolean };
}
export interface UserProfileSnapshot {
  userId: string;
  revision: number;
  /** Native callers without the email identity scope receive null. */
  email: string | null;
  values: UserProfileValues;
  capabilities: UserProfileCapabilities;
}
export interface UpdateUserProfileInput {
  expectedRevision: number;
  changes: Partial<Omit<UserProfileValues, 'regional'>> & {
    regional?: Partial<UserRegionalPreferences>;
  };
}
