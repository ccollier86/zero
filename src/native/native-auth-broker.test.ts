import { expect, test } from 'bun:test';
import { FakeNativeClient } from './broker-test-support';
import { createNativeAuthBroker } from './native-auth-broker';
import { createZeroNativeAuthBroker } from './zero-native-auth-broker';

test('broker single-flights initialization and refresh for every caller', async () => {
  const fake = new FakeNativeClient();
  const broker = createNativeAuthBroker(fake);

  await Promise.all([broker.initialize(), broker.initialize(), broker.initialize()]);
  await Promise.all([broker.refresh(), broker.refresh(), broker.refresh()]);

  expect(fake.initializeCalls).toBe(1);
  expect(fake.refreshCalls).toBe(1);
});

test('broker holds later credential reads behind an in-flight sign-out', async () => {
  const fake = new FakeNativeClient();
  fake.authenticate();
  let release!: () => void;
  let started!: () => void;
  const signOutStarted = new Promise<void>((resolve) => { started = resolve; });
  const signOutRelease = new Promise<void>((resolve) => { release = resolve; });
  const originalSignOut = fake.signOut.bind(fake);
  fake.signOut = async () => { started(); await signOutRelease; await originalSignOut(); };
  const broker = createNativeAuthBroker(fake);

  const signOut = broker.signOut();
  await signOutStarted;
  const accessToken = broker.getAccessToken();
  release();

  await signOut;
  expect(await accessToken).toBeNull();
});

test('process registry reuses one namespace and rejects conflicting configuration', () => {
  const namespace = `broker-test-${crypto.randomUUID()}`;
  const base = {
    serverUrl: 'https://app.example.test', clientId: 'desktop', storageNamespace: namespace,
    secureStorage: { get: async () => null, set: async () => {}, delete: async () => {} },
    browser: { open: async () => {} },
    callback: { prepare: async () => ({
      redirectUri: 'com.example.app:/callback',
      waitForCallback: async () => 'com.example.app:/callback', dispose: async () => {},
    }) },
  };
  const first = createZeroNativeAuthBroker(base);
  expect(createZeroNativeAuthBroker(base)).toBe(first);
  expect(createZeroNativeAuthBroker({
    ...base,
    scopes: ['email', 'openid', 'profile'],
    authorizationTimeoutMs: 900_000,
    networkTimeoutMs: 15_000,
    clockSkewSeconds: 30,
  })).toBe(first);
  expect(() => createZeroNativeAuthBroker({ ...base, clientId: 'other' }))
    .toThrow('already owns this storageNamespace');
  expect(() => createZeroNativeAuthBroker({ ...base, authorizationTimeoutMs: 0 }))
    .toThrow('authorizationTimeoutMs must be positive');
});
