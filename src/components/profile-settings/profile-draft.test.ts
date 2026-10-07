import { expect, test } from 'bun:test';
import { normalizeAuthUserProfile } from '../../auth/auth-config-user-profile';
import type { UserProfileSnapshot } from '../../auth/auth-user-profile-types';
import { profileSettingsDraft, createProfileSettingsSchema, profileSettingsChanges,
  changedProfileSettingsFields, profileDisplayName, profileInitials } from './profile-draft';
import { userProfileError } from '../../frontend/client/user-profile-errors';

test('profile error presentation is actionable for taken usernames and never returns private messages', () => {
  expect(userProfileError({ status: 409, code: 'DUPLICATE_USERNAME', message: 'NEVER_RENDER_OR_LOG' }))
    .toBe('That username is already in use. Choose another username.');
  expect(userProfileError(new Error('NEVER_RENDER_OR_LOG'))).not.toContain('NEVER_RENDER_OR_LOG');
  expect(userProfileError({ code: 'AUTH_PROFILE_REVISION_CONFLICT' })).toContain('Review the latest');
});

function snapshot(): UserProfileSnapshot {
  const { contacts: _contactConfiguration, avatars: _avatarConfiguration, completion: _completionConfiguration, ...config } = normalizeAuthUserProfile({ fields: { preferredName: true, bio: true, socialLinks: true }, regional: true });
  return { userId: 'account', revision: 4, email: 'account@example.test',
    values: { firstName: 'Jane', lastName: 'Doe', username: 'account@example.test', preferredName: null,
      bio: null, website: null, socialLinks: [], regional: { locale: null, timeZone: null, timeFormat: null, weekStartsOn: null } },
    capabilities: { ...config, state: 'ready', regional: { ...config.regional, editable: true } } };
}
test('profile drafts round-trip through the real schema including structured social links', () => {
  const profile = snapshot(), schema = createProfileSettingsSchema(profile.capabilities), draft = profileSettingsDraft(profile);
  draft.socialLinks = [{ label: 'Website', url: 'https://example.test/' }];
  expect(schema.decodeRow(schema.encodeRow(draft))).toEqual(draft);
  expect(schema.validate(draft).success).toBe(true);
  expect(profileSettingsChanges(draft, ['socialLinks'], 4, profile.capabilities)).toEqual({ expectedRevision: 4,
    changes: { socialLinks: draft.socialLinks } });
});
test('only dirty admitted fields are sent; regional inheritance stays null', () => {
  const profile = snapshot(), baseline = profileSettingsDraft(profile), draft = { ...baseline, preferredName: '  Janie  ', timeFormat: '24h' as const };
  const dirty = changedProfileSettingsFields(draft, baseline);
  expect(dirty).toEqual(['preferredName', 'timeFormat']);
  expect(profileSettingsChanges(draft, dirty, 4, profile.capabilities)).toEqual({ expectedRevision: 4,
    changes: { preferredName: 'Janie', regional: { timeFormat: '24h' } } });
  expect(profileSettingsChanges(baseline, ['timeZone'], 4, profile.capabilities).changes.regional).toEqual({ timeZone: null });
});
test('UI adapters never widen disabled or read-only policy', () => {
  const profile = snapshot(), draft = profileSettingsDraft(profile);
  expect(() => profileSettingsChanges(draft, ['website'], 4, profile.capabilities)).toThrow('read-only');
  expect(() => profileSettingsChanges(draft, ['role'], 4, profile.capabilities)).toThrow('not supported');
  expect(() => profileSettingsChanges(draft, ['locale'], 4, { ...profile.capabilities,
    regional: { ...profile.capabilities.regional, editable: false } })).toThrow('read-only');
});
test('identity summary prefers explicit preferred name and falls back to two identifier letters', () => {
  const profile = snapshot();
  expect(profileDisplayName(profile)).toBe('Jane Doe'); expect(profileInitials(profile)).toBe('JD');
  profile.values.preferredName = 'Janie'; expect(profileDisplayName(profile)).toBe('Janie');
  profile.values.firstName = null; profile.values.lastName = null; expect(profileInitials(profile)).toBe('AC');
});
