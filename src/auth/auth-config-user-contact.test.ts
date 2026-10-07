import { describe, expect, test } from 'bun:test';
import { normalizeAuthUserContacts } from './auth-config-user-contact';
import { resolveAuthBehaviorConfig } from './auth-config';
describe('contact policy normalization', () => {
  test('all contact features are explicitly disabled by default', () => {
    const config = normalizeAuthUserContacts();
    expect(config).toMatchObject({ enabled: false, email: { verify: false, change: false },
      phone: { enabled: false, editable: false, verify: false }, challengeTTLms: 900000,
      resendCooldownMs: 60000, maxAttempts: 5, verificationPath: '/verify-contact' });
    expect(Object.isFrozen(config.phone)).toBe(true);
    expect(resolveAuthBehaviorConfig({}).userProfile.contacts).toEqual(config);
  });
  test('configuration is closed, bounded and does not silently enable phone capabilities', () => {
    for (const input of [{ email: { sms: true } }, { phone: { verify: true } }, { maxAttempts: 11 },
      { challengeTTL: '1d' }, { resendCooldown: '15m' }, { verificationPath: '//evil.test' },
      { verificationPath: '/proof?token=attacker' }, { enabled: 'yes' }]) {
      expect(() => normalizeAuthUserContacts(input as any)).toThrow();
    }
    expect(normalizeAuthUserContacts({ enabled: true, phone: { enabled: true, editable: true } }).phone.verify).toBe(false);
  });
});
