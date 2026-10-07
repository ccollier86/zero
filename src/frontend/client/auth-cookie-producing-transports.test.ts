/** Qualifies cookie-producing transport participation in the core-owned issuance exchange. */
import { afterEach, expect, test } from 'bun:test';
import type { AuthAuthenticationAttempt } from './auth-authentication-attempt';
import type { AuthCompletionResult } from './auth-types';
import { AuthMfaTransport } from './auth-mfa-transport';
import { AuthTenantOnboardingTransport } from './auth-tenant-onboarding-transport';
import { AuthUserProfileCompletionTransport } from './auth-user-profile-completion-transport';
import { completionUser, profileCompletionResult } from './auth-user-profile-completion.test-fixtures';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const method = { methodId: 'method-1', type: 'totp', label: 'Authenticator', status: 'active',
  isPrimary: true, createdAt: 1, verifiedAt: 1, lastUsedAt: null };
const completion = { user: completionUser(), accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' };
type Flow = 'setup' | 'challenge' | 'invitation' | 'profile';

function fixture(flow: Flow, response: () => Response) {
  const events: string[] = [], outer = new AbortController(), owned = new AbortController();
  let release!: () => void, ownedActive = false, calls = 0, completed = 0;
  const admission = new Promise<void>(resolve => { release = resolve; });
  const attempt: AuthAuthenticationAttempt = {
    signal: outer.signal, assertCurrent: () => outer.signal.throwIfAborted(),
    dispose: () => { events.push('dispose'); },
    async runCredentialIssuance(operation) {
      await admission; ownedActive = true; events.push('admit');
      try {
        return await operation({ ...attempt, signal: owned.signal,
          assertCurrent() { outer.signal.throwIfAborted(); owned.signal.throwIfAborted(); } });
      } finally { ownedActive = false; events.push('release'); }
    },
  };
  const send = async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(ownedActive).toBe(true); events.push('http'); calls++;
    // The profile request composes an inner bounded read with the owned
    // signal; the other three transports forward that signal directly.
    if (flow !== 'profile') expect(init?.signal).toBe(owned.signal);
    return response();
  };
  globalThis.fetch = send as typeof fetch;
  const completeAuthentication = async (result: AuthCompletionResult, current: AuthAuthenticationAttempt) => {
    expect(ownedActive).toBe(true); expect(current.signal).toBe(owned.signal);
    current.assertCurrent(); events.push('complete'); completed++; return result;
  };
  const shared = { baseUrl: 'http://zero.test', authenticatedFetch: send,
    optionalAuthenticatedFetch: send, assertResponseCurrent() {}, beginAuthentication: () => attempt,
    failAuthentication() {}, completeAuthentication };
  let start: () => Promise<AuthCompletionResult>;
  if (flow === 'setup' || flow === 'challenge') {
    const transport = new AuthMfaTransport(shared);
    start = flow === 'setup'
      ? () => transport.verifyMfaSetup({ verificationToken: 'one-time-setup', code: '123456' }) as Promise<AuthCompletionResult>
      : () => transport.verifyMfaChallenge({ challengeToken: 'one-time-challenge', code: '123456' });
  } else if (flow === 'invitation') {
    const transport = new AuthTenantOnboardingTransport({ ...shared,
      createResponseError: (_response, _body, fallback) => new Error(fallback) });
    start = () => transport.acceptInvitation({ token: 'one-time-invitation' });
  } else {
    const required = profileCompletionResult();
    const transport = new AuthUserProfileCompletionTransport({ ...shared, readContinuation: () => required });
    start = () => transport.complete({ continuation: required.profileCompletion.continuation,
      expectedRevision: 1, changes: { firstName: 'Retained draft' } });
  }
  return { start, release, events, get calls() { return calls; }, get completed() { return completed; } };
}

function success(flow: Flow): unknown {
  if (flow === 'setup' || flow === 'challenge') return { ...completion, method };
  if (flow === 'invitation') return { ...completion, invitationAccepted: true,
    acceptedTenant: { tenantId: 'tenant-1', membershipId: 'member-1', name: 'Organization', slug: 'organization', kind: 'organization' } };
  return completion;
}

