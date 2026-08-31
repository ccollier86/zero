import { describe, expect, test } from 'bun:test';
import { NativeAuthError } from './errors';
import { createNativeTestHarness } from './test-support';
import { createAuthenticatedFetch } from './authenticated-fetch';

describe('native authenticated fetch', () => {
  test('serializes refresh rotation across concurrent 401 retries', async () => {
    const harness = await createNativeTestHarness(true);
    await harness.auth.signIn();

    const [first, second] = await Promise.all([
      harness.auth.fetch('/api/private'),
      harness.auth.fetch('/api/private'),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(harness.refreshCalls()).toBe(1);
    expect(harness.resourceCalls()).toBe(4);
    expect(await first.json()).toEqual({ authorization: 'Bearer access-rotated' });
  });

  test('refuses to attach a bearer token to another origin', async () => {
    const harness = await createNativeTestHarness();
    await harness.auth.signIn();

    try {
      await harness.auth.fetch('https://attacker.example/private');
      throw new Error('expected origin rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeAuthError);
      expect((error as NativeAuthError).code).toBe('NATIVE_REQUEST_ORIGIN_MISMATCH');
    }
  });

  test('sends Bearer with manual redirects and no ambient credentials', async () => {
    let sentInit: RequestInit | undefined;
    const request = createAuthenticatedFetch(
      'https://zero.example/auth',
      async (input, init) => {
        sentInit = init;
        return new Response(null, { status: 200 });
      },
      {
        async accessToken() { return 'access'; },
        async refreshAfterUnauthorized() { return null; },
      },
    );
    await request(new Request('https://zero.example/api/private', {
      credentials: 'include', redirect: 'follow',
    }));
    expect(new Headers(sentInit?.headers).get('Authorization')).toBe('Bearer access');
    expect(sentInit?.credentials).toBe('omit');
    expect(sentInit?.redirect).toBe('manual');
  });

  test('clears the session when the provider violates refresh rotation', async () => {
    const harness = await createNativeTestHarness(true, true);
    await harness.auth.signIn();
    try {
      await harness.auth.fetch('/api/private');
      throw new Error('expected rotation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeAuthError);
      expect((error as NativeAuthError).code).toBe('OIDC_REFRESH_ROTATION_MISSING');
    }
    expect(harness.auth.state.status).toBe('error');
    expect(harness.vault.size).toBe(0);
  });

  test('retains the refresh session across a transient provider outage', async () => {
    const harness = await createNativeTestHarness(false, false, 503);
    await harness.auth.signIn();
    await harness.auth.refresh().catch(() => undefined);
    expect(harness.auth.state.status).toBe('error');
    expect([...harness.vault.values()].join()).toContain('refresh-initial');
  });
});
