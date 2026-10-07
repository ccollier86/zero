/** Synthetic first-use projections shared only by focused parser/SDK/UI tests. */
import { USER_PROFILE_FIELDS, USER_REGIONAL_FIELDS, type UserProfileSnapshot } from '../../auth/auth-user-profile-types';
import type { AuthProfileCompletionRequiredResult, AuthUser } from './auth-types';

export function completionUser(userId = 'user-a'): AuthUser {
  return { userId, username: userId, email: `${userId}@example.test`, firstName: null, lastName: null, role: 'user', status: 'active',
    passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false,
    properties: {}, createdAt: 1, updatedAt: null };
}
export function completionProfile(userId = 'user-a'): UserProfileSnapshot {
  const regional = { locale: null, timeZone: null, timeFormat: null, weekStartsOn: null };
  return { userId, revision: 1, email: `${userId}@example.test`, values: { firstName: null, lastName: null, username: userId,
    preferredName: null, bio: null, website: null, socialLinks: [], regional }, capabilities: { state: 'ready', usernameMode: 'email',
    fields: Object.fromEntries(USER_PROFILE_FIELDS.map(field => [field, { enabled: field !== 'username', editable: field !== 'username', required: field === 'firstName' }])) as UserProfileSnapshot['capabilities']['fields'],
    regional: { enabled: false, editable: false, fields: [...USER_REGIONAL_FIELDS], defaults: { ...regional } } } };
}
export function profileCompletionResult(userId = 'user-a'): AuthProfileCompletionRequiredResult {
  return { user: completionUser(userId), profileCompletionRequired: true,
    profileCompletion: { continuation: `zct_${userId.replaceAll('-', '_')}_${'a'.repeat(48)}`, expiresAt: Date.now() + 600000,
      profile: completionProfile(userId), missingFields: ['firstName'], state: 'ready' } };
}
