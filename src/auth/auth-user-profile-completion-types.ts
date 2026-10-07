/** Optional identity-only profile completion before a full application session. */
import type { UpdateUserProfileInput, UserProfileField, UserProfileSnapshot } from './auth-user-profile-types';
export interface AuthUserProfileCompletionConfig {
  enabled?: boolean;
  onSignup?: boolean;
  onInvitation?: boolean;
  existingUsers?: 'none' | 'onSignIn';
  ttl?: string;
}
export interface ResolvedAuthUserProfileCompletionConfig {
  enabled: boolean;
  onSignup: boolean;
  onInvitation: boolean;
  existingUsers: 'none' | 'onSignIn';
  ttl: string;
  ttlMs: number;
}
export interface UserProfileCompletion {
  continuation: string;
  expiresAt: number;
  /** Null when the required profile substrate is unavailable; never fabricated empty values. */
  profile: UserProfileSnapshot | null;
  missingFields: readonly UserProfileField[];
  state: 'ready' | 'blocked';
}
export interface ProfileCompletionRequired {
  kind: 'profile_completion_required';
  profileCompletion: UserProfileCompletion;
}
export interface CompleteUserProfileInput extends UpdateUserProfileInput { continuation: string }
