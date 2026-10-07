import { afterEach, expect, test } from 'bun:test';
import { AuthClient } from './auth-client';
import { AuthUserContactTransport } from './auth-user-contact-transport';
import { isUserContactCapabilities, isUserContactSnapshot } from './auth-user-contact-parser';
import type { UserContactSnapshot } from '../../auth/auth-user-contact-types';

const originalFetch = globalThis.fetch, clients: AuthClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); globalThis.fetch = originalFetch; });
function snapshot(): UserContactSnapshot {
  return { userId: 'a', revision: 1, email: { value: 'a@example.test', state: 'unverified', verifiedAt: null,
    pendingValue: null, challengeId: null, expiresAt: null }, phone: { value: null, state: 'absent', verifiedAt: null,
      pendingValue: null, challengeId: null, expiresAt: null }, capabilities: { state: 'ready', verificationPath: '/verify-contact',
      email: { readable: true, verifyReady: true, changeReady: true }, phone: { readable: true, enabled: true, editable: true, verifyReady: true } } };
}
test('contact response admits native redaction and proof provenance, not malformed capabilities or invented proof', () => {
  const value = snapshot(); expect(isUserContactSnapshot(value)).toBe(true);
  expect(isUserContactSnapshot({ ...value, email: { ...value.email, state: 'possession-verified' } })).toBe(false);
  expect(isUserContactSnapshot({ ...value, phone: { ...value.phone, value: '+', state: 'unverified' } })).toBe(false);
  expect(isUserContactCapabilities({ ...value.capabilities, verificationPath: '//evil.test/proof' })).toBe(false);
  expect(isUserContactCapabilities({ ...value.capabilities, state: 'disabled' })).toBe(false);
  value.email = null; value.capabilities.email = { readable: false, verifyReady: false, changeReady: false };
  expect(isUserContactSnapshot(value)).toBe(true);
  value.phone = { value: '+12025550123', state: 'administratively-attested', verifiedAt: 1, pendingValue: null, challengeId: null, expiresAt: null };
  expect(isUserContactSnapshot(value)).toBe(false);
});
test('contact transport uses exact public routes, independent revision, AbortSignal and no-store authenticated fetch', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [], signal = new AbortController().signal;
  let fences = 0;
  const api = new AuthUserContactTransport({ baseUrl: 'http://contact.test', authenticatedFetch: async (url, init) => {
    calls.push({ url, init }); return Response.json(snapshot()); }, assertResponseCurrent() { fences++; },
    runEmailCompletion: request => request(signal) });
  await api.get(signal); await api.setPhone({ expectedRevision: 1, phone: '+12025550123' }, signal);
  await api.requestEmailVerification({ expectedRevision: 2 }, signal);
  await api.requestEmailChange({ expectedRevision: 3, email: 'new@example.test', currentPassword: 'synthetic-password' }, signal);
  await api.requestPhoneVerification({ expectedRevision: 4 }, signal);
  await api.completePhone({ expectedRevision: 5, challengeId: 'challenge', code: 'synthetic-code' }, signal);
  await api.cancelChallenge({ expectedRevision: 6, challengeId: 'challenge' }, signal);
  expect(calls.map(call => call.url)).toEqual(['', '/phone', '/email/verify', '/email/change', '/phone/verify', '/phone/complete', '/challenge']
    .map(path => `http://contact.test/auth/profile/contacts${path}`));
  expect(calls.every(call => call.init?.signal instanceof AbortSignal && !call.init.signal.aborted && call.init.cache === 'no-store')).toBe(true);
  expect(calls[6]!.init?.method).toBe('DELETE'); expect(fences).toBe(7);
  expect(JSON.parse(String(calls[3]!.init?.body))).toEqual({ expectedRevision: 3, email: 'new@example.test', currentPassword: 'synthetic-password' });
});
test('malformed, denied or retired contact responses cannot become successful acknowledgments', async () => {
  const make = (response: Response, fence = () => {}) => new AuthUserContactTransport({ baseUrl: '',
    authenticatedFetch: async () => response, assertResponseCurrent: fence,
    runEmailCompletion: request => request(new AbortController().signal) });
  await expect(make(Response.json({ userId: 'a' })).get()).rejects.toMatchObject({ code: 'AUTH_CONTACT_RESPONSE_INVALID' });
  await expect(make(Response.json({ code: 'AUTH_CONTACT_REVISION_CONFLICT' }, { status: 409 })).get()).rejects.toMatchObject({ code: 'AUTH_CONTACT_REVISION_CONFLICT', status: 409 });
  await expect(make(Response.json(snapshot()), () => { throw new DOMException('Retired', 'AbortError'); }).get()).rejects.toThrow('Retired');
});
function user(userId: string) {
  return { userId, username: userId, email: `${userId}@example.test`, firstName: null, lastName: null,
    role: 'member', status: 'active', passwordChangeRequired: false, emailVerifiedAt: null,
    emailVerificationRequired: false, mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null };
}
function mock(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(responder(String(input), init))) as typeof fetch;
}
for (const signedIn of ['a', 'b', null]) test(`email completion retires only proved owner (${signedIn ?? 'anonymous'})`, async () => {
  let logouts = 0;
  mock((url, init) => {
    if (url.endsWith('/auth/login')) return Response.json({ user: user(signedIn!), accessToken: `${signedIn}-access`, refreshToken: `${signedIn}-refresh` });
    if (url.endsWith('/email/complete')) {
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      return Response.json({ verified: true, userId: 'a', requiresSignIn: true });
    }
    if (url.endsWith('/auth/logout')) { logouts++; return Response.json({ ok: true }); }
    return Response.json({ ok: true });
  });
  const client = new AuthClient(`http://contact-${signedIn ?? 'anonymous'}.test`); clients.push(client);
  if (signedIn) await client.login(signedIn, 'synthetic-password');
  expect(await client.contacts.completeEmail('synthetic-one-time-proof')).toEqual({ verified: true, userId: 'a', requiresSignIn: true });
  expect(logouts).toBe(signedIn === 'a' ? 1 : 0);
  expect(client.user?.userId ?? null).toBe(signedIn === 'a' ? null : signedIn);
});
test('late email completion after account replacement cannot retire the new family', async () => {
  let resolve!: (value: Response) => void, logouts = 0;
  const response = new Promise<Response>(yes => { resolve = yes; });
  mock((url, init) => {
    if (url.endsWith('/auth/login')) { const { username } = JSON.parse(String(init?.body));
      return Response.json({ user: user(username), accessToken: `${username}-access`, refreshToken: `${username}-refresh` }); }
    if (url.endsWith('/email/complete')) return response;
    if (url.endsWith('/auth/logout')) logouts++;
    return Response.json({ ok: true });
  });
  const client = new AuthClient('http://contact-late.test'); clients.push(client); await client.login('a', 'synthetic-password');
  const completing = client.contacts.completeEmail('synthetic-one-time-proof').catch(cause => cause);
  await Promise.resolve(); await client.login('b', 'synthetic-password');
  resolve(Response.json({ verified: true, userId: 'a', requiresSignIn: true }));
  expect(await completing).toBeInstanceOf(Error); expect(logouts).toBe(0); expect(client.user?.userId).toBe('b');
});
test('caller cancellation cannot turn a late email receipt into a session-retiring completion', async () => {
  let resolve!: (value: Response) => void, logouts = 0;
  const response = new Promise<Response>(yes => { resolve = yes; });
  mock(url => {
    if (url.endsWith('/auth/login')) return Response.json({ user: user('a'), accessToken: 'a-access', refreshToken: 'a-refresh' });
    if (url.endsWith('/email/complete')) return response;
    if (url.endsWith('/auth/logout')) logouts++;
    return Response.json({ ok: true });
  });
  const client = new AuthClient('http://contact-cancel.test'); clients.push(client); await client.login('a', 'synthetic-password');
  const controller = new AbortController(), completing = client.contacts.completeEmail('synthetic-proof', controller.signal).catch(cause => cause);
  controller.abort(); resolve(Response.json({ verified: true, userId: 'a', requiresSignIn: true }));
  expect(await completing).toBeInstanceOf(Error); expect(logouts).toBe(0); expect(client.user?.userId).toBe('a');
});
test('the contact deadline covers an uncooperative response body without accepting its late values', async () => {
  let resolve!: (value: unknown) => void, fences = 0;
  const body = new Promise(yes => { resolve = yes; });
  const api = new AuthUserContactTransport({ baseUrl: '', requestTimeoutMs: 5,
    authenticatedFetch: async () => ({ ok: true, json: () => body }) as unknown as Response,
    assertResponseCurrent() { fences++; }, runEmailCompletion: request => request(new AbortController().signal) });
  await expect(api.get()).rejects.toMatchObject({ name: 'TimeoutError' });
  resolve(snapshot()); await Promise.resolve(); expect(fences).toBe(0);
});
