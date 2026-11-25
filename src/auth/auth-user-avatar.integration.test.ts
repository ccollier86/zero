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
import { serviceDataScopeFromIdentity } from './service-data-scope';
import { createMessagingAccessPolicy } from '../messaging/recipient-policy';
import type { AuthUserAvatarReadPolicy } from './auth-user-avatar-read-policy';
import type { AccessRequirement } from './authorization-kernel';
import type { AuthContext } from './types';

const cleanup: Array<() => Promise<void>> = [];
describe('explicit public Guardian avatars', () => {
  const prepare = async (f: Awaited<ReturnType<typeof fixture>>, token: string, revision: number) => {
    const stage = (await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: revision }, token)).body;
    await f.upload(stage); return f.request('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt: stage.receipt }, token);
  };
  test('public delivery requires opt-in and an explicit own-account publication, never a drive visibility change', async () => {
    const disabled = await fixture(), privateUser = await disabled.register();
    expect((await disabled.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 1 }, privateUser.accessToken)).body.code).toBe('AUTH_AVATAR_PUBLIC_DISABLED');
    const f = await fixture(true, 'single', true), user = await f.register(), token = user.accessToken;
    const uploaded = await prepare(f, token, 1); expect(uploaded.body.publicAsset).toBeNull();
    const published = await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 2 }, token);
    expect(published.status).toBe(200); expect(published.body.revision).toBe(3);
    const image = published.body.publicAsset; expect(image.deliveryPath).toContain('/public/avp_');
    expect(image.deliveryPath).not.toContain(uploaded.body.asset.id);
    const response = await f.app.handle(new Request(`http://localhost${image.deliveryPath}`));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await sharp(new Uint8Array(await response.arrayBuffer())).metadata()).format).toBe('webp');
    expect((f.db.prepare('SELECT public FROM storage_drives WHERE name=?').get('Guardian profile media') as { public: number }).public).toBe(0);
    const duplicate = await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 3 }, token);
    expect(duplicate.body.revision).toBe(3); expect(duplicate.body.publicAsset.id).toBe(image.id);
    expect((await f.request('DELETE', '/auth/profile/avatar/publication', { expectedRevision: 3 }, token)).body.revision).toBe(4);
    expect((await f.app.handle(new Request(`http://localhost${image.deliveryPath}`))).status).toBe(404);
  });
  test('replacement and removal cannot retain public delivery or auto-publish a new photo', async () => {
    const f = await fixture(true, 'single', true), user = await f.register(), token = user.accessToken;
    await prepare(f, token, 1);
    const original = (await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 2 }, token)).body.publicAsset;
    expect((await prepare(f, token, 3)).body.publicAsset).toBeNull();
    expect((await f.app.handle(new Request(`http://localhost${original.deliveryPath}`))).status).toBe(404);
    const next = (await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 4 }, token)).body.publicAsset;
    expect(next.id).not.toBe(original.id);
    await f.request('DELETE', '/auth/profile/avatar', { expectedRevision: 5 }, token);
    expect((await f.app.handle(new Request(`http://localhost${next.deliveryPath}`))).status).toBe(404);
  });
  test('withdrawing publication or suspending the subject during a provider read releases no public bytes', async () => {
    for (const operation of ['withdraw', 'suspend'] as const) {
      const f = await fixture(true, 'single', true), user = await f.register(), token = user.accessToken;
      await prepare(f, token, 1);
      const image = (await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 2 }, token)).body.publicAsset;
      const gate = f.blockRead(), pending = f.app.handle(new Request(`http://localhost${image.deliveryPath}`));
      await gate.started;
      if (operation === 'withdraw') expect((await f.request('DELETE', '/auth/profile/avatar/publication', { expectedRevision: 3 }, token)).status).toBe(200);
      else f.auth.getStore()!.updateUser(user.user.userId, { status: 'suspended' });
      gate.release();
      const response = await pending;
      expect(response.status).toBe(404); expect(response.headers.get('content-type')).not.toBe('image/webp');
    }
  });
  test('stale revisions, foreign targets and missing publication schema fail closed without request-time DDL', async () => {
    const f = await fixture(true, 'single', true), user = await f.register(), other = await f.register('unpublished-peer');
    await prepare(f, user.accessToken, 1);
    expect((await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 1 }, user.accessToken)).status).toBe(409);
    expect((await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 2, userId: user.user.userId }, other.accessToken)).status).toBe(422);
    expect((await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 1 }, other.accessToken)).status).toBe(422);
    f.db.exec('DROP TABLE _auth_avatar_publications');
    expect((await f.request('POST', '/auth/profile/avatar/publication', { expectedRevision: 2 }, user.accessToken)).status).toBe(503);
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='_auth_avatar_publications'").get()).toBeNull();
    expect((await f.request('GET', '/auth/profile/avatar', undefined, user.accessToken)).body.capabilities.state).toBe('ready');
  });
});
afterEach(async () => { for (const operation of cleanup.splice(0).reverse()) await operation(); });
async function fixture(allowed = true, mode: 'single' | 'multi' = 'single', publicAccess = false,
  reads: { policy?: AuthUserAvatarReadPolicy; context?: boolean } = {}) {
  const db = createReactiveDB({ mode: 'memory' }), owner = new ZeroAppRuntime();
  db.exec('PRAGMA temp_store=MEMORY');
  const events = new MemoryEventStore({ maxEvents: 100 });
  owner.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  let auth!: AuthRuntime, storage!: StorageService, avatars!: AuthUserAvatarService;
  const blobs = new Map<string, Uint8Array>();
  let hold: { wait: Promise<void>; started(): void } | null = null;
  let holdRead: { wait: Promise<void>; started(): void } | null = null;
  let holdChunk: { wait: Promise<void>; started(): void } | null = null;
  const adapter: StorageAdapter = { writeShutdownSafety: 'cooperative',
    async writeBlob(input) {
      const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(await new Response(input).arrayBuffer());
      const checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex'); blobs.set(checksum, bytes);
      if (hold) { const gate = hold; hold = null; gate.started(); await gate.wait; }
      return { checksum, size: bytes.byteLength, headBytes: bytes.slice(0, 512) };
    },
    async readBlob(checksum) { if (holdRead) { const gate = holdRead; holdRead = null; gate.started(); await gate.wait; }
      const bytes = blobs.get(checksum);
      if (bytes && holdChunk) {
        const gate = holdChunk; holdChunk = null;
        return new ReadableStream<Uint8Array>({ async pull(controller) {
          gate.started(); await gate.wait; controller.enqueue(Uint8Array.from(bytes)); controller.close();
        } });
      }
      return bytes ? new Blob([Uint8Array.from(bytes).buffer]).stream() : null; },
    async readBlobRange(checksum, start, end) { const bytes = blobs.get(checksum); return bytes ? new Blob([bytes.slice(start, end + 1).buffer]).stream() : null; },
    async removeBlob(checksum) { blobs.delete(checksum); }, removeBlobSync(checksum) { blobs.delete(checksum); },
    async blobExists(checksum) { return blobs.has(checksum); }, async blobSize(checksum) { return blobs.get(checksum)?.length ?? 0; } };
  const app = new Elysia().use(createAuthPlugin({ db, runtime: owner, bootstrap: 'public', tenancy: mode,
    userAvatarReadPolicy: reads.policy,
    nativeIssuer: 'http://localhost/auth', nativeAudience: 'http://localhost',
    nativeApps: { clients: [{ clientId: 'avatar-native', name: 'Avatar Native',
      redirectUris: ['com.example.avatar:/callback'], scopes: ['openid', 'profile', 'profile:write'] }] },
    userProfile: { avatars: { enabled: true, publicAccess } }, onRuntimeCreated: created => { auth = created; } }));
  cleanup.push(async () => { try { if (app.server) await app.stop(); else await owner.dispose(); } finally { db.dispose(); } });
  await auth.start();
  app.use(createAuthUserAvatarPlugin({ getService: () => avatars ?? null, getTokenService: () => auth.getTokenService() }));
  app.use(createStoragePlugin({ db, runtime: owner, adapter, getTokenService: () => auth.getTokenService(),
    captureUploadGrantCommitFence: grant => avatars.captureUploadGrantCommitFence(grant),
    onServiceCreated(created) {
      storage = created;
      avatars = new AuthUserAvatarService({ db, storage, users: auth.getStore()!, tokens: auth.getTokenService()!,
        audit: auth.getAuditService()!,
        tenancy: auth.getTenancyService(),
        readPolicy: reads.policy,
        ...(reads.policy && reads.context !== false ? { readPolicyContext: (viewer: AuthContext, subjectId: string, guard: () => void) => {
          guard(); const scope = serviceDataScopeFromIdentity(viewer, mode);
          if (!scope) throw new Error('Missing synthetic viewer scope');
          const permits = createMessagingAccessPolicy({ users: auth.getStore()!, tenancy: auth.getTenancyService(),
            kernel: auth.getAuthorizationKernel(), roles: auth.getAuthorizationRoleService(), assertCurrent: guard });
          return { viewerId: viewer.userId, subjectId, scope, db: { get: db.get.bind(db), query: db.query.bind(db) },
            allows: (userId: string, requirement: AccessRequirement) => permits(scope, userId, requirement) };
        } } : {}),
        policy: normalizeAuthUserAvatar({ enabled: true, publicAccess, outputSize: 64 }), installAllowed: allowed, emitCode: createAuthPlatformCodeEmitter(owner) });
      owner.set(ZERO_GUARDIAN_AVATARS, avatars); owner.addCleanup(() => avatars.close()); avatars.initialize();
    } }));
  installAppStopBarrier(app, () => owner.dispose()); app.listen(0);
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
    cleanup.push(async () => { release(); });
    hold = { wait, started }; return { release, started: began }; };
  const blockRead = () => { let release!: () => void, started!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
    cleanup.push(async () => { release(); });
    holdRead = { wait, started }; return { release, started: began }; };
  const blockChunk = () => { let release!: () => void, started!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
    cleanup.push(async () => { release(); });
    holdChunk = { wait, started }; return { release, started: began }; };
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
  return { db, owner, auth, storage, avatars, request, register, upload, picture, blockWrite, blockRead, blockChunk, app, blobs, nativeToken };
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
    const f = await fixture(true, 'multi', false, { policy: { id: 'synthetic-tenant-ceiling', version: '1', authorize: () => true } }), reader = await f.register('directory-reader');
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
    expect(Object.keys(entry.body).sort()).toEqual(['asset', 'displayName', 'revision', 'userId']);
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
    const f = await fixture(true, 'multi', false, { policy: { id: 'synthetic-native-ceiling', version: '1', authorize: () => true } }), user = await f.register('native-avatar-owner');
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

