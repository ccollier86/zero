import { describe, expect, test } from 'bun:test';
import { NativeAuthError } from './errors';
import { createNativeTestHarness } from './test-support';

describe('native session lifecycle', () => {
  test('cold explicit refresh rotates exactly once', async () => {
    const harness = await createNativeTestHarness();
    await harness.auth.signIn();
    const coldClient = harness.createClient();

    await coldClient.refresh();

    expect(harness.refreshCalls()).toBe(1);
    expect(coldClient.state.status).toBe('authenticated');
  });

  test('repeated sign-in revokes the previously persisted family', async () => {
    const harness = await createNativeTestHarness();
    await harness.auth.signIn();
    await harness.auth.signIn();
    await waitUntil(() => harness.revokedTokens.includes('refresh-initial'));

    expect([...harness.vault.values()].join()).toContain('refresh-initial-2');
  });

  test("shared-vault refresh loser cannot erase the winner's local vault write", async () => {
    const harness = await createNativeTestHarness();
    await harness.auth.signIn();
    harness.setEnforceSingleUse(true);
    const first = harness.createClient();
    const second = harness.createClient();

    const results = await Promise.allSettled([first.initialize(), second.initialize()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect([...harness.vault.values()].join()).toContain('refresh-rotated');
  });

  test.each([
    ['invalid refreshed ID token', (h: Harness) => h.setInvalidRefreshIdToken(true)],
    ['missing refreshed ID token', (h: Harness) => h.setOmitRefreshIdToken(true)],
    ['vault save failure', (h: Harness) => h.setFailSessionWrites(true)],
  ])('revokes a replacement after %s', async (_name, arrange) => {
    const harness = await createNativeTestHarness();
    await harness.auth.signIn();
    arrange(harness);

    await expectNativeError(harness.auth.refresh());
    await waitUntil(() => harness.revokedTokens.includes('refresh-rotated'));

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
