import { describe, expect, test } from 'bun:test';
import { createZeroNativeAuth } from './zero-native-auth';
import { createNativeTestHarness } from './test-support';

describe('native operation cancellation', () => {
  test('an already-aborted request never invokes a platform callback adapter', async () => {
    const harness = await createNativeTestHarness();
    let prepares = 0;
    const auth = harness.createClient({
      callback: {
        async prepare() { prepares += 1; return neverCallback; },
      },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(auth.signIn({ signal: controller.signal })).rejects.toThrow();

    expect(prepares).toBe(0);
  });

  test('bounds discovery even when fetch ignores AbortSignal', async () => {
    const auth = createZeroNativeAuth({
      serverUrl: 'https://zero.example',
      clientId: 'desktop-test',
      browser: { async open() {} },
      callback: { async prepare() { return neverCallback; } },
      secureStorage: memoryVault(),
      networkTimeoutMs: 10,
      fetch: () => new Promise<Response>(() => undefined),
    });

    const started = Date.now();
    await expect(auth.initialize()).rejects.toThrow('Native authentication failed');
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('bounds callback capture even when the adapter ignores its signal', async () => {
    const harness = await createNativeTestHarness();
    harness.setCallbackGate(new Promise<void>(() => undefined));
    const auth = harness.createClient({ authorizationTimeoutMs: 10 });

    const started = Date.now();
    await expect(auth.signIn()).rejects.toThrow('Native authentication failed');
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('sign-out cancels a hanging browser authorization without resurrection', async () => {
    const harness = await createNativeTestHarness();
    harness.setCallbackGate(new Promise<void>(() => undefined));
    const signingIn = harness.auth.signIn();
    await waitUntil(() => Boolean(harness.authUrl()));

    await harness.auth.signOut();
    await expect(signingIn).rejects.toThrow('superseded');

    expect(harness.auth.state.status).toBe('anonymous');
    expect(harness.vault.size).toBe(0);
  });
});

const neverCallback = {
  redirectUri: 'com.example.desktop:/oauth/callback',
  waitForCallback: () => new Promise<string>(() => undefined),
  async dispose() {},
};

function memoryVault() {
  const values = new Map<string, string>();
  return {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string) { values.set(key, value); },
    async delete(key: string) { values.delete(key); },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('condition was not reached');
}