for (const flow of ['setup', 'challenge', 'invitation', 'profile'] as const) {
  test(`${flow} holds the owned exchange from pre-HTTP admission through validated completion`, async () => {
    const current = fixture(flow, () => Response.json(success(flow)));
    const pending = current.start();
    await Promise.resolve(); expect(current.calls).toBe(0); expect(current.completed).toBe(0);
    current.release();
    expect(await pending).toMatchObject(completion);
    expect(current.calls).toBe(1); expect(current.completed).toBe(1);
    expect(current.events).toEqual(['admit', 'http', 'complete', 'release', 'dispose']);
  });

  test(`${flow} rejects invalid one-time completion without replay or committing credentials`, async () => {
    const current = fixture(flow, () => Response.json({ invalid: true }));
    const pending = current.start(); current.release();
    await expect(pending).rejects.toBeDefined();
    expect(current.calls).toBe(1); expect(current.completed).toBe(0);
    expect(current.events).toEqual(['admit', 'http', 'release', 'dispose']);
  });
}

for (const flow of ['challenge', 'invitation'] as const) {
  test(`${flow} settles form loading if owned admission fails before its HTTP callback runs`, async () => {
    const messages: string[] = [];
    let calls = 0, disposed = 0;
    const attempt: AuthAuthenticationAttempt = {
      signal: new AbortController().signal, assertCurrent() {}, dispose() { disposed++; },
      runCredentialIssuance: async () => { throw new DOMException('Admission timed out', 'TimeoutError'); },
    };
    const send = async () => { calls++; return Response.json(success(flow)); };
    const options = { baseUrl: 'http://zero.test', authenticatedFetch: send, optionalAuthenticatedFetch: send,
      assertResponseCurrent() {}, beginAuthentication: () => attempt,
      failAuthentication: (message: string) => { messages.push(message); },
      completeAuthentication: async (result: AuthCompletionResult) => result };
    const pending = flow === 'challenge'
      ? new AuthMfaTransport(options).verifyMfaChallenge({ challengeToken: 'one-time-challenge', code: '123456' })
      : new AuthTenantOnboardingTransport({ ...options,
        createResponseError: (_response, _body, fallback) => new Error(fallback) })
        .acceptInvitation({ token: 'one-time-invitation' });
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(calls).toBe(0); expect(disposed).toBe(1);
    expect(messages).toEqual([flow === 'challenge' ? 'Failed to verify MFA challenge' : 'Failed to accept invitation']);
  });
}

test('profile caller cancellation reaches owned admission before any HTTP or one-time proof consumption', async () => {
  const required = profileCompletionResult(), caller = new AbortController();
  let queued!: () => void, calls = 0, disposed = 0, completed = 0;
  const admitted = new Promise<void>(resolve => { queued = resolve; });
  globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calls++;
    throw new Error('Cancelled admission must not dispatch');
  }) as typeof fetch;
  const attempt: AuthAuthenticationAttempt = {
    signal: new AbortController().signal, assertCurrent() {}, dispose() { disposed++; },
    runCredentialIssuance: async (_operation, signal) => {
      expect(signal).toBe(caller.signal); queued(); signal!.throwIfAborted();
      return new Promise<never>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
    },
  };
  const transport = new AuthUserProfileCompletionTransport({ baseUrl: 'http://zero.test',
    beginAuthentication: () => attempt, readContinuation: () => required,
    completeAuthentication: async result => { completed++; return result; } });
  const pending = transport.complete({ continuation: required.profileCompletion.continuation,
    expectedRevision: 1, changes: { firstName: 'Retained draft' } }, caller.signal);
  const rejected = pending.then(() => { throw new Error('Cancelled profile admission unexpectedly succeeded'); }, cause => cause);
  await admitted;
  caller.abort(new DOMException('Profile form was cancelled', 'AbortError'));
  expect(await rejected).toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(0); expect(completed).toBe(0); expect(disposed).toBe(1);
  expect(required.profileCompletion.continuation).toBe(profileCompletionResult().profileCompletion.continuation);
});
