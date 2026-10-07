import { expect, test } from 'bun:test';
import { normalizeAuthUserProfile } from '../../auth/auth-config-user-profile';
import type { UserProfileSnapshot } from '../../auth/auth-user-profile-types';
import { isUserProfileCapabilities, isUserProfileSnapshot } from './auth-user-profile-parser';
import { AuthUserProfileTransport } from './auth-user-profile-transport';

function snapshot(): UserProfileSnapshot {
  const config = normalizeAuthUserProfile({ regional: true });
  return { userId: 'self', revision: 1, email: 'self@example.test', values: { username: 'self', firstName: null,
    lastName: null, preferredName: null, bio: null, website: null, socialLinks: [],
    regional: { locale: null, timeZone: null, timeFormat: null, weekStartsOn: null } },
    capabilities: { state: 'ready', usernameMode: config.usernameMode, fields: config.fields,
      regional: { ...config.regional, editable: true } } };
}
test('profile response admission accepts null native email and read-only required fields', () => {
  const value = snapshot(); value.email = null;
  value.capabilities.fields = { ...value.capabilities.fields, firstName: { enabled: true, editable: false, required: true } };
  value.capabilities.regional.editable = false;
  expect(isUserProfileSnapshot(value)).toBe(true);
  expect(isUserProfileCapabilities(value.capabilities)).toBe(true);
  expect(isUserProfileSnapshot({ ...value, revision: 0 })).toBe(false);
  expect(isUserProfileSnapshot({ ...value, values: { ...value.values, regional: { locale: 'bad_locale' } } })).toBe(false);
  expect(isUserProfileCapabilities({ ...value.capabilities, regional: { ...value.capabilities.regional, fields: ['locale', 'locale'] } })).toBe(false);
});
test('profile capability enum admission does not coerce arrays into supported strings', () => {
  const value = snapshot();
  for (const state of [['ready'], ['blocked'], ['disabled'], { toString: () => 'ready' }]) {
    expect(isUserProfileCapabilities({ ...value.capabilities, state })).toBe(false);
  }
  for (const usernameMode of [['email'], ['separate'], { toString: () => 'separate' }]) {
    expect(isUserProfileCapabilities({ ...value.capabilities, usernameMode })).toBe(false);
  }
});
test('profile transport uses existing authenticated fetch and returns canonical acknowledged values', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [], value = snapshot(); let guards = 0;
  const transport = new AuthUserProfileTransport({ baseUrl: 'https://example.test',
    async authenticatedFetch(url, init) { calls.push({ url, init }); return Response.json(value); },
    assertResponseCurrent() { ++guards; } });
  expect(await transport.get()).toEqual(value);
  const signal = new AbortController().signal;
  expect(await transport.update({ expectedRevision: 1, changes: { firstName: 'Jane' } }, signal)).toEqual(value);
  expect(calls.map(call => call.url)).toEqual(['https://example.test/auth/profile', 'https://example.test/auth/profile']);
  expect(calls[1]?.init?.signal).toBeInstanceOf(AbortSignal);
  expect(calls[1]?.init?.cache).toBe('no-store');
  expect(calls[1]?.init?.method).toBe('PATCH');
  expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ expectedRevision: 1, changes: { firstName: 'Jane' } });
  expect(guards).toBe(2);
});
test('invalid, conflicting and retired responses never become a successful acknowledgment', async () => {
  const transport = (response: Response, assertResponseCurrent = () => {}) => new AuthUserProfileTransport({
    baseUrl: '', async authenticatedFetch() { return response; }, assertResponseCurrent });
  await expect(transport(Response.json({ revision: 2 })).get()).rejects.toMatchObject({ code: 'AUTH_PROFILE_RESPONSE_INVALID' });
  await expect(transport(Response.json({ code: 'AUTH_PROFILE_REVISION_CONFLICT', error: 'Changed' }, { status: 409 })).get())
    .rejects.toMatchObject({ code: 'AUTH_PROFILE_REVISION_CONFLICT', status: 409 });
  await expect(transport(Response.json(snapshot()), () => { throw new DOMException('Retired', 'AbortError'); }).get()).rejects.toThrow('Retired');
});
for (const phase of ['fetch', 'body'] as const) test(`profile PATCH ${phase} deadline settles without admitting a late successful write`, async () => {
  let resolve!: (value: unknown) => void, guards = 0;
  const pending = new Promise(yes => { resolve = yes; });
  const transport = new AuthUserProfileTransport({ baseUrl: '', requestTimeoutMs: 5,
    async authenticatedFetch() { return phase === 'fetch' ? pending as Promise<Response>
      : { ok: true, status: 200, json: () => pending } as Response; },
    assertResponseCurrent() { guards++; } });
  await expect(transport.update({ expectedRevision: 1, changes: { firstName: 'Pending draft' } })).rejects.toMatchObject({ name: 'TimeoutError' });
  resolve(phase === 'fetch' ? Response.json(snapshot()) : snapshot()); await new Promise(yes => setTimeout(yes, 0));
  expect(guards).toBe(0);
});
test('profile caller cancellation aborts the bounded request and cannot become a successful baseline', async () => {
  let requestSignal: AbortSignal | null = null;
  const controller = new AbortController(), transport = new AuthUserProfileTransport({ baseUrl: '',
    authenticatedFetch: (_url, init) => { requestSignal = init!.signal as AbortSignal; return new Promise(() => {}); },
    assertResponseCurrent() { throw new Error('A cancelled request must not reach acknowledgment.'); } });
  const saving = transport.update({ expectedRevision: 1, changes: { firstName: 'Pending draft' } }, controller.signal);
  await Promise.resolve(); controller.abort(); await expect(saving).rejects.toMatchObject({ name: 'AbortError' });
  expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
});
