/** Pure configuration admission for truthful Guardian capability projection. */

import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthError } from './types';

describe('Guardian reserved MFA capability admission', () => {
  for (const flag of ['rememberDevice', 'recoveryCodes'] as const) {
    test(`${flag} rejects true with a stable configuration error`, () => {
      let failure: unknown;
      try { resolveAuthBehaviorConfig({ mfa: { enabled: true, [flag]: true } }); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AuthError);
      expect(failure).toMatchObject({ code: 'AUTH_CONFIG_UNSUPPORTED_FEATURE', status: 422 });
    });
  }

  test('false/default reserved flags preserve the existing supported MFA configuration', () => {
    expect(resolveAuthBehaviorConfig().mfa).toMatchObject({ rememberDevice: false, recoveryCodes: false });
    expect(resolveAuthBehaviorConfig({ mfa: { enabled: true, methods: ['totp'], rememberDevice: false, recoveryCodes: false } }).mfa)
      .toMatchObject({ enabled: true, methods: ['totp'], rememberDevice: false, recoveryCodes: false });
  });
});

describe('Administration Organization API-key role eligibility', () => {
  test('declared administration-only roles may be selected by the global eligibility policy', () => {
    const config = resolveAuthBehaviorConfig({
      tenancy: 'multi', authorization: 'advanced',
      apiKeys: { enabled: true, selfService: true, eligibleScopeRoles: ['administrator'] },
    });
    expect(config.apiKeys.eligibleScopeRoles).toEqual(['administrator']);
  });

  test('unknown roles are still rejected', () => {
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'multi', authorization: 'advanced',
      apiKeys: { enabled: true, eligibleScopeRoles: ['unknown'] },
    })).toThrow('eligible scope role is not declared');
  });
});
