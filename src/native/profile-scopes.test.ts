import { describe, expect, test } from 'bun:test';
import { createNativeTestHarness } from './test-support';
import type { NativeIdentityScope } from './client-types';

describe('explicit native own-account scopes', () => {
  test('default native authorization does not acquire phone or writer ceilings', async () => {
    const h = await createNativeTestHarness();
    await h.auth.signIn();
    expect(new URL(h.authUrl()).searchParams.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
  });
  test('explicitly requested identity and writer ceilings reach the actual authorization URL', async () => {
    const h = await createNativeTestHarness();
    const scopes: NativeIdentityScope[] = ['profile', 'email', 'phone', 'profile:write', 'contacts:write'];
    const client = h.createClient({ scopes });
    await client.signIn();
    expect(new URL(h.authUrl()).searchParams.get('scope')?.split(' ').sort())
      .toEqual(['contacts:write', 'email', 'openid', 'phone', 'profile', 'profile:write']);
    expect(h.tokenBodies.at(-1)?.get('scope')).toBeNull();
  });
  test('an app permission cannot be passed as a native identity scope', async () => {
    const h = await createNativeTestHarness();
    expect(() => h.createClient({ scopes: ['application.manage' as NativeIdentityScope] })).toThrow('Only declared Zero identity and own-account scopes');
  });
});
