import { describe, expect, test } from 'bun:test';
import { NativeAuthError } from './errors';
import { createNativeTestHarness } from './test-support';

describe('native authorization callback concurrency', () => {
  test('a different callback cannot clobber a successful completion', async () => {
    const harness = await createNativeTestHarness();
    const gate = deferred();
    harness.setCallbackGate(gate.promise);
    const signIn = harness.auth.signIn();
    await waitUntil(() => Boolean(harness.authUrl()));
    const callback = callbackUrl(harness.authUrl());
    const different = withParameter(callback, 'code', 'different-code');

    await Promise.all([
      harness.auth.completeAuthorization(callback),
      harness.auth.completeAuthorization(different),
    ]);
    await harness.auth.completeAuthorization(
      withParameter(callback, 'code', 'late-code'),
    );
    gate.resolve();
    await signIn;

    expect(codeExchanges(harness.tokenBodies)).toHaveLength(1);
    expect(harness.auth.state.status).toBe('authenticated');
  });

  test('a valid callback proceeds after a retryable invalid callback', async () => {
    const harness = await createNativeTestHarness();
    const gate = deferred();
    harness.setCallbackGate(gate.promise);
    const signIn = harness.auth.signIn();
    await waitUntil(() => Boolean(harness.authUrl()));
    const callback = callbackUrl(harness.authUrl());
    const invalid = withParameter(callback, 'state', 'wrong-state');

    const invalidResult = expectCode(
      harness.auth.completeAuthorization(invalid), 'OIDC_STATE_MISMATCH',
    );
    const validResult = harness.auth.completeAuthorization(callback);
    await invalidResult;
    await validResult;
    gate.resolve();
    await signIn;

    expect(codeExchanges(harness.tokenBodies)).toHaveLength(1);
    expect(harness.auth.state.status).toBe('authenticated');
  });
});

const codeExchanges = (bodies: URLSearchParams[]) => (
  bodies.filter((body) => body.has('code'))
);
function withParameter(url: string, key: string, value: string): string {
  const changed = new URL(url);
  changed.searchParams.set(key, value);
  return changed.href;
}
function callbackUrl(authorizationUrl: string): string {
  const authorization = new URL(authorizationUrl);
  const callback = new URL('com.example.desktop:/oauth/callback');
  callback.searchParams.set('code', 'one-time-code');
  callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
  callback.searchParams.set('iss', 'https://zero.example/auth');
  return callback.href;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
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
