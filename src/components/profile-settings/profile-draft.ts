/** Maps one schema-backed settings draft to Guardian's own-profile contract. */
import { defineSchema } from '../../schema/define-schema';
import { field } from '../../schema/field-types';
import type { Row } from '../../sync/types';
import { areFormValuesEqual } from '../../hooks/form-value-utils';
import { USER_PROFILE_FIELDS, USER_REGIONAL_FIELDS, type UserProfileCapabilities,
  type UserProfileSnapshot, type UpdateUserProfileInput, type UserSocialLink } from '../../auth/auth-user-profile-types';

export interface ProfileSettingsDraft extends Row {
  firstName: string | null;
  lastName: string | null;
  username: string;
  preferredName: string | null;
  bio: string | null;
  website: string | null;
  socialLinks: UserSocialLink[];
  locale: string | null;
  timeZone: string | null;
  timeFormat: '12h' | '24h' | null;
  weekStartsOn: number | null;
}
export function createProfileSettingsSchema(capabilities: UserProfileCapabilities) {
  const required = (name: typeof USER_PROFILE_FIELDS[number]) => capabilities.fields[name].required;
  return defineSchema({
    firstName: field.text({ maxLength: 120, required: required('firstName') }),
    lastName: field.text({ maxLength: 120, required: required('lastName') }),
    username: field.text({ maxLength: 255, required: true }),
    preferredName: field.text({ maxLength: 120, required: required('preferredName') }),
    bio: field.text({ maxLength: 2000, required: required('bio') }),
    website: field.text({ maxLength: 2048, required: required('website') }),
    socialLinks: field.json(),
    locale: field.text({ maxLength: 80 }), timeZone: field.text({ maxLength: 100 }),
    timeFormat: field.select([{ label: '12-hour', value: '12h' }, { label: '24-hour', value: '24h' }]),
    weekStartsOn: field.number({ min: 0, max: 6 }),
  });
}
export function profileSettingsDraft(snapshot: UserProfileSnapshot): ProfileSettingsDraft {
  const { regional, ...identity } = snapshot.values;
  return { ...identity, ...regional };
}
export function changedProfileSettingsFields(draft: ProfileSettingsDraft, baseline: ProfileSettingsDraft): string[] {
  return [...USER_PROFILE_FIELDS, ...USER_REGIONAL_FIELDS].filter(key => !areFormValuesEqual(draft[key], baseline[key]));
}
export function profileSettingsChanges(draft: ProfileSettingsDraft, fields: readonly string[],
  expectedRevision: number, capabilities: UserProfileCapabilities): UpdateUserProfileInput {
  const changes: UpdateUserProfileInput['changes'] = {};
  if (capabilities.state !== 'ready') throw new Error('Profile settings are not ready to save.');
  for (const key of fields) {
    if (USER_PROFILE_FIELDS.includes(key as typeof USER_PROFILE_FIELDS[number])) {
      const field = key as typeof USER_PROFILE_FIELDS[number], policy = capabilities.fields[field];
      if (!policy.enabled || !policy.editable) throw new Error('This profile field is read-only.');
      if (field === 'socialLinks') changes.socialLinks = draft.socialLinks;
      else if (field === 'username') changes.username = draft.username;
      else changes[field] = draft[field]?.trim() || null;
    } else if (USER_REGIONAL_FIELDS.includes(key as typeof USER_REGIONAL_FIELDS[number])) {
      const field = key as typeof USER_REGIONAL_FIELDS[number];
      if (!capabilities.regional.enabled || !capabilities.regional.editable || !capabilities.regional.fields.includes(field)) {
        throw new Error('This regional preference is read-only.');
      }
      if (field === 'weekStartsOn') {
        const day = draft.weekStartsOn;
        if (day !== null && (!Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Choose a valid first day of the week.');
        changes.regional = { ...changes.regional, weekStartsOn: day as 0 | 1 | 2 | 3 | 4 | 5 | 6 | null };
      } else changes.regional = { ...changes.regional, [field]: draft[field] || null };
    } else throw new Error('This profile field is not supported.');
  }
  return { expectedRevision, changes };
}

export function profileDisplayName(snapshot: UserProfileSnapshot): string {
  return snapshot.values.preferredName?.trim()
    || [snapshot.values.firstName, snapshot.values.lastName].filter(Boolean).join(' ').trim()
    || snapshot.values.username || snapshot.email || 'Your account';
}
export function profileInitials(snapshot: UserProfileSnapshot): string {
  const names = [snapshot.values.firstName, snapshot.values.lastName].filter((name): name is string => Boolean(name?.trim()));
  return names.length ? names.map(name => Array.from(name.trim().normalize('NFC'))[0]).join('').toUpperCase()
    : Array.from((snapshot.values.username || snapshot.email || '?').normalize('NFC')).slice(0, 2).join('').toUpperCase();
}
