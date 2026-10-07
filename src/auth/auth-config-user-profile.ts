/** Policy normalization only. Profile storage/readiness is owned by its service. */
import {
  USER_PROFILE_FIELDS, USER_REGIONAL_FIELDS,
  type AuthUserProfileConfig, type ResolvedAuthUserProfileConfig,
  type ResolvedUserProfileFieldPolicy, type ResolvedUserRegionalConfig,
  type UserRegionalConfig, type UserRegionalPreferences, type UserProfileFieldPolicy,
} from './auth-user-profile-types';
import { assertOnlyKeys, assertOptionalBoolean, assertPlainRecord } from './auth-config-validation';
import { normalizeAuthUserContacts } from './auth-config-user-contact';
import { normalizeAuthUserAvatar } from './auth-config-user-avatar';
import { normalizeAuthUserProfileCompletion } from './auth-config-user-profile-completion';

const EMPTY_REGIONAL: UserRegionalPreferences = {
  locale: null, timeZone: null, timeFormat: null, weekStartsOn: null,
};

export function normalizeAuthUserProfile(config: AuthUserProfileConfig = {}): ResolvedAuthUserProfileConfig {
  assertPlainRecord(config, 'User profile config');
  assertOnlyKeys(config, ['enabled', 'usernameMode', 'fields', 'regional', 'contacts', 'avatars', 'completion'], 'User profile config');
  assertOptionalBoolean(config.enabled, 'User profile enabled');
  const usernameMode = config.usernameMode ?? 'separate';
  if (usernameMode !== 'email' && usernameMode !== 'separate') {
    throw new Error('[auth] User profile usernameMode must be "email" or "separate".');
  }
  if (config.fields !== undefined) {
    assertPlainRecord(config.fields, 'User profile fields');
    assertOnlyKeys(config.fields, USER_PROFILE_FIELDS, 'User profile fields');
  }
  const fields = {} as ResolvedAuthUserProfileConfig['fields'];
  for (const field of USER_PROFILE_FIELDS) {
    const input: boolean | UserProfileFieldPolicy | undefined = config.fields?.[field];
    const defaultEnabled = field === 'firstName' || field === 'lastName';
    const policy: UserProfileFieldPolicy = typeof input === 'boolean' ? { enabled: input } : input ?? {};
    assertPlainRecord(policy, `User profile field ${field}`);
    assertOnlyKeys(policy, ['enabled', 'editable', 'required'], `User profile field ${field}`);
    for (const key of ['enabled', 'editable', 'required'] as const) {
      assertOptionalBoolean(policy[key], `User profile field ${field} ${key}`);
    }
    const resolved: ResolvedUserProfileFieldPolicy = {
      enabled: policy.enabled ?? defaultEnabled,
      editable: policy.editable ?? true,
      required: policy.required ?? false,
    };
    if (resolved.required && (!resolved.enabled || !resolved.editable)) {
      throw new Error(`[auth] Required user profile field ${field} must be enabled and editable.`);
    }
    if (field === 'username' && usernameMode === 'email' && resolved.enabled) {
      throw new Error('[auth] Separate username fields cannot be enabled in email usernameMode.');
    }
    fields[field] = Object.freeze(resolved);
  }
  return Object.freeze({
    enabled: config.enabled ?? true,
    usernameMode,
    fields: Object.freeze(fields),
    regional: normalizeRegional(config.regional),
    contacts: normalizeAuthUserContacts(config.contacts),
    avatars: normalizeAuthUserAvatar(config.avatars),
    completion: normalizeAuthUserProfileCompletion(config.completion),
  });
}

function normalizeRegional(input: AuthUserProfileConfig['regional']): ResolvedUserRegionalConfig {
  const config: UserRegionalConfig = typeof input === 'boolean' ? { enabled: input } : input ?? {};
  assertPlainRecord(config, 'Regional preferences config');
  assertOnlyKeys(config, ['enabled', 'fields', 'defaults'], 'Regional preferences config');
  assertOptionalBoolean(config.enabled, 'Regional preferences enabled');
  const fields = config.fields ?? USER_REGIONAL_FIELDS;
  if (!Array.isArray(fields) || fields.length === 0 || new Set(fields).size !== fields.length
    || fields.some(field => !USER_REGIONAL_FIELDS.includes(field))) {
    throw new Error('[auth] Regional preferences fields must be a non-empty unique list of supported fields.');
  }
  if (config.defaults !== undefined) {
    assertPlainRecord(config.defaults, 'Regional defaults');
    assertOnlyKeys(config.defaults, USER_REGIONAL_FIELDS, 'Regional defaults');
  }
  const defaults = { ...EMPTY_REGIONAL, ...config.defaults };
  validateUserRegionalPreferences(defaults);
  return Object.freeze({
    enabled: config.enabled ?? false,
    fields: Object.freeze([...fields]),
    defaults: Object.freeze(defaults),
  });
}

/** Shared value validation; configuration and profile writes must agree. */
export function validateUserRegionalPreferences(values: Partial<UserRegionalPreferences>): void {
  for (const key of Object.keys(values)) {
    if (!USER_REGIONAL_FIELDS.includes(key as typeof USER_REGIONAL_FIELDS[number])) {
      throw new Error(`[auth] Unsupported regional preference: ${key}.`);
    }
  }
  if (values.locale != null) {
    if (typeof values.locale !== 'string' || values.locale.length > 80) {
      throw new Error('[auth] Regional locale must be a supported language tag.');
    }
    try { new Intl.Locale(values.locale); }
    catch { throw new Error('[auth] Regional locale must be a supported language tag.'); }
  }
  if (values.timeZone != null) {
    if (typeof values.timeZone !== 'string' || values.timeZone.length > 100 || /^[+-]/.test(values.timeZone)) {
      throw new Error('[auth] Regional timeZone must be a supported IANA time zone.');
    }
    try { new Intl.DateTimeFormat('en', { timeZone: values.timeZone }); }
    catch { throw new Error('[auth] Regional timeZone must be a supported IANA time zone.'); }
  }
  if (values.timeFormat != null && values.timeFormat !== '12h' && values.timeFormat !== '24h') {
    throw new Error('[auth] Regional timeFormat must be "12h", "24h", or null.');
  }
  if (values.weekStartsOn != null && (!Number.isInteger(values.weekStartsOn)
    || values.weekStartsOn < 0 || values.weekStartsOn > 6)) {
    throw new Error('[auth] Regional weekStartsOn must be an integer from 0 to 6, or null.');
  }
}