describe('viewer-scoped private Guardian photos', () => {
  const prepare = async (f: Awaited<ReturnType<typeof fixture>>, token: string, revision: number) => {
    const stage = await f.request('POST', '/auth/profile/avatar/stages', { expectedRevision: revision }, token);
    expect(stage.status).toBe(200); await f.upload(stage.body);
    const accepted = await f.request('POST', `/auth/profile/avatar/stages/${stage.body.id}/finalize`, { receipt: stage.body.receipt }, token);
    expect(accepted.status).toBe(200); return accepted.body;
  };
  const download = (f: Awaited<ReturnType<typeof fixture>>, path: string, token?: string) => f.app.handle(new Request(`http://localhost${path}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
  const relationshipPolicy = (): AuthUserAvatarReadPolicy => ({ id: 'synthetic-private-photos', version: '1', authorize(context) {
    return context.allows(context.viewerId, 'user') && context.allows(context.subjectId, 'user')
      && context.db.query('avatar_peer_reads').some(row => row.viewer_id === context.viewerId && row.subject_id === context.subjectId
        && row.scope_id === context.scope.scopeId && row.active === 1);
  } });
  const relationships = (f: Awaited<ReturnType<typeof fixture>>) => f.db.defineTable('avatar_peer_reads', {
    id: 'text primary key', viewer_id: 'text', subject_id: 'text', scope_id: 'text', active: 'integer',
  });

  test('live relationship union admits minimal metadata and private bytes, but the last ended relationship defeats the same URL', async () => {
    const f = await fixture(true, 'single', false, { policy: relationshipPolicy() }); relationships(f);
    const subject = await f.register('scoped-photo-subject'), viewer = await f.register('scoped-photo-viewer'), unrelated = await f.register('scoped-photo-unrelated');
    const own = await prepare(f, subject.accessToken, 1), path = `/auth/profile/avatar/users/${subject.user.userId}`;
    for (const id of ['current-house-chat', 'authorized-staff-roster']) f.db.insert('avatar_peer_reads', {
      id, viewer_id: viewer.user.userId, subject_id: subject.user.userId, scope_id: 'application', active: 1,
    });
    const entry = await f.request('GET', path, undefined, viewer.accessToken);
    expect(entry.status).toBe(200); expect(entry.body).toMatchObject({ revision: own.revision, asset: own.asset });
    expect(Object.keys(entry.body).sort()).toEqual(['asset', 'displayName', 'revision', 'userId']);
    const viewerAuth = await f.auth.getTokenService()!.resolveAuthContext(viewer.accessToken);
    expect(f.avatars.viewerAuthorizedDescriptor(viewerAuth!, subject.user.userId)).toEqual({ revision: own.revision, asset: own.asset });
    const image = await download(f, own.asset.deliveryPath, viewer.accessToken);
    expect(image.status).toBe(200); expect(image.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff'); expect(image.headers.get('cache-control')).toContain('no-store');
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await f.request('GET', path, undefined, unrelated.accessToken)).status).toBe(404);
    expect((await download(f, own.asset.deliveryPath, unrelated.accessToken)).status).toBe(404);
    expect((await f.request('GET', path)).status).toBe(401);
    expect((await download(f, own.asset.deliveryPath)).status).toBe(401);
    f.db.update('avatar_peer_reads', 'current-house-chat', { active: 0 });
    expect((await f.request('GET', path, undefined, viewer.accessToken)).status).toBe(200);
    f.db.update('avatar_peer_reads', 'authorized-staff-roster', { active: 0 });
    expect((await f.request('GET', path, undefined, viewer.accessToken)).body).toMatchObject({ code: 'AUTH_AVATAR_IMAGE_UNAVAILABLE' });
    expect((await download(f, own.asset.deliveryPath, viewer.accessToken)).status).toBe(404);
    expect((await download(f, own.asset.deliveryPath, subject.accessToken)).status).toBe(200);
  });

  test('configured policy with missing composition denies peers while own editing, directory and native delivery stay available', async () => {
    let calls = 0;
    const f = await fixture(true, 'single', false, { policy: { id: 'missing-context', version: '1', authorize() { calls++; return true; } }, context: false });
    const subject = await f.register('own-unaffected-subject'), other = await f.register('missing-context-peer');
    const initial = await prepare(f, subject.accessToken, 1);
    expect((await f.request('GET', `/auth/profile/avatar/users/${subject.user.userId}`, undefined, subject.accessToken)).status).toBe(200);
    expect((await f.request('GET', `/auth/profile/avatar/users/${subject.user.userId}`, undefined, other.accessToken)).status).toBe(404);
    expect((await download(f, initial.asset.deliveryPath, other.accessToken)).status).toBe(404);
    const nativeReader = await f.nativeToken(subject.accessToken, 'openid profile');
    const delivered = await download(f, initial.asset.deliveryPath, nativeReader);
    expect(delivered.status).toBe(200); await delivered.arrayBuffer();
    const replacement = await prepare(f, subject.accessToken, 2);
    expect(replacement.revision).toBe(3);
    expect((await f.request('DELETE', '/auth/profile/avatar', { expectedRevision: 3 }, subject.accessToken)).body).toMatchObject({ revision: 4, asset: null });
    expect(calls).toBe(0);
  });

  test('allowing policy cannot widen active organization, native peer or suspended-subject ceilings', async () => {
    const f = await fixture(true, 'multi', false, { policy: { id: 'cannot-widen', version: '1', authorize: () => true } });
    const subject = await f.register('ceiling-subject'), outsider = await f.register('ceiling-outsider');
    const own = await prepare(f, subject.accessToken, 1), path = `/auth/profile/avatar/users/${subject.user.userId}`;
    expect((await f.request('GET', path, undefined, outsider.accessToken)).status).toBe(404);
    expect((await download(f, own.asset.deliveryPath, outsider.accessToken)).status).toBe(404);
    const member = f.auth.getTenancyService()!.addMembership({ tenantId: outsider.tenant.tenantId, userId: subject.user.userId,
      roleKey: 'member', createdBy: outsider.user.userId });
    expect((await f.request('GET', path, undefined, outsider.accessToken)).status).toBe(200);
    const native = await f.nativeToken(outsider.accessToken, 'openid profile');
    expect((await f.request('GET', path, undefined, native)).status).toBe(404);
    expect((await download(f, own.asset.deliveryPath, native)).status).toBe(404);
    // Subject status is an independent ceiling even while the shared membership is live.
    // Keep a second owner in the subject's original organization so its lifecycle guard permits suspension.
    f.auth.getTenancyService()!.addMembership({ tenantId: subject.tenant.tenantId, userId: outsider.user.userId,
      roleKey: 'owner', createdBy: subject.user.userId });
    expect(f.auth.getTenancyService()!.getMembership(outsider.tenant.tenantId, subject.user.userId)?.status).toBe('active');
    f.auth.getStore()!.updateUser(subject.user.userId, { status: 'suspended' });
    expect((await f.request('GET', path, undefined, outsider.accessToken)).status).toBe(404);
    expect((await download(f, own.asset.deliveryPath, outsider.accessToken)).status).toBe(404);
    f.auth.getStore()!.updateUser(subject.user.userId, { status: 'active' });
    expect((await f.request('GET', path, undefined, outsider.accessToken)).status).toBe(200);
    // A live subject likewise cannot bypass a suspended shared membership.
    f.auth.getTenancyService()!.suspendMembership(member.membershipId);
    expect((await f.request('GET', path, undefined, outsider.accessToken)).status).toBe(404);
    expect((await download(f, own.asset.deliveryPath, outsider.accessToken)).status).toBe(404);
  });

  test('relationship revocation during provider acquisition or a held stream read releases no private image body', async () => {
    for (const phase of ['provider', 'chunk'] as const) {
      const f = await fixture(true, 'single', false, { policy: relationshipPolicy() }); relationships(f);
      const subject = await f.register(`held-${phase}-subject`), viewer = await f.register(`held-${phase}-viewer`);
      const own = await prepare(f, subject.accessToken, 1);
      f.db.insert('avatar_peer_reads', { id: 'owned-permission', viewer_id: viewer.user.userId, subject_id: subject.user.userId, scope_id: 'application', active: 1 });
      const gate = phase === 'provider' ? f.blockRead() : f.blockChunk(), pending = download(f, own.asset.deliveryPath, viewer.accessToken);
      try {
        await gate.started; f.db.update('avatar_peer_reads', 'owned-permission', { active: 0 });
        gate.release(); const rejected = await pending;
        expect(rejected.status).toBe(404); expect(rejected.headers.get('content-type')).not.toBe('image/webp');
        expect(await rejected.json()).toMatchObject({ code: 'AUTH_AVATAR_IMAGE_UNAVAILABLE' });
        expect((await download(f, own.asset.deliveryPath, viewer.accessToken)).status).toBe(404);
      } finally { gate.release(); await pending; }
    }
  });

  test('peer presentation revision advances on replacement/removal and no retired asset URL remains readable', async () => {
    const f = await fixture(true, 'single', false, { policy: { id: 'current-revisions', version: '1', authorize: () => true } });
    const subject = await f.register('revision-subject'), viewer = await f.register('revision-viewer');
    const first = await prepare(f, subject.accessToken, 1), path = `/auth/profile/avatar/users/${subject.user.userId}`;
    expect((await f.request('GET', path, undefined, viewer.accessToken)).body).toMatchObject({ revision: 2, asset: first.asset });
    const next = await prepare(f, subject.accessToken, 2);
    expect(next.asset.id).not.toBe(first.asset.id);
    expect((await f.request('GET', path, undefined, viewer.accessToken)).body).toMatchObject({ revision: 3, asset: next.asset });
    expect((await download(f, first.asset.deliveryPath, viewer.accessToken)).status).toBe(404);
    const accepted = await download(f, next.asset.deliveryPath, viewer.accessToken); expect(accepted.status).toBe(200); await accepted.arrayBuffer();
    expect((await f.request('DELETE', '/auth/profile/avatar', { expectedRevision: 3 }, subject.accessToken)).status).toBe(200);
    expect((await f.request('GET', path, undefined, viewer.accessToken)).body).toMatchObject({ revision: 4, asset: null });
    expect((await download(f, next.asset.deliveryPath, viewer.accessToken)).status).toBe(404);
  });

  test('policy version A→B→A retires a held delivery and cannot reactivate the original avatar runtime', async () => {
    const a: AuthUserAvatarReadPolicy = { id: 'generation-bound-read', version: '1', authorize: () => true };
    const f = await fixture(true, 'single', false, { policy: a });
    const subject = await f.register('generation-subject'), viewer = await f.register('generation-viewer');
    const own = await prepare(f, subject.accessToken, 1), gate = f.blockRead(), pending = download(f, own.asset.deliveryPath, viewer.accessToken);
    try {
      await gate.started;
      const b = reconcileUserProfilePolicy(f.db, f.auth.getStore()!, normalizeAuthUserProfile({ avatars: true }), null, undefined, { id: a.id, version: '2' });
      b.assertCurrent(); expect(f.avatars.capabilities().state).toBe('blocked');
      const restored = reconcileUserProfilePolicy(f.db, f.auth.getStore()!, normalizeAuthUserProfile({ avatars: true }), null, undefined, a);
      restored.assertCurrent(); expect(b.assertCurrent).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_POLICY_CHANGED' }));
      gate.release(); const rejected = await pending;
      expect(rejected.status).not.toBe(200); expect(rejected.headers.get('content-type')).not.toBe('image/webp');
      expect(f.avatars.capabilities().state).toBe('blocked');
      expect((await f.request('GET', `/auth/profile/avatar/users/${subject.user.userId}`, undefined, viewer.accessToken)).status).not.toBe(200);
      expect((await download(f, own.asset.deliveryPath, viewer.accessToken)).status).not.toBe(200);
      expect((await f.request('GET', '/auth/me', undefined, viewer.accessToken)).status).toBe(200);
    } finally { gate.release(); await pending; }
  });
});
