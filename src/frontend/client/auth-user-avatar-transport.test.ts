/** Own-avatar SDK admission, staged storage, identity replacement and private image-body boundaries. */
import { afterEach, expect, test } from 'bun:test';
import { AuthClient } from './auth-client';
import { AuthUserAvatarTransport, type UserAvatarRequestScope } from './auth-user-avatar-transport';
import { isUserAvatarAsset, isUserAvatarCapabilities, isUserAvatarSnapshot, isUserAvatarStage, isUserPublicAvatarAsset } from './auth-user-avatar-parser';
import type { UserAvatarAsset, UserAvatarSnapshot, UserAvatarStage } from '../../auth/auth-user-avatar-types';
import { normalizeAuthUserAvatar } from '../../auth/auth-config-user-avatar';
import { configureFrontendObservability, type FrontendObservabilityEvent } from './observability';
const originalFetch = globalThis.fetch, clients: AuthClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); globalThis.fetch = originalFetch;
  configureFrontendObservability({ console: false, http: false }); });
const uuid = '00000000-0000-0000-0000-000000000000';
function snapshot(): UserAvatarSnapshot { return { userId: 'a', revision: 2, asset: null,
  capabilities: { ...normalizeAuthUserAvatar(true), state: 'ready' } }; }
function stage(): UserAvatarStage { return { id: `avs_${uuid}`, receipt: 'a'.repeat(64), expectedRevision: 1, expiresAt: Date.now() + 900_000,
  upload: { token: 'signed-grant', grantId: `sug_${uuid}`, driveId: `drv_${uuid}`, path: `/avatars/stages/avs_${uuid}`,
    expiresIn: 900, expiresAt: Date.now() + 900_000, maxSize: 8 * 1024 * 1024, public: false, overwrite: false,
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'], flow: 'guardian-avatar', resource: { type: 'guardian-avatar-stage', id: `avs_${uuid}` } } }; }
function asset(): UserAvatarAsset { return { id: `ava_${uuid}`, width: 512, height: 512, byteLength: 3,
  mimeType: 'image/webp', deliveryPath: `/auth/profile/avatar/assets/ava_${uuid}` }; }
function api(fetcher: AuthUserAvatarTransportOptions['authenticatedFetch'], timeout = 1000) {
  let epoch = 1; const scopes: AbortController[] = [];
  const transport = new AuthUserAvatarTransport({ baseUrl: 'http://avatar.test', authenticatedFetch: fetcher, assertResponseCurrent() {}, requestTimeoutMs: timeout,
    async runScoped<T>(operation: (scope: UserAvatarRequestScope) => Promise<T>, signal?: AbortSignal) {
      const captured = epoch, controller = new AbortController(); scopes.push(controller);
      const cancel = () => controller.abort(signal?.reason); if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
      const assertCurrent = () => { if (epoch !== captured) throw new DOMException('Retired scope', 'AbortError'); controller.signal.throwIfAborted(); };
      try { assertCurrent(); const result = await operation({ userId: 'a', signal: controller.signal, assertCurrent }); assertCurrent(); return result; }
      finally { signal?.removeEventListener('abort', cancel); }
    } });
  return { transport, retire() { epoch++; for (const controller of scopes) controller.abort(); } };
}
test('accepted avatar commands notify other same-client consumers once, never from a stage, upload or read', async () => {
  const owner = api(async url => Response.json(url.endsWith('/stages') ? stage()
    : url.includes('/upload-grants/') ? { uploaded: true } : snapshot()));
  const first: UserAvatarSnapshot[] = [], second: UserAvatarSnapshot[] = [];
  const unsubscribe = owner.transport.subscribe(value => { first.push(value); value.userId = 'changed-by-observer'; });
  owner.transport.subscribe(value => second.push(value));
  await owner.transport.get();
  const allocated = await owner.transport.stage(1);
  await owner.transport.upload(allocated, new Blob(['image'], { type: 'image/webp' }));
  expect(second).toHaveLength(0);
  expect((await owner.transport.finalize(allocated)).userId).toBe('a');
  await Promise.resolve(); expect(second).toEqual([snapshot()]);
  unsubscribe();
  await owner.transport.replace(new Blob(['image'], { type: 'image/webp' }), 1);
  await owner.transport.remove(2); await owner.transport.publish(2); await owner.transport.withdraw(2);
  await Promise.resolve();
  expect(first).toHaveLength(1); expect(second).toHaveLength(5);
  expect(second.every(value => value.userId === 'a')).toBe(true);
});
test('avatar observers cannot turn an accepted write into a failure, and retiring the scope stops notifications', async () => {
  const owner = api(async () => Response.json(snapshot())), received: UserAvatarSnapshot[] = [];
  owner.transport.subscribe(() => { throw new Error('PRIVATE_AVATAR_SUBSCRIBER_FAILURE'); });
  owner.transport.subscribe(async () => { throw new Error('PRIVATE_ASYNC_AVATAR_SUBSCRIBER_FAILURE'); });
  owner.transport.subscribe(value => received.push(value));
  expect((await owner.transport.remove(1)).revision).toBe(2);
  await Promise.resolve(); expect(received).toEqual([snapshot()]);
  let resolve!: (value: Response) => void, started!: () => void;
  const fetching = new Promise<void>(yes => { started = yes; });
  const late = api(() => new Promise<Response>(yes => { resolve = yes; started(); }));
  late.transport.subscribe(value => received.push(value));
  const pending = late.transport.remove(1).catch(cause => cause);
  await fetching; late.retire(); resolve(Response.json(snapshot()));
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect(received).toHaveLength(1);
});
test('invalid, rejected or unknown avatar mutations never notify a saved picture', async () => {
  for (const response of [Response.json({ ...snapshot(), userId: 'another-account' }),
    Response.json({ code: 'AUTH_PROFILE_REVISION_CONFLICT' }, { status: 409 }),
    Response.json({ code: 'DATABASE_OPERATION_TIMEOUT' }, { status: 503 })]) {
    const owner = api(async () => response), received: UserAvatarSnapshot[] = [];
    owner.transport.subscribe(value => received.push(value));
    await expect(owner.transport.remove(1)).rejects.toBeInstanceOf(Error);
    expect(received).toHaveLength(0);
  }
});
test('observer diagnostics omit private callback text and retire delayed failures with their account', async () => {
  const events: FrontendObservabilityEvent[] = [];
  configureFrontendObservability({ console: false, http: false, sink: { emit(event) { events.push(event); } } });
  const owner = api(async () => Response.json(snapshot()));
  let reject!: (cause: unknown) => void;
  owner.transport.subscribe(() => { throw { code: 'PRIVATE_CALLBACK_TEXT', message: 'PRIVATE_CALLBACK_TEXT' }; });
  owner.transport.subscribe(() => new Promise<void>((_, no) => { reject = no; }));
  expect((await owner.transport.remove(1)).revision).toBe(2);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ code: 'frontend.auth.action_failed', metadata: { action: 'userAvatarSubscriber', code: null } });
  expect(events[0]!.error).toBeUndefined();
  expect(JSON.stringify(events)).not.toContain('PRIVATE_CALLBACK_TEXT');
  owner.retire(); reject(new Error('PRIVATE_RETIRED_CALLBACK_TEXT'));
  await Promise.resolve(); await Promise.resolve();
  expect(events).toHaveLength(1);
});
test('avatar acceptance stays client-local and retirement/unsubscribe fences queued subscribers', async () => {
  const first = api(async () => Response.json(snapshot())), second = api(async () => Response.json(snapshot()));
  let otherClient = 0, removed = 0, retired = 0;
  second.transport.subscribe(() => { otherClient++; });
  const unsubscribe = first.transport.subscribe(() => { removed++; }); unsubscribe();
  first.transport.subscribe(() => first.retire());
  first.transport.subscribe(() => { retired++; });
  expect((await first.transport.remove(1)).revision).toBe(2);
  await Promise.resolve();
  expect({ otherClient, removed, retired }).toEqual({ otherClient: 0, removed: 0, retired: 0 });
});
test('caller cleanup after acceptance does not hide the saved photo from another live consumer', async () => {
  const user = { userId: 'a', username: 'a', email: 'a@example.test', firstName: null, lastName: null,
    role: 'member', status: 'active', passwordChangeRequired: false, emailVerifiedAt: null, emailVerificationRequired: false,
    mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null };
  globalThis.fetch = (async input => String(input).endsWith('/auth/login')
    ? Response.json({ user, accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' })
    : Response.json(snapshot())) as typeof fetch;
  const auth = new AuthClient('http://avatar-consumer.test'); clients.push(auth);
  await auth.login('a', 'synthetic-password');
  const caller = new AbortController(), received: UserAvatarSnapshot[] = [];
  auth.avatars.subscribe(() => caller.abort());
  auth.avatars.subscribe(value => received.push(value));
  expect((await auth.avatars.remove(1, caller.signal)).revision).toBe(2);
  await Promise.resolve();
  expect(received).toEqual([snapshot()]);
});
import type { AuthUserAvatarTransportOptions } from './auth-user-avatar-transport';
test('strict avatar metadata accepts private exact paths and rejects malformed, external or public grants', () => {
  expect(isUserAvatarSnapshot(snapshot())).toBe(true); expect(isUserAvatarCapabilities(snapshot().capabilities)).toBe(true);
  expect(isUserAvatarCapabilities({ ...snapshot().capabilities, state: 'blocked', editable: false })).toBe(true);
  expect(isUserAvatarCapabilities({ ...snapshot().capabilities, state: 'blocked' })).toBe(false);
  expect(isUserAvatarAsset(asset())).toBe(true); expect(isUserAvatarAsset({ ...asset(), deliveryPath: 'https://evil.test/picture' })).toBe(false);
  expect(isUserAvatarAsset({ ...asset(), deliveryPath: `${asset().deliveryPath}?proof=private` })).toBe(false);
  expect(isUserAvatarStage(stage())).toBe(true);
  expect(isUserAvatarStage({ ...stage(), upload: { ...stage().upload, public: true } })).toBe(false);
  expect(isUserAvatarStage({ ...stage(), upload: { ...stage().upload, resource: { type: 'guardian-avatar-stage', id: 'another-stage' } } })).toBe(false);
});
test('publication and withdrawal use the existing own-profile authority and admit only opaque exact public delivery paths', async () => {
  const publicAsset = { ...asset(), id: `avp_${uuid}`, deliveryPath: `/auth/profile/avatar/public/avp_${uuid}` };
  expect(isUserPublicAvatarAsset(publicAsset)).toBe(true);
  expect(isUserPublicAvatarAsset({ ...publicAsset, deliveryPath: 'https://external.test/photo' })).toBe(false);
  expect(isUserPublicAvatarAsset({ ...publicAsset, id: 'private-user-id' })).toBe(false);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const owner = api(async (url, init) => { calls.push({ url, init }); return Response.json({ ...snapshot(), asset: asset(),
    capabilities: { ...snapshot().capabilities, publicAccess: true, publicState: 'ready' }, publicAsset: init?.method === 'DELETE' ? null : publicAsset }); });
  expect((await owner.transport.publish(2)).publicAsset?.id).toBe(publicAsset.id);
  expect((await owner.transport.withdraw(3)).publicAsset).toBeNull();
  expect(calls.map(call => [call.url, call.init?.method, JSON.parse(String(call.init?.body))])).toEqual([
    ['http://avatar.test/auth/profile/avatar/publication', 'POST', { expectedRevision: 2 }],
    ['http://avatar.test/auth/profile/avatar/publication', 'DELETE', { expectedRevision: 3 }],
  ]);
});
test('avatar capability enums admit actual strings only and never invoke object coercion', () => {
  let coercions = 0;
  for (const [key, valid] of Object.entries({ state: 'ready', shape: 'circle', size: 'sm', fallback: 'initials' })) {
    for (const value of [[valid], { toString() { coercions++; return valid; } }, null, 1]) {
      expect(isUserAvatarCapabilities({ ...snapshot().capabilities, editable: false, [key]: value })).toBe(false);
      expect(isUserAvatarSnapshot({ ...snapshot(), capabilities: { ...snapshot().capabilities, editable: false, [key]: value } })).toBe(false);
    }
  }
  expect(coercions).toBe(0);
});
test('replace uses exact staged grant PUT, captured CAS revision, private no-store and acknowledged finalize', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const { transport } = api(async (url, init) => { calls.push({ url, init }); return Response.json(url.endsWith('/stages') ? stage() : url.includes('/upload-grants/') ? { uploaded: true } : snapshot()); });
  const accepted = await transport.replace(new Blob(['webp'], { type: 'image/webp' }), 1);
  expect(accepted.revision).toBe(2);
  expect(calls.map(call => [call.url, call.init?.method])).toEqual([
    ['http://avatar.test/auth/profile/avatar/stages', 'POST'], ['http://avatar.test/storage/upload-grants/signed-grant', 'PUT'],
    [`http://avatar.test/auth/profile/avatar/stages/avs_${uuid}/finalize`, 'POST']]);
  expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ expectedRevision: 1 });
  expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({ receipt: 'a'.repeat(64) });
  expect(calls.every(call => call.init?.cache === 'no-store' && call.init.signal instanceof AbortSignal)).toBe(true);
  expect(new Headers(calls[1]!.init?.headers).get('Content-Type')).toBe('image/webp');
});
test('allocated stages are immutable, cannot be copied or reused after originating identity retires', async () => {
  const owner = api(async () => Response.json(stage())); const allocated = await owner.transport.stage(1);
  expect(Object.isFrozen(allocated)).toBe(true); expect(Object.isFrozen(allocated.upload.contentTypes)).toBe(true);
  await expect(owner.transport.upload(structuredClone(allocated), new Blob(['x'], { type: 'image/webp' }))).rejects.toMatchObject({ name: 'AbortError' });
  owner.retire(); await expect(owner.transport.finalize(allocated)).rejects.toMatchObject({ name: 'AbortError' });
});
test('replacement scope during pending upload cannot dispatch finalize or publish the old result', async () => {
  let resolve!: (response: Response) => void, finalizes = 0;
  const pending = new Promise<Response>(yes => { resolve = yes; });
  const owner = api(async url => url.endsWith('/stages') ? Response.json(stage()) : url.includes('/upload-grants/') ? pending : (finalizes++, Response.json(snapshot())));
  const replacing = owner.transport.replace(new Blob(['image'], { type: 'image/webp' }), 1).catch(cause => cause);
  await new Promise(yes => setTimeout(yes, 0)); owner.retire(); resolve(Response.json({ uploaded: true }));
  expect(await replacing).toMatchObject({ name: 'AbortError' }); expect(finalizes).toBe(0);
});
test('private image delivery reads bounded matching bytes, refuses MIME/oversize and never requests external paths', async () => {
  let calls = 0;
  const { transport } = api(async () => { calls++; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } }); });
  const image = await transport.deliver(asset()); expect(image.type).toBe('image/webp'); expect(image.size).toBe(3);
  await expect(transport.deliver({ ...asset(), deliveryPath: 'https://evil.test/image' })).rejects.toMatchObject({ code: 'AUTH_AVATAR_RESPONSE_INVALID' });
  expect(calls).toBe(1);
  const invalid = api(async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'image/webp' } }));
  await expect(invalid.transport.deliver(asset())).rejects.toMatchObject({ code: 'AUTH_AVATAR_RESPONSE_INVALID' });
});
test('stalled avatar JSON body is bounded and a late result cannot allocate an admitted stage', async () => {
  let resolve!: (body: unknown) => void; const pending = new Promise(yes => { resolve = yes; });
  const owner = api(async () => ({ ok: true, status: 200, json: () => pending } as Response), 5);
  await expect(owner.transport.stage(1)).rejects.toMatchObject({ name: 'TimeoutError' }); resolve(stage());
});
test('explicit cancel/remove/directory reuse captured authority and expected revision without arbitrary receipt endpoints', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const owner = api(async (url, init) => { calls.push({ url, init }); return Response.json(url.endsWith('/stages') ? stage()
    : url.includes('/stages/') ? { cancelled: true } : url.includes('/users/') ? { userId: 'peer', displayName: 'Peer', asset: null } : snapshot()); });
  const allocated = await owner.transport.stage(1); await owner.transport.cancel(allocated); await owner.transport.remove(2);
  expect(await owner.transport.directory('peer')).toEqual({ userId: 'peer', displayName: 'Peer', asset: null });
  expect(calls[1]!.init?.method).toBe('DELETE'); expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({ expectedRevision: 2 });
});
test('real AuthClient facade will not continue an allocated stage after a new browser family logs in', async () => {
  const user = (userId: string) => ({ userId, username: userId, email: `${userId}@example.test`, firstName: null, lastName: null,
    role: 'member', status: 'active', passwordChangeRequired: false, emailVerifiedAt: null, emailVerificationRequired: false, mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null });
  let uploads = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) { const { username } = JSON.parse(String(init?.body)); return Response.json({ user: user(username), accessToken: `${username}-access`, refreshToken: `${username}-refresh` }); }
    if (url.endsWith('/stages')) return Response.json(stage());
    if (url.includes('/upload-grants/')) uploads++;
    return Response.json({ ok: true });
  }) as typeof fetch;
  const client = new AuthClient('http://avatar-facade.test'); clients.push(client); await client.login('a', 'synthetic-password');
  const allocated = await client.avatars.stage(1); await client.login('b', 'synthetic-password');
  await expect(client.avatars.upload(allocated, new Blob(['image'], { type: 'image/webp' }))).rejects.toBeInstanceOf(Error);
  expect(uploads).toBe(0); expect(client.user?.userId).toBe('b');
});
test('real AuthClient avatar reads preserve supported same-family refresh and one retry after an expired access token', async () => {
  const user = { userId: 'a', username: 'a', email: 'a@example.test', firstName: null, lastName: null,
    role: 'member', status: 'active', passwordChangeRequired: false, emailVerifiedAt: null, emailVerificationRequired: false, mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null };
  let reads = 0, refreshes = 0;
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.endsWith('/auth/login')) return Response.json({ user, accessToken: 'old-access', refreshToken: 'old-refresh' });
    if (url.endsWith('/auth/refresh')) { refreshes++; return Response.json({ accessToken: 'new-access', refreshToken: 'new-refresh' }); }
    if (url.endsWith('/auth/profile/avatar')) { reads++; return reads === 1 ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(snapshot()); }
    return Response.json({ ok: true });
  }) as typeof fetch;
  const client = new AuthClient('http://avatar-refresh.test'); clients.push(client); await client.login('a', 'synthetic-password');
  expect((await client.avatars.get()).userId).toBe('a'); expect(reads).toBe(2); expect(refreshes).toBe(1);
});
