/** Actual managed composition, native HTTP, private Storage and actor restart. Synthetic identities only. */
import { expect, test } from 'bun:test';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createApp } from '../frontend/server/app-factory';
import type { AppConfig } from '../frontend/server/types';
import { defineZeroPlugin } from '../frontend/server/server-extensions';
import type { ServerRouteServices } from '../frontend/server/server-services';
import { createMessagingClient } from '../frontend/client/messaging-client';
import type { FetchInit } from '../frontend/client/sdk';
import type { UserAvatarDirectoryEntry, UserAvatarSnapshot, UserAvatarStage } from '../auth/auth-user-avatar-types';
import type { AuthUserAvatarReadContext } from '../auth/auth-user-avatar-read-policy';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import type { ConversationRecord, MessagingDirectoryEntry, MessagingPerson } from './contracts';
import type { MessagingRelationshipContext } from './relationship-policy';

const PASSWORD = 'Synthetic-private-avatar-password-123';
const MEMBERS = 'fixture_photo_members', ROSTER = 'fixture_photo_roster';

async function requireExternalTemporaryStorage(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const temporary = resolve(tmpdir()), bank = '/Volumes/code-bank';
  if (!temporary.startsWith(bank + '/tmp/scratch/zero-platform/')) throw new Error('Set TMPDIR to the external Zero scratch run directory. No internal fixture fallback is allowed.');
  if (await realpath(bank) !== bank || (await stat(bank)).dev === (await stat(homedir())).dev) throw new Error('The external development volume is unavailable.');
  await mkdir(temporary, { recursive: true });
  if (await realpath(temporary) !== temporary) throw new Error('The synthetic temporary root must be a physical external directory.');
}

/** Native HTTP peers use the same platform routes without creating browser Client singletons. */
function identity(origin: () => string) {
  let token: string | null = null, id = '';
  const raw = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); if (token) headers.set('Authorization', 'Bearer ' + token);
    return fetch(origin() + path, { ...init, headers });
  };
  const request = async <T>(path: string, init: FetchInit = {}): Promise<T> => {
    const headers = new Headers(init.headers as HeadersInit);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await raw(path, { method: init.method, signal: init.signal, headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    if (!response.ok) {
      const failure = await response.json() as { code?: string };
      throw Object.assign(new Error('Synthetic native request was rejected.'), { status: response.status, code: failure.code });
    }
    return init.json === false ? response as T : await response.json() as T;
  };
  const messaging = createMessagingClient(request, raw);
  return { messaging, raw, request, get id() { return id; },
    async register(username: string) {
      const result = await request<{ accessToken: string; user: { userId: string } }>('/auth/register', { method: 'POST',
        body: { username, email: username + '@example.test', password: PASSWORD, firstName: username } });
      token = result.accessToken; id = result.user.userId;
    },
    async replace(revision: number, color: string): Promise<UserAvatarSnapshot> {
      const stage = await request<UserAvatarStage>('/auth/profile/avatar/stages', { method: 'POST', body: { expectedRevision: revision } });
      const image = await sharp({ create: { width: 84, height: 76, channels: 3, background: color } }).png().toBuffer();
      const uploaded = await raw('/storage/upload-grants/' + encodeURIComponent(stage.upload.token), {
        method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Uint8Array.from(image) });
      expect(uploaded.status).toBe(201); await uploaded.arrayBuffer();
      return request('/auth/profile/avatar/stages/' + stage.id + '/finalize', { method: 'POST', body: { receipt: stage.receipt } });
    },
    directory(subjectId: string) { return request<UserAvatarDirectoryEntry>('/auth/profile/avatar/users/' + encodeURIComponent(subjectId)); },
    close() { messaging.clear(); token = null; },
  };
}

function photoPolicy(context: AuthUserAvatarReadContext): boolean {
  if (!context.allows(context.viewerId, 'user') || !context.allows(context.subjectId, 'user')) return false;
  const viewer = context.db.get(MEMBERS, context.viewerId), subject = context.db.get(MEMBERS, context.subjectId);
  if (viewer?.active !== 1 || subject?.active !== 1) return false;
  return viewer.house_id === subject.house_id
    || context.allows(context.viewerId, { properties: { avatarRoster: true } })
      && context.db.get(ROSTER, context.viewerId + ':' + context.subjectId)?.active === 1;
}

function houseRelationships({ db, allows }: MessagingRelationshipContext) {
  const members = db.query(MEMBERS).filter(row => row.active === 1 && allows(String(row.id)));
  const houses = [...new Set(members.map(row => String(row.house_id)))].sort();
  const direct = members.filter(row => row.kind === 'resident').flatMap(resident => members
    .filter(staff => staff.kind === 'staff' && staff.house_id === resident.house_id)
    .map(staff => ({ users: [String(resident.id), String(staff.id)] as [string, string], epoch: String(resident.epoch) + ':' + String(staff.epoch) })));
  return { direct, groups: houses.map(house => ({ id: house, name: house === 'house-one' ? 'First house' : 'Second house',
    members: members.filter(row => row.house_id === house).map(row => ({ id: String(row.id), epoch: String(row.epoch) })) })) };
}

async function until(ready: () => boolean, purpose: string, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!ready()) { if (Date.now() >= deadline) throw new Error('Synthetic managed avatar deadline: ' + purpose); await Bun.sleep(20); }
}

