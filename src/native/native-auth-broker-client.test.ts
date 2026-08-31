import { expect, test } from 'bun:test';
import { FakeNativeClient } from './broker-test-support';
import type { NativeAuthBrokerStateListener, NativeAuthBrokerTransport } from './broker-types';
import { createNativeAuthBrokerClient } from './native-auth-broker-client';
import { createNativeAuthBroker } from './native-auth-broker';

test('multiple broker clients share state, refresh, and sign-out without vault ownership', async () => {
  const owner = new FakeNativeClient();
  const broker = createNativeAuthBroker(owner);
  const first = createProxy(broker);
  const second = createProxy(broker);
  const observed: string[] = [];
  first.subscribe((state) => observed.push(state.status));

  await Promise.all([first.initialize(), second.initialize()]);
  expect(owner.initializeCalls).toBe(1);
  expect(second.state.identity?.sub).toBe('user-1');
  expect(observed).toEqual(['authenticated']);

  await Promise.all([first.refresh(), second.refresh()]);
  expect(owner.refreshCalls).toBe(1);
  expect(await first.getAccessToken()).toBe('access-two');

  await second.signOut();
  expect(first.state.status).toBe('anonymous');
  expect(await first.getAccessToken()).toBeNull();
  first.dispose();
  second.dispose();
});

test('broker client retries one authenticated request after broker-owned refresh', async () => {
  const owner = new FakeNativeClient();
  owner.authenticate();
  const seen: string[] = [];
  const proxy = createNativeAuthBrokerClient({
    transport: createNativeAuthBroker(owner), serverUrl: 'https://app.example.test',
    fetch: async (_input, init) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(null, { status: seen.length === 1 ? 401 : 200 });
    },
  });

  expect(proxy.state.status).toBe('authenticated');
  const response = await proxy.fetch('/api/account');
  expect(response.status).toBe(200);
  expect(seen).toEqual(['Bearer access-one', 'Bearer access-two']);
  proxy.dispose();
});

test('broker client preserves safe structured operation errors', async () => {
  const proxy = createProxy(createNativeAuthBroker(new FakeNativeClient()));
  await expect(proxy.signUp()).rejects.toMatchObject({ code: 'REGISTRATION_BLOCKED', status: 403 });
  proxy.dispose();
});

test('stale IPC responses cannot restore state or release a pre-sign-out access token', async () => {
  const owner = new FakeNativeClient();
  owner.authenticate();
  const broker = createNativeAuthBroker(owner);
  let release!: () => void;
  let captured!: () => void;
  const responseCaptured = new Promise<void>((resolve) => { captured = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  const transport = {
    subscribeState: broker.subscribeState,
    async request(...args: Parameters<typeof broker.request>) {
      const response = await broker.request(...args);
      if (args[0].operation === 'getAccessToken') {
        captured();
        await responseRelease;
      }
      return response;
    },
  };
  const proxy = createProxy(transport);

  const pendingToken = proxy.getAccessToken();
  await responseCaptured;
  await owner.signOut();
  release();

  expect(await pendingToken).toBeNull();
  expect(proxy.state.status).toBe('anonymous');
  proxy.dispose();
});

test('out-of-order broker state events cannot roll a proxy back', () => {
  let publish!: NativeAuthBrokerStateListener;
  const transport: NativeAuthBrokerTransport = {
    request: async () => { throw new Error('not used'); },
    subscribeState(listener) { publish = listener; return () => {}; },
  };
  const proxy = createNativeAuthBrokerClient({
    transport, serverUrl: 'https://app.example.test',
  });
  publish({
    revision: 2,
    state: { status: 'anonymous', identity: null, error: null },
  });
  publish({
    revision: 1,
    state: {
      status: 'authenticated', error: null,
      identity: { sub: 'user-1', iss: 'https://app.example.test/auth',
        aud: 'desktop', exp: 9999999999, iat: 1 },
    },
  });
  expect(proxy.state.status).toBe('anonymous');
  proxy.dispose();
});

test('broker client rejects insecure or mismatched issuer configuration', async () => {
  const owner = new FakeNativeClient();
  owner.authenticate();
  const broker = createNativeAuthBroker(owner);
  expect(() => createNativeAuthBrokerClient({
    transport: broker, serverUrl: 'http://app.example.test',
  })).toThrow('serverUrl must be');

  const mismatched = createNativeAuthBrokerClient({
    transport: broker, serverUrl: 'https://other.example.test',
  });
  expect(mismatched.state).toMatchObject({
    status: 'error', identity: null,
    error: { code: 'NATIVE_BROKER_ISSUER_MISMATCH' },
  });
  await expect(mismatched.getAccessToken()).rejects.toMatchObject({
    code: 'NATIVE_BROKER_ISSUER_MISMATCH',
  });
  mismatched.dispose();
});

const createProxy = (transport: NativeAuthBrokerTransport) =>
  createNativeAuthBrokerClient({ transport, serverUrl: 'https://app.example.test' });
