/** Strict, detached admission of identity-only completion snapshots; never copies credentials. */
import type { UserProfileCompletion } from '../../auth/auth-user-profile-completion-types';
import { USER_PROFILE_FIELDS, type UserProfileSnapshot } from '../../auth/auth-user-profile-types';
import { isUserProfileSnapshot } from './auth-user-profile-parser';

/** Admit exactly one bounded continuation and its actual profile readiness/requirements. */
export function parseUserProfileCompletion(value: unknown, expectedUserId?: string): UserProfileCompletion {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'continuation,expiresAt,missingFields,profile,state'
    || typeof value.continuation !== 'string' || value.continuation.length < 40 || value.continuation.length > 200
    || !/^zct_[A-Za-z0-9_-]+$/.test(value.continuation)
    || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) < 0
    || value.state !== 'ready' && value.state !== 'blocked'
    || !Array.isArray(value.missingFields) || value.missingFields.length > USER_PROFILE_FIELDS.length
    || new Set(value.missingFields).size !== value.missingFields.length
    || value.missingFields.some(field => typeof field !== 'string' || !USER_PROFILE_FIELDS.includes(field as never))) throw invalid();
  let profile: UserProfileSnapshot | null = null;
  if (value.state === 'blocked') {
    if (value.profile !== null) throw invalid();
  } else {
    if (!isUserProfileSnapshot(value.profile) || value.profile.capabilities.state !== 'ready'
      || typeof value.profile.capabilities.usernameMode !== 'string'
      || expectedUserId !== undefined && value.profile.userId !== expectedUserId) throw invalid();
    // Copy only the explicit profile projection. Mutation, URL/native scope
    // selectors and unknown response-envelope keys cannot become form state.
    const source = value.profile;
    if (value.missingFields.some(field => !source.capabilities.fields[field as typeof USER_PROFILE_FIELDS[number]].required)) throw invalid();
    profile = freeze({ userId: source.userId, revision: source.revision, email: source.email,
      values: { firstName: source.values.firstName, lastName: source.values.lastName, username: source.values.username,
        preferredName: source.values.preferredName, bio: source.values.bio, website: source.values.website,
        socialLinks: source.values.socialLinks.map(link => ({ label: link.label, url: link.url })), regional: { ...source.values.regional } },
      capabilities: structuredClone(source.capabilities) });
  }
  return freeze({ continuation: value.continuation, expiresAt: value.expiresAt as number, profile,
    missingFields: [...value.missingFields] as UserProfileCompletion['missingFields'], state: value.state });
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function invalid(): Error { return new Error('[client] Zero returned an invalid profile completion response.'); }