test('managed private avatars follow live house/roster audiences, independent DM admission, photo revisions and restart', async () => {
  await requireExternalTemporaryStorage();
  const owned = await ownedWorkerFixture('managed-private-avatars');
  let app: Awaited<ReturnType<typeof createApp>> | undefined, zero!: ServerRouteServices, origin = '';
  const peers: ReturnType<typeof identity>[] = [], watches: Array<() => void> = [];
  let closed = false, incompleteStart = false;
  try {
    await mkdir(join(owned.root, 'app'));
    const configuration: AppConfig = { projectRoot: owned.root,
      db: { mode: 'file', path: join(owned.root, 'app.sqlite'), synchronous: 'FULL' },
      systemDb: { mode: 'file', path: join(owned.root, 'system.sqlite'), synchronous: 'FULL' },
      tables: {
        [MEMBERS]: { id: 'TEXT PRIMARY KEY', house_id: 'TEXT NOT NULL', kind: 'TEXT NOT NULL', epoch: 'TEXT NOT NULL', active: 'INTEGER NOT NULL' },
        [ROSTER]: { id: 'TEXT PRIMARY KEY', active: 'INTEGER NOT NULL' },
      },
      auth: { bootstrap: 'public', userProfile: { avatars: { enabled: true, outputSize: 64 } },
        userProperties: { avatarRoster: { type: 'boolean', default: false, editableBy: 'system', useInPolicies: true } },
        userAvatarReadPolicy: { id: 'synthetic-managed-private-photos', version: '1', authorize: photoPolicy } },
      messaging: { rootDirectory: join(owned.root, 'messaging'), relationships: houseRelationships,
        actors: { launch: { kind: 'source', entrypoint: fileURLToPath(new URL('./actor-entry.ts', import.meta.url)) },
          env: { TMPDIR: tmpdir(), BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' } } },
      logging: false, workflows: false, jobs: false, workers: false, email: false, ai: false, vector: false, pdf: false, kv: false,
      migrate: true, stateSync: false, appDir: join(owned.root, 'app'), outDir: join(owned.root, 'out'),
      generatedDir: join(owned.root, 'generated'), storageDir: join(owned.root, 'storage'),
      themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
      observability: { console: false, endpoint: false, store: new MemoryEventStore({ maxEvents: 100 }) },
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
      serverExtensions: [defineZeroPlugin({ name: 'managed-private-avatar-fixture', setup(context) { zero = context.zero; } })],
    };
    const start = async () => {
      incompleteStart = true;
      app = await createApp(configuration); incompleteStart = false;
      app.listen({ hostname: '127.0.0.1', port: 0 });
      origin = 'http://127.0.0.1:' + app.server!.port;
    };
    await start();
    const staff = identity(() => origin), resident = identity(() => origin), housemate = identity(() => origin),
      unrelated = identity(() => origin), former = identity(() => origin), rosterStaff = identity(() => origin);
    peers.push(staff, resident, housemate, unrelated, former, rosterStaff);
    for (const [client, name, house, kind, active] of [
      [staff, 'photo-assigned-staff', 'house-one', 'staff', 1], [resident, 'photo-resident', 'house-one', 'resident', 1],
      [housemate, 'photo-housemate', 'house-one', 'resident', 1], [unrelated, 'photo-unrelated', 'house-two', 'resident', 1],
      [former, 'photo-former', 'house-one', 'resident', 0], [rosterStaff, 'photo-roster-staff', 'house-two', 'staff', 1],
    ] as const) {
      await client.register(name);
      zero.db.createStrict(MEMBERS, { id: client.id, house_id: house, kind, epoch: name + '-admission', active });
    }
    const residentPhoto = await resident.replace(1, '#335577'), firstHousemate = await housemate.replace(1, '#883344'), firstStaff = await staff.replace(1, '#336655');
    expect(firstHousemate.asset).not.toBeNull(); expect(firstHousemate.publicAsset).toBeNull();
    const copied = firstHousemate.asset!.deliveryPath;
    const photo = await resident.raw(copied);
    expect(photo.status).toBe(200); expect(photo.headers.get('cache-control')).toContain('no-store');
    expect(photo.headers.get('cross-origin-resource-policy')).toBe('same-origin'); expect(photo.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await sharp(new Uint8Array(await photo.arrayBuffer())).metadata()).format).toBe('webp');
    expect((await resident.directory(housemate.id)).revision).toBe(2);
    expect((await fetch(origin + copied)).status).toBe(401);
    for (const denied of [unrelated, former]) {
      await expect(denied.directory(housemate.id)).rejects.toMatchObject({ status: 404 });
      expect((await denied.raw(copied)).status).toBe(404);
    }
    await expect(housemate.request('/auth/profile/avatar/publication', { method: 'POST', body: { expectedRevision: 2 } })).rejects.toMatchObject({ code: 'AUTH_AVATAR_PUBLIC_DISABLED' });

    const directory = (await resident.messaging.directory()).items;
    expect(directory.map(item => item.id)).toEqual([staff.id]);
    expect(directory[0]?.privateAvatar).toEqual({ revision: 2, asset: firstStaff.asset });
    expect(directory[0]?.avatarUrl).toBeNull();
    await expect(resident.messaging.conversations.create({ userIds: [housemate.id] }, { requestId: 'housemate-is-not-dm-target' })).rejects.toMatchObject({ status: 404 });
    const house = (await resident.messaging.conversations.list()).items.find(item => item.title === 'First house')!;
    expect(house.participants.map(item => item.id).sort()).toEqual([resident.id, staff.id, housemate.id].sort());
    const people = (await resident.messaging.conversations.people(house.id)).items;
    expect(people.find(item => item.id === housemate.id)?.privateAvatar).toEqual({ revision: 2, asset: firstHousemate.asset });
    const direct = await resident.messaging.conversations.create({ userIds: [staff.id] }, { requestId: 'photo-staff-direct' });
    expect(direct.participants.find(item => item.id === staff.id)?.privateAvatar).toEqual({ revision: 2, asset: firstStaff.asset });
    await housemate.messaging.messages.send(house.id, { text: 'Synthetic housemate with a private photo' }, { requestId: 'photo-house-message' });
    expect((await resident.messaging.messages.list(house.id)).items[0]?.authorId).toBe(housemate.id);

    let livePeople: readonly MessagingPerson[] = [], liveDirectory: readonly MessagingDirectoryEntry[] = [], liveConversations: readonly ConversationRecord[] = [];
    watches.push(resident.messaging.watchPeople!(house.id, page => { livePeople = page.items; }),
      resident.messaging.watchDirectory!(page => { liveDirectory = page.items; }),
      resident.messaging.watchConversations!(page => { liveConversations = page.items; }));
    await until(() => livePeople.some(item => item.id === housemate.id) && liveDirectory.some(item => item.id === staff.id)
      && liveConversations.some(item => item.id === direct.id), 'initial admitted projections');
    const replaced = await housemate.replace(2, '#223388');
    await until(() => livePeople.find(item => item.id === housemate.id)?.privateAvatar?.asset?.id === replaced.asset!.id, 'cross-session housemate replacement');
    expect((await resident.raw(copied)).status).toBe(404);
    const removed = await housemate.request<UserAvatarSnapshot>('/auth/profile/avatar', { method: 'DELETE', body: { expectedRevision: 3 } });
    expect(removed).toMatchObject({ revision: 4, asset: null });
    await until(() => livePeople.find(item => item.id === housemate.id)?.privateAvatar?.revision === 4
      && livePeople.find(item => item.id === housemate.id)?.privateAvatar?.asset === null, 'cross-session photo removal');
    expect((await resident.raw(replaced.asset!.deliveryPath)).status).toBe(404);
    const staffReplacement = await staff.replace(2, '#994422');
    await until(() => liveDirectory.find(item => item.id === staff.id)?.privateAvatar?.asset?.id === staffReplacement.asset!.id
      && liveConversations.find(item => item.id === direct.id)?.participants.find(item => item.id === staff.id)?.privateAvatar?.asset?.id === staffReplacement.asset!.id,
    'cross-session contact and direct preview replacement');
    expect((await resident.raw(firstStaff.asset!.deliveryPath)).status).toBe(404);
    const restored = await housemate.replace(4, '#448899');
    await until(() => livePeople.find(item => item.id === housemate.id)?.privateAvatar?.revision === 5, 'restored current photo');

    for (const stop of watches.splice(0)) stop(); for (const client of peers) client.messaging.clear();
    await app!.stop(true); app = undefined; await start();
    expect((await resident.directory(housemate.id))).toMatchObject({ revision: 5, asset: restored.asset });
    const afterRestart = await resident.raw(restored.asset!.deliveryPath); expect(afterRestart.status).toBe(200); await afterRestart.arrayBuffer();
    expect((await resident.raw(copied)).status).toBe(404); expect((await resident.raw(replaced.asset!.deliveryPath)).status).toBe(404);
    expect((await resident.messaging.conversations.people(house.id)).items.find(item => item.id === housemate.id)?.privateAvatar).toEqual({ revision: 5, asset: restored.asset });

    zero.db.createStrict(ROSTER, { id: rosterStaff.id + ':' + housemate.id, active: 1 });
    await expect(rosterStaff.directory(housemate.id)).rejects.toMatchObject({ status: 404 });
    zero.auth.store!.setProperty(rosterStaff.id, 'avatarRoster', 'true');
    expect((await rosterStaff.directory(housemate.id)).asset?.id).toBe(restored.asset!.id);
    const rosterPhoto = await rosterStaff.raw(restored.asset!.deliveryPath); expect(rosterPhoto.status).toBe(200); await rosterPhoto.arrayBuffer();
    zero.db.update(ROSTER, rosterStaff.id + ':' + housemate.id, { active: 0 });
    expect((await rosterStaff.raw(restored.asset!.deliveryPath)).status).toBe(404);

    let retired = false;
    watches.push(resident.messaging.watchPeople!(house.id, () => {}, { onError: () => { retired = true; } }));
    zero.db.update(MEMBERS, resident.id, { house_id: 'house-two', epoch: 'resident-transferred-admission' });
    await until(() => retired, 'former house projection retirement');
    await expect(resident.directory(housemate.id)).rejects.toMatchObject({ status: 404 });
    expect((await resident.raw(restored.asset!.deliveryPath)).status).toBe(404);
    expect((await resident.raw(staffReplacement.asset!.deliveryPath)).status).toBe(404);
    expect((await staff.raw(residentPhoto.asset!.deliveryPath)).status).toBe(404);
    await expect(resident.messaging.conversations.people(house.id)).rejects.toMatchObject({ status: 404 });
    await expect(resident.messaging.conversations.get(direct.id)).rejects.toMatchObject({ status: 404 });
    expect((await resident.messaging.directory()).items.map(item => item.id)).toEqual([rosterStaff.id]);
    const ownPhoto = await resident.raw(residentPhoto.asset!.deliveryPath); expect(ownPhoto.status).toBe(200); await ownPhoto.arrayBuffer();
  } finally {
    for (const stop of watches) stop(); for (const client of peers) client.close();
    try { await app?.stop(true); closed = !incompleteStart; }
    finally {
      if (closed) await owned.cleanup();
      else console.error('Retained owned synthetic avatar fixture because app closure was not proven: ' + owned.root);
    }
  }
}, 120000);
