import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import sharp from 'sharp';
import { createReactiveDB } from '../sync/reactive-db';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { MemoryEventStore } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { createAuthPlugin } from './auth.plugin';
import type { AuthRuntime } from './auth-runtime';
import { createStoragePlugin } from '../storage/storage.plugin';
import type { StorageService } from '../storage/storage-service';
import type { StorageAdapter } from '../storage/types';
import { normalizeAuthUserAvatar } from './auth-config-user-avatar';
import { AuthUserAvatarService, ZERO_GUARDIAN_AVATARS } from './auth-user-avatar-service';
import { createAuthUserAvatarPlugin } from './auth-user-avatar.plugin';
import { installAppStopBarrier } from '../frontend/server/app-stop-lifecycle';
import { createAuthPlatformCodeEmitter } from './auth-observability';
import { reconcileUserProfilePolicy } from './auth-user-profile-policy';
import { normalizeAuthUserProfile } from './auth-config-user-profile';
import { NativeSessionStore } from './oidc/native-session-store';
import { prepareNativeSession } from './oidc/native-session-factory';
import { NativeTenantAuthorityService } from './oidc/native-tenant-authority';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const operation of cleanup.splice(0).reverse()) await operation(); });
async function fixture(allowed = true, mode: 'single' | 'multi' = 'single') {
  const db = createReactiveDB({ mode: 'memory' }), owner = new ZeroAppRuntime();
  const events = new MemoryEventStore({ maxEvents: 100 });
  owner.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  let auth!: AuthRuntime, storage!: StorageService, avatars!: AuthUserAvatarService;
  const blobs = new Map<string, Uint8Array>();
  let hold: { wait: Promise<void>; started(): void } | null = null;
  const adapter: StorageAdapter = { writeShutdownSafety: 'cooperative',
    async writeBlob(input) {
      const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(await new Response(input).arrayBuffer());
      const checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex'); blobs.set(checksum, bytes);
      if (hold) { const gate = hold; hold = null; gate.started(); await gate.wait; }
      return { checksum, size: bytes.byteLength, headBytes: bytes.slice(0, 512) };
    },
    async readBlob(checksum) { const bytes = blobs.get(checksum); return bytes ? new Blob([Uint8Array.from(bytes).buffer]).stream() : null; },
    async readBlobRange(checksum, start, end) { const bytes = blobs.get(checksum); return bytes ? new Blob([bytes.slice(start, end + 1).buffer]).stream() : null; },
    async removeBlob(checksum) { blobs.delete(checksum); }, removeBlobSync(checksum) { blobs.delete(checksum); },
    async blobExists(checksum) { return blobs.has(checksum); }, async blobSize(checksum) { return blobs.get(checksum)?.length ?? 0; } };
  const app = new Elysia().use(createAuthPlugin({ db, runtime: owner, bootstrap: 'public', tenancy: mode,
    nativeIssuer: 'http://localhost/auth', nativeAudience: 'http://localhost',
    nativeApps: { clients: [{ clientId: 'avatar-native', name: 'Avatar Native',
      redirectUris: ['com.example.avatar:/callback'], scopes: ['openid', 'profile', 'profile:write'] }] },
    userProfile: { avatars: true }, onRuntimeCreated: created => { auth = created; } }));
  await auth.start();
  app.use(createAuthUserAvatarPlugin({ getService: () => avatars ?? null, getTokenService: () => auth.getTokenService() }));
  app.use(createStoragePlugin({ db, runtime: owner, adapter, getTokenService: () => auth.getTokenService(),
    captureUploadGrantCommitFence: grant => avatars.captureUploadGrantCommitFence(grant),
    onServiceCreated(created) {
      storage = created;
      avatars = new AuthUserAvatarService({ db, storage, users: auth.getStore()!, tokens: auth.getTokenService()!,
        tenancy: auth.getTenancyService(),
        policy: normalizeAuthUserAvatar({ enabled: true, outputSize: 64 }), installAllowed: allowed, emitCode: createAuthPlatformCodeEmitter(owner) });
      owner.set(ZERO_GUARDIAN_AVATARS, avatars); owner.addCleanup(() => avatars.close()); avatars.initialize();
    } }));
  installAppStopBarrier(app, () => owner.dispose()); app.listen(0);
  cleanup.push(async () => { await app.stop(); db.dispose(); });
  const request = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await app.handle(new Request(`http://localhost${path}`, { method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, headers: response.headers, body: await response.json() as any };
  };
  const register = async (name = 'avatar-owner') => {
    const result = await request('POST', '/auth/register', { username: name, email: `${name}@example.test`, password: 'password123', firstName: 'Avatar',
      ...(mode === 'multi' ? { organizationName: `${name} organization` } : {}) });
    expect(result.status).toBe(200); return result.body;
  };
  const picture = () => sharp({ create: { width: 80, height: 70, channels: 3, background: '#223355' } }).png().toBuffer();
  const upload = async (stage: any, bytes?: Uint8Array) => {
    const input = bytes ?? await picture();
    const response = await app.handle(new Request(`http://localhost/storage/upload-grants/${encodeURIComponent(stage.upload.token)}`, {
      method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Uint8Array.from(input) }));
    expect(response.status).toBe(201); return response.json();
  };
  const blockWrite = () => { let release!: () => void, started!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
    hold = { wait, started }; return { release, started: began }; };
  const nativeToken = async (accessToken: string, scope: string) => {
    const tokens = auth.getTokenService()!, pageAuth = await tokens.resolveAuthContext(accessToken);
    if (!pageAuth) throw new Error('Expected a live web session.');
    const authority = new NativeTenantAuthorityService(mode, auth.getTenancyService()).capturePageAuthority(pageAuth);
    if (!authority) throw new Error('Expected live application or tenant authority.');
    const user = auth.getStore()!.getUserById(pageAuth.userId)!;
    const generation = auth.getStore()!.getAuthGeneration(user.userId);
    const prepared = prepareNativeSession({ userId: user.userId, clientId: 'avatar-native', scope,
      authGeneration: generation, ttlMs: 3_600_000, authority });
    expect(new NativeSessionStore(db).consumeCodeAndInsert(() => true, prepared.session)).toBe(true);
    return tokens.signNativeAccessToken(user, 'avatar-native', scope, generation, prepared.session.familyId);
  };
  return { db, owner, auth, storage, avatars, request, register, upload, picture, blockWrite, app, blobs, nativeToken };
}
describe('Guardian avatars through actual Storage grants and Elysia', () => {
  test('stage/upload/finalize proves raster identity, private delivery, consume-once and shared revision', async () => {
    const f = await fixture(), user = await f.register();
    const before = await f.request('GET', '/auth/profile/avatar', undefined, user.accessToken);
    expect(before.body).toMatchObject({ revision: 1, asset: null, capabilities: { state: 'ready' } });
    const stage = await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, user.accessToken);
    expect(stage.status).toBe(200); expect(stage.body.upload.public).toBe(false); await f.upload(stage.body);
    const accepted = await f.request('POST', `/auth/profile/avatar/stages/${stage.body.id}/finalize`, { receipt: stage.body.receipt }, user.accessToken);
    expect(accepted.status).toBe(200); expect(accepted.body).toMatchObject({ revision: 2, asset: { width: 64, height: 64, mimeType: 'image/webp' } });
    const duplicate = await f.request('POST', `/auth/profile/avatar/stages/${stage.body.id}/finalize`, { receipt: stage.body.receipt }, user.accessToken);
    expect(duplicate.body.revision).toBe(2);
    const delivered = await f.app.handle(new Request(`http://localhost${accepted.body.asset.deliveryPath}`, { headers: { Authorization: `Bearer ${user.accessToken}` } }));
    expect(delivered.status).toBe(200); expect(delivered.headers.get('cache-control')).toContain('no-store');
    expect(delivered.headers.get('content-type')).toBe('image/webp');
    expect((await sharp(new Uint8Array(await delivered.arrayBuffer())).metadata()).format).toBe('webp');
    expect((await f.request('PATCH', '/auth/profile', { expectedRevision: 1, changes: { firstName: 'Stale' } }, user.accessToken)).status).toBe(409);
  });
  test('another identity/receipt cannot attach uploaded bytes; no capability is accepted as profile proof', async () => {
    const f = await fixture(), owner = await f.register(), other = await f.register('another-avatar');
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, owner.accessToken)).body; await f.upload(stage);
    const finalize = (token: string, receipt = stage.receipt) => f.request('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt }, token);
    expect((await finalize(other.accessToken)).status).toBe(409); expect((await finalize(owner.accessToken, '0'.repeat(64))).status).toBe(409);
    expect((await f.request('GET', '/auth/profile/avatar', undefined, owner.accessToken)).body.asset).toBeNull();
    expect((await finalize(owner.accessToken)).status).toBe(200);
    const entry = await f.request('GET', `/auth/profile/avatar/users/${owner.user.userId}`, undefined, other.accessToken);
    expect(entry.status).toBe(200); expect(JSON.stringify(entry.body)).not.toContain(owner.user.email);
  });
  test('minimal directory and private image delivery require a live shared active organization', async () => {
    const f = await fixture(true, 'multi'), reader = await f.register('directory-reader');
    const subject = await f.register('directory-subject'), outside = await f.register('directory-outside');
    const tenancy = f.auth.getTenancyService()!;
    const membership = tenancy.addMembership({ tenantId: reader.tenant.tenantId, userId: subject.user.userId,
      roleKey: 'member', createdBy: reader.user.userId });
    const stage = await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, subject.accessToken);
    expect(stage.status).toBe(200); await f.upload(stage.body);
    const accepted = await f.request('POST', `/auth/profile/avatar/stages/${stage.body.id}/finalize`, { receipt: stage.body.receipt }, subject.accessToken);
    expect(accepted.status).toBe(200);
    const path = `/auth/profile/avatar/users/${subject.user.userId}`;
    const entry = await f.request('GET', path, undefined, reader.accessToken);
    expect(entry.status).toBe(200);
    expect(Object.keys(entry.body).sort()).toEqual(['asset', 'displayName', 'userId']);
    expect(entry.body).toMatchObject({ userId: subject.user.userId, displayName: 'Avatar', asset: accepted.body.asset });
    expect(JSON.stringify(entry.body)).not.toContain(subject.user.email);
    expect(JSON.stringify(entry.body)).not.toContain(subject.user.username);
    expect(entry.headers.get('cache-control')).toContain('no-store');
    expect((await f.request('GET', path, undefined, outside.accessToken)).status).toBe(404);
    expect((await f.request('GET', path)).status).toBe(401);
    const download = (token: string) => f.app.handle(new Request(`http://localhost${accepted.body.asset.deliveryPath}`,
      { headers: { Authorization: `Bearer ${token}` } }));
    const permitted = await download(reader.accessToken);
    expect(permitted.status).toBe(200); expect((await permitted.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await download(outside.accessToken)).status).toBe(404);
    tenancy.suspendMembership(membership.membershipId);
    expect((await f.request('GET', path, undefined, reader.accessToken)).status).toBe(404);
    expect((await download(reader.accessToken)).status).toBe(404);
    expect((await f.request('GET', path, undefined, subject.accessToken)).status).toBe(200);
    tenancy.addMembership({ tenantId: reader.tenant.tenantId, userId: outside.user.userId,
      roleKey: 'owner', createdBy: reader.user.userId });
    const ownMembership = tenancy.getMembership(reader.tenant.tenantId, reader.user.userId)!;
    tenancy.suspendMembership(ownMembership.membershipId);
    expect((await f.request('GET', path, undefined, reader.accessToken)).status).toBe(401);
  });
  test('actual admitted native sessions are self-only and profile read consent never grants avatar writes', async () => {
    const f = await fixture(true, 'multi'), user = await f.register('native-avatar-owner');
    const other = await f.register('native-avatar-peer'), tenancy = f.auth.getTenancyService()!;
    tenancy.addMembership({ tenantId: user.tenant.tenantId, userId: other.user.userId, roleKey: 'owner', createdBy: user.user.userId });
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, user.accessToken)).body;
    await f.upload(stage);
    const initial = await f.request('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt: stage.receipt }, user.accessToken);
    expect(initial.status).toBe(200);
    const identity = await f.nativeToken(user.accessToken, 'openid');
    expect((await f.request('GET', '/auth/profile/avatar', undefined, identity)).status).toBe(403);
    const reader = await f.nativeToken(user.accessToken, 'openid profile');
    const own = await f.request('GET', '/auth/profile/avatar', undefined, reader);
    expect(own.status).toBe(200); expect(own.body.capabilities.editable).toBe(false);
    expect((await f.request('GET', `/auth/profile/avatar/users/${user.user.userId}`, undefined, reader)).status).toBe(200);
    expect((await f.request('GET', `/auth/profile/avatar/users/${other.user.userId}`, undefined, reader)).status).toBe(404);
    expect((await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 2 }, reader)).status).toBe(403);
    expect((await f.request('DELETE', '/auth/profile/avatar', { expectedRevision: 2 }, reader)).status).toBe(403);
    const delivered = await f.app.handle(new Request(`http://localhost${own.body.asset.deliveryPath}`, { headers: { Authorization: `Bearer ${reader}` } }));
    expect(delivered.status).toBe(200); await delivered.arrayBuffer();
    const writer = await f.nativeToken(user.accessToken, 'openid profile profile:write');
    const replacement = await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 2 }, writer);
    expect(replacement.status).toBe(200); await f.upload(replacement.body);
    expect((await f.request('POST', `/auth/profile/avatar/stages/${replacement.body.id}/finalize`, { receipt: replacement.body.receipt }, writer)).body.revision).toBe(3);
    expect((await f.request('DELETE', '/auth/profile/avatar', { expectedRevision: 3 }, writer)).body).toMatchObject({ revision: 4, asset: null });
    tenancy.suspendMembership(tenancy.getMembership(user.tenant.tenantId, user.user.userId)!.membershipId);
    expect((await f.request('GET', '/auth/profile/avatar', undefined, reader)).status).toBe(401);
    expect((await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 4 }, writer)).status).toBe(401);
  });
  test('an edit while provider I/O waits defeats attachment and preserves the existing image', async () => {
    const f = await fixture(), owner = await f.register();
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, owner.accessToken)).body; await f.upload(stage);
    const gate = f.blockWrite();
    const pending = f.request('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt: stage.receipt }, owner.accessToken);
    await gate.started;
    const edit = await f.request('PATCH', '/auth/profile', { expectedRevision: 1, changes: { firstName: 'Newer' } }, owner.accessToken);
    expect(edit.status).toBe(200); gate.release();
    expect((await pending).status).toBe(409);
    expect((await f.request('GET', '/auth/profile/avatar', undefined, owner.accessToken)).body).toMatchObject({ revision: 2, asset: null });
  });
  test('revocation during provider I/O cannot attach an image, and namespace cannot become public', async () => {
    const f = await fixture(), owner = await f.register();
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, owner.accessToken)).body; await f.upload(stage);
    const gate = f.blockWrite(), pending = f.request('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt: stage.receipt }, owner.accessToken);
    await gate.started; f.auth.getStore()!.updateUser(owner.user.userId, { status: 'suspended' }); gate.release();
    expect((await pending).status).not.toBe(200);
    expect(f.db.prepare('SELECT * FROM _auth_user_avatars').all()).toEqual([]);
    const drive = f.db.prepare('SELECT drive_id FROM _auth_avatar_namespace').get() as { drive_id: string };
    f.storage.drives.setVisibility(drive.drive_id, true);
    expect(f.avatars.capabilities().state).toBe('blocked');
  });
  test('a newer installed policy defeats a pending avatar write and reverting it cannot revive the old runtime', async () => {
    const f = await fixture(), user = await f.register();
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, user.accessToken)).body;
    await f.upload(stage);
    const gate = f.blockWrite();
    const pending = f.request('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt: stage.receipt }, user.accessToken);
    try {
      await gate.started;
      reconcileUserProfilePolicy(f.db, f.auth.getStore()!, normalizeAuthUserProfile({ avatars: false }));
      expect(f.avatars.capabilities().state).toBe('blocked');
      gate.release();
      expect((await pending).status).not.toBe(200);
      expect(f.db.prepare('SELECT * FROM _auth_user_avatars').all()).toEqual([]);
      reconcileUserProfilePolicy(f.db, f.auth.getStore()!, normalizeAuthUserProfile({ avatars: true }));
      expect(f.avatars.capabilities().state).toBe('blocked');
      expect((await f.request('GET', '/auth/me', undefined, user.accessToken)).status).toBe(200);
    } finally { gate.release(); await pending; }
  });
  test('migrate:false never provisions a missing schema or namespace and normal auth remains usable', async () => {
    const f = await fixture(false), user = await f.register();
    expect(f.avatars.capabilities().state).toBe('blocked');
    expect((await f.request('GET', '/auth/profile/avatar', undefined, user.accessToken)).status).toBe(503);
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name = '_auth_avatar_assets'").get()).toBeNull();
    expect((await f.request('GET', '/auth/me', undefined, user.accessToken)).status).toBe(200);
  });
  test('drain joins a held provider write, rejects its late attachment, and retains restart cleanup', async () => {
    const f = await fixture(), user = await f.register();
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, user.accessToken)).body;
    await f.upload(stage);
    const gate = f.blockWrite();
    const pending = f.request('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt: stage.receipt }, user.accessToken);
    await gate.started;
    let drained = false;
    const closing = f.avatars.close().then(() => { drained = true; });
    try {
      await Bun.sleep(10);
      expect(drained).toBe(false);
      expect(f.avatars.capabilities().state).toBe('disabled');
      gate.release();
      expect((await pending).status).not.toBe(200);
      await closing;
      expect(f.db.prepare('SELECT * FROM _auth_user_avatars').all()).toEqual([]);
      expect(f.db.prepare("SELECT state FROM _auth_avatar_assets WHERE state = 'retired'").all()).toHaveLength(1);
      const restarted = new AuthUserAvatarService({ db: f.db, storage: f.storage, users: f.auth.getStore()!,
        tokens: f.auth.getTokenService()!, policy: normalizeAuthUserAvatar({ enabled: true, outputSize: 64 }), installAllowed: true });
      try {
        restarted.initialize(); await restarted.cleanup();
        expect(f.db.prepare('SELECT * FROM _auth_avatar_assets').all()).toEqual([]);
        expect(f.blobs.size).toBe(0);
      } finally { await restarted.close(); }
    } finally { gate.release(); await closing; }
  });
  test('cancelled stage cleanup fences a held signed upload before final metadata publication', async () => {
    const f = await fixture(), user = await f.register();
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: 1 }, user.accessToken)).body;
    const bytes = await f.picture(), gate = f.blockWrite();
    const pending = f.app.handle(new Request(`http://localhost/storage/upload-grants/${encodeURIComponent(stage.upload.token)}`, {
      method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Uint8Array.from(bytes) }));
    try {
      await gate.started;
      expect((await f.request('DELETE', `/auth/profile/avatar/stages/${stage.id}`, { receipt: stage.receipt }, user.accessToken)).status).toBe(200);
      await f.avatars.cleanup();
      expect(f.db.prepare('SELECT stage_id FROM _auth_avatar_stages WHERE stage_id=?').get(stage.id)).toBeNull();
      gate.release();
      expect((await pending).status).toBe(409);
      const drive = f.db.prepare('SELECT drive_id FROM _auth_avatar_namespace').get() as { drive_id: string };
      expect(f.storage.objects.get(drive.drive_id, `/avatars/stages/${stage.id}`)).toBeNull();
      expect(f.db.prepare('SELECT * FROM _auth_user_avatars').all()).toEqual([]);
      expect(f.blobs.size).toBe(0);
    } finally { gate.release(); await pending; }
  });
});
