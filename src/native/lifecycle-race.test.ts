import { describe, expect, test } from 'bun:test';
import { NativeAuthError } from './errors';
import { createNativeTestHarness } from './test-support';

describe('native auth lifecycle races', () => {
  test('sign-out supersedes sign-in even before runtime discovery finishes', async () => {
    const harness = await createNativeTestHarness();
    const signIn = harness.auth.signIn();
    await harness.auth.signOut();

    await expectCode(signIn, 'NATIVE_OPERATION_SUPERSEDED');
    expect(harness.authUrl()).toBe('');
    expect(harness.auth.state.status).toBe('anonymous');
  });

  test('sign-out wins over a rotated refresh response already in flight', async () => {
    const harness = await createNativeTestHarness();
    await harness.auth.signIn();
    const gate = deferred();
    harness.setRefreshGate(gate.promise);
    const refresh = harness.auth.refresh();
    await waitUntil(() => harness.refreshCalls() === 1);

    await harness.auth.signOut();
    gate.resolve();
    await expectCode(refresh, 'NATIVE_OPERATION_SUPERSEDED');
    await waitUntil(() => harness.revokedTokens.includes('refresh-rotated'));

    expect(harness.auth.state.status).toBe('anonymous');
    expect(harness.vault.size).toBe(0);
  });

  test('begin and cold-start completion share one callback exchange', async () => {
    const harness = await createNativeTestHarness();
    const gate = deferred();
    harness.setCallbackGate(gate.promise);
    const signIn = harness.auth.signIn();
    await waitUntil(() => Boolean(harness.authUrl()));
    const callback = callbackUrl(harness.authUrl());

    await harness.auth.completeAuthorization(callback);
    gate.resolve();
    await signIn;

    expect(harness.tokenBodies.filter((body) => body.get('code'))).toHaveLength(1);
    expect(harness.auth.state.status).toBe('authenticated');
  });

  test('one throwing state subscriber cannot corrupt auth or block others', async () => {
    const harness = await createNativeTestHarness();
    const observed: string[] = [];
    harness.auth.subscribe(() => { throw new Error('observer failure'); });
    harness.auth.subscribe((state) => observed.push(state.status));

    await harness.auth.signIn();

    expect(harness.auth.state.status).toBe('authenticated');
    expect(observed).toContain('authenticated');
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function callbackUrl(authorizationUrl: string): string {
  const authorization = new URL(authorizationUrl);
  const callback = new URL('com.example.desktop:/oauth/callback');
  callback.searchParams.set('code', 'one-time-code');
  callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
  callback.searchParams.set('iss', 'https://zero.example/auth');
  return callback.href;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('condition was not reached');
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(NativeAuthError);
    expect((error as NativeAuthError).code).toBe(code);
  }
}
