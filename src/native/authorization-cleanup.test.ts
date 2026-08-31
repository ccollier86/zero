import { describe, expect, test } from 'bun:test';
import { NativeAuthError } from './errors';
import { createNativeTestHarness } from './test-support';

describe('native authorization cleanup', () => {
  test.each([
    ['invalid ID token', (h: Harness) => h.setInvalidAuthorizationIdToken(true)],
    ['vault save failure', (h: Harness) => h.setFailSessionWrites(true)],
  ])('revokes an issued family after %s', async (_name, arrange) => {
    const harness = await createNativeTestHarness();
    arrange(harness);

    await expectNativeError(harness.auth.signIn());
    await waitUntil(() => harness.revokedTokens.includes('refresh-initial'));

    expect(harness.auth.state.status).toBe('error');
    expect(harness.vault.size).toBe(0);
  });
});

type Harness = Awaited<ReturnType<typeof createNativeTestHarness>>;

async function expectNativeError(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error('expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(NativeAuthError);
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('condition was not reached');
}
