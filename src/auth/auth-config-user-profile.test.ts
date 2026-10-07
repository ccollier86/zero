import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { validateUserRegionalPreferences } from './auth-config-user-profile';

describe('global user profile policy', () => {
  test('keeps expanded fields opt-in and never changes login identifiers', () => {
    const config = resolveAuthBehaviorConfig().userProfile;
    expect(config.enabled).toBe(true);
    expect(config.fields.firstName.enabled).toBe(true);
    expect(config.fields.lastName.enabled).toBe(true);
    expect(config.fields.username.enabled).toBe(false);
    expect(config.fields.bio.enabled).toBe(false);
    expect(config.regional.enabled).toBe(false);
    expect(config.regional.defaults).toEqual({ locale: null, timeZone: null, timeFormat: null, weekStartsOn: null });
    expect(Object.isFrozen(config.fields)).toBe(true);
  });
  test('normalizes an independently editable expanded profile', () => {
    const config = resolveAuthBehaviorConfig({ userProfile: {
      fields: { preferredName: true, bio: { enabled: true, editable: false },
        website: { enabled: true, required: true }, username: true },
      regional: { enabled: true, fields: ['timeZone', 'timeFormat'],
        defaults: { timeZone: 'America/New_York', timeFormat: '12h' } },
    } }).userProfile;
    expect(config.fields.preferredName).toEqual({ enabled: true, editable: true, required: false });
    expect(config.fields.bio.editable).toBe(false);
    expect(config.fields.website.required).toBe(true);
    expect(config.regional.fields).toEqual(['timeZone', 'timeFormat']);
    expect(config.regional.defaults.timeZone).toBe('America/New_York');
  });
  test('rejects unknown fields, contradictory requirements and malformed regional settings', () => {
    const invalid: unknown[] = [
      { fields: { password: true } }, { fields: { bio: 'yes' } },
      { fields: { bio: { enabled: false, required: true } } },
      { fields: { bio: { enabled: true, editable: false, required: true } } },
      { usernameMode: 'email', fields: { username: true } },
      { regional: { fields: [] } }, { regional: { fields: ['locale', 'locale'] } },
      { regional: { defaults: { timeZone: 'not-a-timezone' } } },
      { regional: { defaults: { timeZone: '+01:00' } } },
      { regional: { defaults: { locale: 'invalid_locale' } } },
      { regional: { defaults: { timeFormat: '13h' } } },
      { regional: { defaults: { weekStartsOn: 7 } } },
    ];
    for (const userProfile of invalid) {
      expect(() => resolveAuthBehaviorConfig({ userProfile: userProfile as never })).toThrow();
    }
  });
  test('validates nullable regional values without inventing browser defaults', () => {
    expect(() => validateUserRegionalPreferences({ locale: null, timeZone: null, weekStartsOn: 0 })).not.toThrow();
    expect(() => validateUserRegionalPreferences({ timeFormat: 24 as never })).toThrow();
    expect(() => validateUserRegionalPreferences({ weekStartsOn: '1' as never })).toThrow();
  });
});
