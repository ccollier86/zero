import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { UserStore } from './user-store';
import { AuthUserAvatarStore } from './auth-user-avatar-store';
import { reconcileUserAvatarSchema } from './auth-user-avatar-schema';
import type { AuthContextAuthorityReference } from './types';

const databases: ReactiveDB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.dispose(); });
async function setup() {
  const db = createReactiveDB({ mode: 'memory' }); databases.push(db); defineAuthTables(db);
  const users = new UserStore(db), user = await users.createUser({ username: 'avatar-owner', email: 'avatar@example.test', password: 'password123' });
  let now = 1_000;
  expect(reconcileUserAvatarSchema(db, true)).toBe('ready');
  const store = new AuthUserAvatarStore(db, users, () => now);
  const allocate = (revision = store.revision(user.userId), id = crypto.randomUUID()) => store.allocate({ id, userId: user.userId,
    expectedRevision: revision, authority: { version: 1, userId: user.userId, sessionId: 'unit-store-family' } as AuthContextAuthorityReference,
    receiptHash: `hash-${id}`, path: `avatars/stages/${id}`, expiresAt: now + 300_000 }, () => {});
  const claim = () => { const stage = allocate(), lease = crypto.randomUUID(); store.claim(stage, lease, () => {});
    const asset = store.allocateAsset(stage.stage_id, lease, crypto.randomUUID(), () => {}); return { stage, lease, asset }; };
  const accept = (item: ReturnType<typeof claim>, fence = () => {}) => store.accept(item.stage.stage_id, item.lease,
    { checksum: 'actual-checksum', byteLength: 120, width: 64, height: 64 }, fence);
  return { db, users, user, store, allocate, claim, accept, setNow: (value: number) => { now = value; } };
}
describe('Guardian avatar immutable SYSTEM receipts', () => {
  test('forbidden schema stays missing and a collision never becomes ready', async () => {
    const db = createReactiveDB({ mode: 'memory' }); databases.push(db); defineAuthTables(db);
    expect(reconcileUserAvatarSchema(db, false)).toBe('missing');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = '_auth_avatar_assets'").get()).toBeNull();
    db.exec('CREATE TABLE _auth_avatar_assets (asset_id TEXT PRIMARY KEY, unsafe TEXT)');
    expect(reconcileUserAvatarSchema(db, true)).toBe('invalid');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = '_auth_avatar_stages'").get()).toBeNull();
  });
  test('one accepted image advances the shared profile revision and immutable pointer exactly once', async () => {
    const f = await setup(); const item = f.claim();
    expect(f.store.current(f.user.userId)).toBeNull();
    expect(f.accept(item)).toBe(2);
    expect(f.store.current(f.user.userId)).toMatchObject({ asset_id: item.asset.asset_id, state: 'current', width: 64 });
    expect(f.store.stage(item.stage.stage_id)?.state).toBe('consumed');
    expect(() => f.accept(item)).toThrow(expect.objectContaining({ code: 'AUTH_AVATAR_STAGE_RETIRED' }));
    expect(f.store.revision(f.user.userId)).toBe(2);
  });
  test('a concurrent core edit defeats late attachment without deleting the previous image', async () => {
    const f = await setup(), first = f.claim(); f.accept(first);
    const second = f.claim(); f.users.updateUser(f.user.userId, { firstName: 'Changed elsewhere' });
    expect(() => f.accept(second)).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_REVISION_CONFLICT' }));
    expect(f.store.current(f.user.userId)?.asset_id).toBe(first.asset.asset_id);
    expect(f.store.asset(second.asset.asset_id)?.state).toBe('pending');
  });
  test('final authority rejection rolls back pointer, profile revision, stage and tracked delivery', async () => {
    const f = await setup(), item = f.claim(); let calls = 0;
    const changes: unknown[] = []; f.db.onChange(change => { changes.push(change); });
    expect(() => f.accept(item, () => { if (++calls === 2) throw new Error('revoked'); })).toThrow('revoked');
    expect(f.store.revision(f.user.userId)).toBe(1); expect(f.store.current(f.user.userId)).toBeNull();
    expect(f.store.asset(item.asset.asset_id)?.state).toBe('pending');
    expect(f.store.stage(item.stage.stage_id)?.state).toBe('processing'); expect(changes).toEqual([]);
  });
  test('expired/claimed receipts and pending assets cannot be used by an older operation', async () => {
    const f = await setup(), item = f.claim();
    expect(() => f.store.claim(item.stage, 'other-lease', () => {})).toThrow(expect.objectContaining({ code: 'AUTH_AVATAR_STAGE_RETIRED' }));
    f.setNow(122_000);
    const cleanup = f.store.claimCleanup();
    expect(cleanup.assets.map(asset => asset.asset_id)).toContain(item.asset.asset_id);
    expect(() => f.store.assertPendingAsset(item.asset.asset_id, item.lease)).toThrow(expect.objectContaining({ code: 'AUTH_AVATAR_STAGE_RETIRED' }));
    expect(() => f.accept(item)).toThrow(expect.objectContaining({ code: 'AUTH_AVATAR_STAGE_RETIRED' }));
  });
  test('cleanup excludes current assets and recovers replacements, removals and deleted accounts', async () => {
    const f = await setup(), first = f.claim(); f.accept(first);
    expect(f.store.claimCleanup().assets).toEqual([]);
    const second = f.claim(); f.accept(second);
    const retired = f.store.claimCleanup(); expect(retired.assets.map(asset => asset.asset_id)).toEqual([first.asset.asset_id]);
    f.store.finishAssetCleanup(first.asset.asset_id, retired.lease);
    expect(f.store.asset(first.asset.asset_id)).toBeNull(); expect(f.store.current(f.user.userId)?.asset_id).toBe(second.asset.asset_id);
    expect(f.store.remove(f.user.userId, 3, () => {})).toBe(4);
    expect(f.store.current(f.user.userId)).toBeNull();
    expect(f.store.claimCleanup().assets.map(asset => asset.asset_id)).toEqual([second.asset.asset_id]);
    const third = f.claim(); f.accept(third); f.users.deleteUser(f.user.userId);
    expect(f.store.claimCleanup().assets.map(asset => asset.asset_id)).toContain(third.asset.asset_id);
  });
  test('thenable authority and too many staging allocations fail before row mutation', async () => {
    const f = await setup(); f.allocate(); f.allocate(); f.allocate();
    expect(() => f.allocate()).toThrow(expect.objectContaining({ code: 'AUTH_AVATAR_STAGE_LIMIT' }));
    const retained = f.db.prepare('SELECT stage_id FROM _auth_avatar_stages LIMIT 1').get() as { stage_id: string };
    const item = f.store.stage(retained.stage_id)!;
    expect(() => f.store.claim(item, 'lease', (async () => {}) as never)).toThrow(expect.objectContaining({ code: 'AUTH_STATE_INVARIANT_FAILED' }));
    expect(f.store.stage(item.stage_id)?.state).toBe('allocated');
  });
});
