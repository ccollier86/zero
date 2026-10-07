/** Canonical bounded self-profile patches; unknown/security fields never reach storage. */

import { types as utilTypes } from 'node:util';
import { AUTH_REQUEST_LIMITS } from './auth-request-limits';
import { validateUserRegionalPreferences } from './auth-config-user-profile';
import {
  USER_PROFILE_FIELDS, USER_REGIONAL_FIELDS,
  type UpdateUserProfileInput, type UserSocialLink,
} from './auth-user-profile-types';
import { AuthError } from './types';

const STRING_BOUNDS = { firstName: 120, lastName: 120, preferredName: 120, bio: 2000, website: 2048 } as const;

/** Capture a detached command before any asynchronous transport/admission boundary. */
export function captureUserProfileUpdate(value: unknown): UpdateUserProfileInput {
  const input = plain(value, ['expectedRevision', 'changes']);
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1
    || Number(input.expectedRevision) >= Number.MAX_SAFE_INTEGER) throw invalidProfile();
  const changes = plain(input.changes, [...USER_PROFILE_FIELDS, 'regional']);
  const captured: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'username') {
      if (typeof value !== 'string' || value.length < 1 || value.length > AUTH_REQUEST_LIMITS.username
        || value.trim().length === 0 || !wellFormed(value) || /[\u0000-\u001F\u007F]/u.test(value)) throw invalidProfile();
      captured.username = value;
    } else if (key === 'socialLinks') {
      captured.socialLinks = captureSocialLinks(value);
    } else if (key === 'regional') {
      const regional = plain(value, USER_REGIONAL_FIELDS);
      for (const entry of Object.values(regional)) if (entry === undefined) throw invalidProfile();
      try { validateUserRegionalPreferences(regional); } catch { throw invalidProfile(); }
      captured.regional = Object.freeze({ ...regional });
    } else {
      const field = key as keyof typeof STRING_BOUNDS;
      if (value !== null && (typeof value !== 'string' || value.length > STRING_BOUNDS[field]
        || !wellFormed(value) || value.includes('\0'))) throw invalidProfile();
      const text = typeof value === 'string' ? value.trim() : null;
      captured[field] = text === '' ? null : field === 'website' && text !== null ? profileUrl(text) : text;
    }
  }
  if (Object.keys(captured).length === 0) throw invalidProfile();
  return Object.freeze({
    expectedRevision: Number(input.expectedRevision),
    changes: Object.freeze(captured),
  }) as UpdateUserProfileInput;
}

/** Stored links use the same contract; corrupt retained values fail closed, never coerce. */
export function captureSocialLinks(value: unknown): UserSocialLink[] {
  if (utilTypes.isProxy(value) || !Array.isArray(value) || value.length > 12) throw invalidProfile();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string'
    || (key !== 'length' && !/^(0|[1-9]\d*)$/u.test(key)))) throw invalidProfile();
  const links: UserSocialLink[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = descriptors[index];
    if (!entry || !('value' in entry)) throw invalidProfile();
    const link = plain(entry.value, ['label', 'url']);
    if (typeof link.label !== 'string' || link.label.length > 80 || !wellFormed(link.label)
      || link.label.includes('\0') || link.label.trim().length === 0
      || typeof link.url !== 'string' || link.url.length > 2048) throw invalidProfile();
    links.push(Object.freeze({ label: link.label.trim(), url: profileUrl(link.url) }));
  }
  return Object.freeze(links) as unknown as UserSocialLink[];
}

function profileUrl(value: string): string {
  if (!wellFormed(value) || /[\u0000-\u0020\u007F]/u.test(value)) throw invalidProfile();
  let url: URL;
  try { url = new URL(value); } catch { throw invalidProfile(); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) throw invalidProfile();
  const canonical = url.href;
  if (canonical.length > 2048) throw invalidProfile();
  return canonical;
}

function plain(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) throw invalidProfile();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidProfile();
  const properties = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(properties)) {
    const property = typeof key === 'string' ? properties[key] : undefined;
    if (typeof key !== 'string' || !keys.includes(key) || !property || !('value' in property)
      || !property.enumerable) throw invalidProfile();
    output[key] = property.value;
  }
  return output;
}

export function invalidProfile(): AuthError {
  return new AuthError('Invalid profile changes', 'AUTH_PROFILE_VALIDATION_FAILED', 422);
}

function wellFormed(value: string): boolean {
  // Unicode regex treats paired surrogates as one code point; only lone halves match.
  return !/[\uD800-\uDFFF]/u.test(value);
}
