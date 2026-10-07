/** Strict, secret-free profile response admission before UI state consumes it. */
import {
  USER_PROFILE_FIELDS, USER_REGIONAL_FIELDS,
  type UserProfileCapabilities, type UserProfileSnapshot,
} from '../../auth/auth-user-profile-types';
import { validateUserRegionalPreferences } from '../../auth/auth-config-user-profile';
import { isUserContactCapabilities } from './auth-user-contact-parser';
import { isUserAvatarCapabilities } from './auth-user-avatar-parser';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const nullableString = (value: unknown) => value === null || typeof value === 'string';

export function isUserProfileCapabilities(value: unknown): value is UserProfileCapabilities {
  if (!record(value) || typeof value.state !== 'string' || !['ready', 'blocked', 'disabled'].includes(value.state)
    || typeof value.usernameMode !== 'string' || !['email', 'separate'].includes(value.usernameMode) || !record(value.fields)
    || !record(value.regional)) return false;
  const fields = value.fields;
  if (value.contacts !== undefined && !isUserContactCapabilities(value.contacts)) return false;
  if (value.avatars !== undefined && !isUserAvatarCapabilities(value.avatars)) return false;
  if (USER_PROFILE_FIELDS.some(key => {
    const rule = fields[key];
    return !record(rule) || typeof rule.enabled !== 'boolean' || typeof rule.editable !== 'boolean'
      || typeof rule.required !== 'boolean' || (rule.required && !rule.enabled);
  })) return false;
  const regional = value.regional;
  if (typeof regional.enabled !== 'boolean' || typeof regional.editable !== 'boolean' || !Array.isArray(regional.fields)
    || regional.fields.length === 0 || new Set(regional.fields).size !== regional.fields.length
    || regional.fields.some(key => !USER_REGIONAL_FIELDS.includes(key)) || !record(regional.defaults)) return false;
  try { validateUserRegionalPreferences(regional.defaults); }
  catch { return false; }
  return USER_REGIONAL_FIELDS.every(key => Object.hasOwn(regional.defaults as object, key));
}

export function isUserProfileSnapshot(value: unknown): value is UserProfileSnapshot {
  if (!record(value) || typeof value.userId !== 'string' || !value.userId
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !nullableString(value.email) || !isUserProfileCapabilities(value.capabilities)
    || !record(value.values)) return false;
  const values = value.values;
  if (typeof values.username !== 'string' || ['firstName', 'lastName', 'preferredName', 'bio', 'website']
    .some(key => !nullableString(values[key])) || !Array.isArray(values.socialLinks)
    || values.socialLinks.length > 12 || values.socialLinks.some(link => !record(link)
      || typeof link.label !== 'string' || typeof link.url !== 'string') || !record(values.regional)) return false;
  try { validateUserRegionalPreferences(values.regional); }
  catch { return false; }
  return USER_REGIONAL_FIELDS.every(key => Object.hasOwn(values.regional as object, key));
}
