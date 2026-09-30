/**
 * Adversarial coverage for createApp's framework-table Sync boundary.
 *
 * These tests intentionally use a raw WebSocket and request table names a
 * normal SDK user would never request directly.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenService } from '../../auth/token-service';
import type { UserRecord } from '../../auth/types';
import type { UserStore } from '../../auth/user-store';
import type { RoomService } from '../../rooms/room-service';
import type { StorageService } from '../../storage/storage-service';
import {
  authenticatedOnly,
  defineResource,
  defineResourceFields,
} from '../../resources';
import { defineTable, field } from '../../schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type {
  ServerMessage,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccessContext,
} from '../../sync/types';
import { createApp } from './app-factory';
import { PlatformSyncPolicyService } from './platform-sync-policy';

type ZeroApp = Awaited<ReturnType<typeof createApp>>;

interface TestIdentity {
  user: UserRecord;
  token: string;
}

interface SyncConnection {
  ws: WebSocket;
  messages: ServerMessage[];
  waitForMessage(
    predicate: (message: ServerMessage) => boolean,
    timeout?: number,
    description?: string,
  ): Promise<ServerMessage>;
  waitForClose(
    timeout?: number,
    description?: string,
  ): Promise<CloseEvent>;
  close(): Promise<void>;
}

interface PlatformTestServices {
  appDB: ReactiveDB;
  systemDB: ReactiveDB;
  authStore: UserStore;
  tokenService: TokenService;
  rooms: RoomService;
  storage: StorageService;
}

interface PlatformServiceProbe {
  path: string;
  read(): PlatformTestServices | null;
}

let app: ZeroApp | null = null;
let tempRoot: string | null = null;
let syncUrl = '';
let testServices: PlatformTestServices | null = null;
let first: TestIdentity;
let second: TestIdentity;
let admin: TestIdentity;
const openConnections = new Set<SyncConnection>();

const todosTable = defineTable('todos', {
  title: field.text({ required: true }),
  secret: field.text(),
  owner_user_id: field.guardianUser({ required: false }),
}, { pk: 'todo_id' });

beforeAll(async () => {
  const zeroDir = join(process.cwd(), '.zero');
  await mkdir(zeroDir, { recursive: true });
  tempRoot = await mkdtemp(join(zeroDir, 'platform-sync-policy-'));
  const appDir = join(tempRoot, 'app');
  await mkdir(appDir, { recursive: true });

  app = await createApp({
    db: { mode: 'memory', ringBufferDepth: 500 },
    tables: {
      todos: todosTable.serverTable,
    },
    resources: [defineResource({
      table: 'todos',
      exposure: 'all',
      fields: defineResourceFields({
        read: ['todo_id', 'title'],
        create: ['title'],
        update: ['title'],
      }),
      policy: authenticatedOnly(),
    })],
    auth: true,
    appDir,
    outDir: join(tempRoot, 'out'),
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    resourceRoutes: false,
    observability: false,
    email: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
    migrate: false,
  });
  const serviceProbe = installPlatformServiceProbe(app);
  app.listen(0);
  testServices = await waitForPlatformServices(app, serviceProbe);
  syncUrl = `ws://localhost:${app.server!.port}/sync`;

  first = await createIdentity('first', 'user');
  second = await createIdentity('second', 'user');
  admin = await createIdentity('platform-admin', 'admin');
  const { appDB, systemDB } = requirePlatformServices();
  expect(appDB).not.toBe(systemDB);
  expect(appDB.hasTable('todos')).toBe(true);
  // Anchor infrastructure is physically present for local FKs, but remains
  // outside ReactiveDB's application-table catalog and generic Sync surface.
  for (const privateTable of identityMirrorTables()) {
    expect(hasPhysicalTable(appDB, privateTable)).toBe(true);
    expect(appDB.hasTable(privateTable)).toBe(false);
  }
  expect(tableColumns(appDB, 'users')).toEqual(['user_id']);
  expect(tableColumns(appDB, 'tenant_memberships')).toEqual([
    'membership_id',
    'tenant_id',
    'user_id',
  ]);
  expect(appDB.prepare('SELECT user_id FROM users ORDER BY user_id').all())
    .toEqual(expect.arrayContaining([
      { user_id: first.user.userId },
      { user_id: second.user.userId },
      { user_id: admin.user.userId },
    ]));
  for (const systemOnlyTable of [
    'user_properties',
    '_credentials',
    '_refresh_tokens',
    '_auth_tenants',
    '_auth_tenant_memberships',
    '_auth_api_keys',
  ]) {
    expect(hasPhysicalTable(appDB, systemOnlyTable)).toBe(false);
  }
  expect(appDB.hasTable('notifications')).toBe(false);
  expect(appDB.hasTable('rooms')).toBe(false);
  expect(appDB.hasTable('workflow_instances')).toBe(false);
  expect(appDB.hasTable('storage_objects')).toBe(false);
  expect(systemDB.hasTable('todos')).toBe(false);
  expect(systemDB.hasTable('users')).toBe(true);
  expect(systemDB.hasTable('notifications')).toBe(true);
  expect(systemDB.hasTable('rooms')).toBe(true);
  expect(systemDB.hasTable('workflow_instances')).toBe(true);
  expect(systemDB.hasTable('storage_objects')).toBe(true);
  seedPlatformRows();
}, 30_000);

afterAll(async () => {
  await withTimeout(
    Promise.all([...openConnections].map((connection) => connection.close())),
    5_000,
    'platform Sync test client cleanup',
  );
  if (app) {
    await withTimeout(app.stop(true), 5_000, 'platform Sync test app stop');
  }
  app = null;
  testServices = null;
  if (tempRoot) {
    await withTimeout(
      rm(tempRoot, { recursive: true, force: true }),
      5_000,
      'platform Sync test directory cleanup',
    );
  }
  tempRoot = null;
}, 30_000);

describe('createApp framework-table Sync policy', () => {
  test('scopes snapshots, catchup, and live delivery without narrowing app tables', async () => {
    let userConnection = await connectSync(syncUrl, first.token);
    subscribe(userConnection, 0);
    const userAppSnapshot = await userConnection.waitForMessage(
      (message) => message.type === 'sync.snapshot'
        && message.plane !== 'system',
    );
    const userSystemSnapshot = await userConnection.waitForMessage(
      (message) => message.type === 'sync.snapshot'
        && message.plane === 'system',
    );
    expect(userAppSnapshot.type).toBe('sync.snapshot');
    expect(userSystemSnapshot.type).toBe('sync.snapshot');
    if (userAppSnapshot.type !== 'sync.snapshot'
      || userSystemSnapshot.type !== 'sync.snapshot') {
      throw new Error('Expected application and system snapshots');
    }

    expect(Object.keys(userAppSnapshot.tables.todos ?? {}).sort()).toEqual([
      'todo-1',
      'todo-2',
    ]);
    expect(userAppSnapshot.tables.todos?.['todo-1']).toEqual({
      todo_id: 'todo-1',
      title: 'First app row',
    });
    expect(userAppSnapshot.tables.notifications).toBeUndefined();
    expect(userSystemSnapshot.tables.todos).toBeUndefined();
    expect(userSystemSnapshot.tables.users).toBeUndefined();
    expect(userSystemSnapshot.tables.workflow_definitions).toBeUndefined();
    expect(Object.keys(userSystemSnapshot.tables.notifications ?? {}).sort()).toEqual([
      'notification-all',
      'notification-first',
      'notification-role-user',
      'notification-users-first',
    ]);
    expect(Object.keys(userSystemSnapshot.tables.notification_receipts ?? {})).toEqual([
      'receipt-first',
    ]);
    expect(Object.keys(userSystemSnapshot.tables.rooms ?? {}).sort()).toEqual([
      'room-first',
      'room-shared',
    ]);
    expect(Object.keys(userSystemSnapshot.tables.room_members ?? {}).sort()).toEqual([
      'member-first-owner',
      'member-first-second',
      'member-shared-first',
      'member-shared-owner',
    ]);
    expect(Object.keys(userSystemSnapshot.tables.workflow_instances ?? {})).toEqual([
      'workflow-first',
    ]);
    expect(Object.keys(userSystemSnapshot.tables.workflow_steps ?? {})).toEqual([
      'step-first',
    ]);
    expect(Object.keys(userSystemSnapshot.tables.workflow_events ?? {})).toEqual([
      'event-first',
    ]);
    for (const privateTable of identityMirrorTables()) {
      expect(userAppSnapshot.tables[privateTable]).toBeUndefined();
      expect(userSystemSnapshot.tables[privateTable]).toBeUndefined();
    }
    await assertIdentityMirrorMutationsRejected(userConnection);

    const adminConnection = await connectSync(syncUrl, admin.token);
    subscribe(adminConnection, 0);
    const adminSnapshot = await adminConnection.waitForMessage(
      (message) => message.type === 'sync.snapshot'
        && message.plane === 'system',
    );
    expect(adminSnapshot.type).toBe('sync.snapshot');
    if (adminSnapshot.type !== 'sync.snapshot') throw new Error('Expected admin snapshot');

    // Notifications remain target-only and rooms remain membership-only even
    // for the legacy global admin role. Workflow compatibility keeps its
    // explicit platform-admin bypass.
    expect(Object.keys(adminSnapshot.tables.notifications ?? {}).sort()).toEqual([
      'notification-all',
      'notification-role-admin',
    ]);
    expect(Object.keys(adminSnapshot.tables.rooms ?? {})).toEqual(['room-admin']);
    expect(Object.keys(adminSnapshot.tables.workflow_instances ?? {}).sort()).toEqual([
      'workflow-first',
      'workflow-second',
    ]);
    await adminConnection.close();

    const { appDB, systemDB } = requirePlatformServices();

    // Moving a row out of target scope must remove it from the client; moving
    // another row in must upsert it. This exercises live previous-row policy.
    systemDB.update('notifications', 'notification-first', {
      target_value: second.user.userId,
    });
    const movedOut = await userConnection.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'notification-first'
        && message.op === 'DELETE',
    );
    expect(movedOut.type).toBe('sync.change');

    systemDB.update('notifications', 'notification-second', {
      target_value: first.user.userId,
    });
    const movedIn = await userConnection.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'notification-second'
        && message.op === 'UPDATE',
    );
    expect(movedIn.type).toBe('sync.change');

    insertNotification('notification-live-hidden', 'user', second.user.userId);
    appDB.insert('todos', {
      todo_id: 'todo-live',
      title: 'Visible app change',
      secret: 'must-not-cross-live-sync',
    });
    const projectedLiveChange = await userConnection.waitForMessage(
      (message) => message.type === 'sync.change' && message.rowId === 'todo-live',
    );
    expect(projectedLiveChange).toMatchObject({
      type: 'sync.change',
      row: { todo_id: 'todo-live', title: 'Visible app change' },
    });
    if (projectedLiveChange.type !== 'sync.change') {
      throw new Error('Expected projected live change');
    }
    expect(projectedLiveChange.row).not.toHaveProperty('secret');
    expect(userConnection.messages.some(
      (message) => message.type === 'sync.change'
        && message.rowId === 'notification-live-hidden',
    )).toBe(false);

    // started_by is a service-owned immutable field. Raw clients cannot break
    // the parent-derived child policy by transferring workflow ownership.
    userConnection.ws.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'workflow-owner-transfer',
      table: 'workflow_instances',
      op: 'UPDATE',
      rowId: 'workflow-first',
      row: { started_by: second.user.userId },
    }));
    const transferAck = await userConnection.waitForMessage(
      (message) => message.type === 'sync.ack'
        && message.ref === 'workflow-owner-transfer',
    );
    expect(transferAck).toMatchObject({
      type: 'sync.ack',
      ref: 'workflow-owner-transfer',
      ok: false,
    });
    expect(systemDB.get('workflow_instances', 'workflow-first')?.started_by).toBe(
      first.user.userId,
    );

    // A membership change invalidates the comparable room-read authority at
    // the final send fence. The socket must reconnect with a complete current
    // snapshot; it cannot keep a stale room cache while an incremental
    // membership row happens to cross the wire.
    const rooms = requirePlatformServices().rooms;
    expect(rooms.leave('room-shared', first.user.userId)).toBe(true);
    const revoked = await userConnection.waitForClose(
      3_000,
      'room-membership revocation close',
    );
    expect({ code: revoked.code, reason: revoked.reason }).toEqual({
      code: 4001,
      reason: 'Sync read authority changed',
    });
    systemDB.update('rooms', 'room-shared', { name: 'Revoked room update' });
    expect(userConnection.messages.some(
      (message) => message.type === 'sync.change'
        && message.rowId === 'room-shared',
    )).toBe(false);

    rooms.join('room-second', first.user.userId);
    userConnection = await connectSync(syncUrl, first.token);
    subscribe(userConnection, 0);
    const refreshed = await userConnection.waitForMessage(
      (message) => message.type === 'sync.snapshot'
        && message.plane === 'system',
      3_000,
      'post-membership-change snapshot',
    );
    expect(refreshed.type).toBe('sync.snapshot');
    if (refreshed.type !== 'sync.snapshot') throw new Error('Expected refreshed snapshot');
    // A lastSeq=0 subscription already asks for a complete replacement, so it
    // preserves pending local mutations while returning only current rows.
    expect(refreshed.reset).toBe('preserve-pending');
    expect(refreshed.tables.rooms).not.toHaveProperty('room-shared');
    expect(refreshed.tables.rooms).toHaveProperty('room-second');

    systemDB.update('rooms', 'room-second', { name: 'Admitted room update' });
    const admittedRoomUpdate = await userConnection.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'room-second'
        && message.op === 'UPDATE',
      3_000,
      'admitted room UPDATE',
    );
    expect(admittedRoomUpdate.type).toBe('sync.change');

    // Storage's official hooks are HTTP-backed. Generic Sync therefore denies
    // all storage metadata, including rows the caller could access over the
    // dedicated permission-aware API.
    const storage = requirePlatformServices().storage;
    const hiddenDrive = storage.createDrive(second.user.userId, { name: 'Hidden drive' });
    const ownDrive = storage.createDrive(first.user.userId, { name: 'Own drive' });
    insertStorageObject('object-hidden', hiddenDrive.drive_id, second.user.userId);
    insertStorageObject('object-own', ownDrive.drive_id, first.user.userId);
    appDB.insert('todos', { todo_id: 'todo-storage-sentinel', title: 'Storage sentinel' });
    await userConnection.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'todo-storage-sentinel',
    );
    for (const deniedId of [
      hiddenDrive.drive_id,
      ownDrive.drive_id,
      'object-hidden',
      'object-own',
    ]) {
      expect(userConnection.messages.some(
        (message) => message.type === 'sync.change' && message.rowId === deniedId,
      )).toBe(false);
    }
    await userConnection.close();

    // Establish a current authorization scope after the storage access change,
    // then attempt a reconnect catchup containing mixed framework/app rows.
    const baselineConnection = await connectSync(syncUrl, first.token);
    subscribe(baselineConnection, 0);
    const appBaseline = await baselineConnection.waitForMessage(
      (message) => message.type === 'sync.snapshot'
        && message.plane !== 'system',
    );
    const systemBaseline = await baselineConnection.waitForMessage(
      (message) => message.type === 'sync.snapshot'
        && message.plane === 'system',
    );
    expect(appBaseline.type).toBe('sync.snapshot');
    expect(systemBaseline.type).toBe('sync.snapshot');
    if (appBaseline.type !== 'sync.snapshot'
      || systemBaseline.type !== 'sync.snapshot') {
      throw new Error('Expected application and system baseline snapshots');
    }
    await baselineConnection.close();

    insertNotification('notification-catchup-own', 'user', first.user.userId);
    insertNotification('notification-catchup-hidden', 'user', second.user.userId);
    insertReceipt('receipt-catchup-own', 'notification-catchup-own', first.user.userId);
    insertReceipt('receipt-catchup-hidden', 'notification-catchup-hidden', second.user.userId);
    await createIdentity('catchup-hidden-user', 'user');
    appDB.insert('todos', {
      todo_id: 'todo-catchup',
      title: 'Catchup app row',
      secret: 'must-not-cross-catchup-sync',
    });

    const catchupConnection = await connectSync(syncUrl, first.token);
    subscribe(
      catchupConnection,
      appBaseline.seq,
      appBaseline.epoch,
      appBaseline.scope,
      requestedTables(),
      {
        default: syncCursor(appBaseline),
        system: syncCursor(systemBaseline),
      },
    );
    const appCatchup = await catchupConnection.waitForMessage(
      (message) => message.type === 'sync.catchup'
        && message.plane !== 'system',
    );
    const systemCatchup = await catchupConnection.waitForMessage(
      (message) => message.type === 'sync.catchup'
        && message.plane === 'system',
    );
    expect(appCatchup.type).toBe('sync.catchup');
    expect(systemCatchup.type).toBe('sync.catchup');
    if (appCatchup.type !== 'sync.catchup'
      || systemCatchup.type !== 'sync.catchup') {
      throw new Error('Expected application and system catchup');
    }

    const appCatchupIds = appCatchup.changes.map((change) => change.rowId);
    const systemCatchupIds = systemCatchup.changes.map((change) => change.rowId);
    expect(appCatchupIds).toEqual(['todo-catchup']);
    expect(systemCatchupIds).toContain('notification-catchup-own');
    expect(systemCatchupIds).toContain('receipt-catchup-own');
    expect(systemCatchupIds).not.toContain('notification-catchup-hidden');
    expect(systemCatchupIds).not.toContain('receipt-catchup-hidden');
    expect(systemCatchup.changes.some((change) => change.table === 'users')).toBe(false);
    const projectedCatchupChange = appCatchup.changes.find(
      (change) => change.rowId === 'todo-catchup',
    );
    expect(projectedCatchupChange?.row).toEqual({
      todo_id: 'todo-catchup',
      title: 'Catchup app row',
    });
    await catchupConnection.close();
  });

  test('changes the comparable policy fingerprint when room membership changes', async () => {
    const db = requirePlatformServices().systemDB;
    const delegate: SyncResourcePolicyAdapter = {
      async resolveTableAccess(context: SyncResourceTableAccessContext) {
        return {
          readableTables: new Set(context.tableNames),
          rowFilters: new Map(),
          policyFingerprint: 'delegate',
        };
      },
      async authorizeMutation() {
        return { ok: true };
      },
    };
    const policy = new PlatformSyncPolicyService({
      delegate,
      getDB: () => db,
    });
    const stopObserving = db.onChange((change) => policy.observeChange(change));
    const context = {
      tableNames: ['rooms', 'room_members'],
      authContext: {
        userId: first.user.userId,
        email: first.user.email,
        role: first.user.role,
      },
    };

    const before = await policy.resolveTableAccess(context);
    requirePlatformServices().rooms.create(first.user.userId, {
      name: 'New membership scope',
    });
    const after = await policy.resolveTableAccess(context);

    expect(after.policyFingerprint).not.toBe(before.policyFingerprint);

    const adminAccess = await policy.resolveTableAccess({
      tableNames: ['rooms'],
      authContext: {
        userId: admin.user.userId,
        email: admin.user.email,
        role: admin.user.role,
      },
    });
    const adminRoomFilter = adminAccess.rowFilters.get('rooms')!;
    expect(adminRoomFilter.matches(db.get('rooms', 'room-first')!)).toBe(false);
    expect(adminRoomFilter.matches(db.get('rooms', 'room-admin')!)).toBe(true);

    // Returning to the same visible room-id set still advances the monotonic
    // authorization generation, so a temporary grant cannot preserve an old
    // client scope through admit → revoke churn.
    const transientRoom = requirePlatformServices().rooms.create(second.user.userId, {
      name: 'Transient membership scope',
    });
    const beforeTransient = await policy.resolveTableAccess(context);
    requirePlatformServices().rooms.join(transientRoom.room_id, first.user.userId);
    const duringTransient = await policy.resolveTableAccess(context);
    expect(duringTransient.policyFingerprint).not.toBe(
      beforeTransient.policyFingerprint,
    );
    expect(requirePlatformServices().rooms.leave(
      transientRoom.room_id,
      first.user.userId,
    )).toBe(true);
    const afterTransient = await policy.resolveTableAccess(context);
    expect(afterTransient.policyFingerprint).not.toBe(
      beforeTransient.policyFingerprint,
    );
    stopObserving();
  });

  test('revokes rooms-only subscribers without requiring room_members delivery', async () => {
    const { systemDB: db, rooms } = requirePlatformServices();
    const revokedRoom = rooms.create(second.user.userId, {
      name: 'Rooms-only revoked scope',
    });
    rooms.join(revokedRoom.room_id, first.user.userId);
    const connection = await connectSync(syncUrl, first.token);

    try {
      subscribe(connection, 0, undefined, undefined, ['rooms']);
      const snapshot = await connection.waitForMessage(
        (message) => message.type === 'sync.snapshot',
      );
      expect(snapshot.type).toBe('sync.snapshot');
      if (snapshot.type !== 'sync.snapshot') throw new Error('Expected snapshot');
      expect(snapshot.tables.rooms).toHaveProperty(revokedRoom.room_id);

      expect(rooms.leave(revokedRoom.room_id, first.user.userId)).toBe(true);
      const revoked = await connection.waitForClose(
        3_000,
        'rooms-only authorization close',
      );
      expect({ code: revoked.code, reason: revoked.reason }).toEqual({
        code: 4001,
        reason: 'Sync access changed',
      });
      db.update('rooms', revokedRoom.room_id, { name: 'Must stay hidden' });
      expect(connection.messages.some(
        (message) => message.type === 'sync.change'
          && message.rowId === revokedRoom.room_id
          && message.op === 'UPDATE',
      )).toBe(false);
    } finally {
      await connection.close();
    }
  });

  test('purges reconnect state after temporary room revoke and regrant', async () => {
    const rooms = requirePlatformServices().rooms;
    const room = rooms.create(second.user.userId, {
      name: 'Reconnect authorization generation',
    });
    rooms.join(room.room_id, first.user.userId);

    const baselineConnection = await connectSync(syncUrl, first.token);
    subscribe(baselineConnection, 0, undefined, undefined, ['rooms']);
    const baseline = await baselineConnection.waitForMessage(
      (message) => message.type === 'sync.snapshot',
    );
    expect(baseline.type).toBe('sync.snapshot');
    if (baseline.type !== 'sync.snapshot') throw new Error('Expected snapshot');
    await baselineConnection.close();

    expect(rooms.leave(room.room_id, first.user.userId)).toBe(true);
    rooms.join(room.room_id, first.user.userId);

    const reconnect = await connectSync(syncUrl, first.token);
    try {
      subscribe(
        reconnect,
        baseline.seq,
        baseline.epoch,
        baseline.scope,
        ['rooms'],
      );
      const replacement = await reconnect.waitForMessage(
        (message) => message.type === 'sync.snapshot',
        3_000,
        'authorization-generation replacement snapshot',
      );
      expect(replacement.type).toBe('sync.snapshot');
      if (replacement.type !== 'sync.snapshot') {
        throw new Error('Expected replacement snapshot');
      }
      expect(replacement.reset).toBe('purge');
      expect(replacement.tables.rooms).toHaveProperty(room.room_id);
      expect(reconnect.messages.some(
        (message) => message.type === 'sync.catchup',
      )).toBe(false);
    } finally {
      await reconnect.close();
    }
  });

  test('keeps each app policy closed over its own database', async () => {
    if (!tempRoot) throw new Error('Missing test root');
    const secondAppDir = join(tempRoot, 'second-app');
    await mkdir(secondAppDir, { recursive: true });
    let secondApp: ZeroApp | null = null;
    let connection: SyncConnection | null = null;

    try {
      secondApp = await createApp({
        db: { mode: 'memory' },
        tables: {
          room_members: {
            member_id: 'text primary key',
            room_id: 'text not null',
            user_id: 'text not null',
          },
        },
        auth: false,
        appDir: secondAppDir,
        outDir: join(tempRoot, 'second-out'),
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        resourceRoutes: false,
        observability: false,
        email: false,
        ai: false,
        vector: false,
        pdf: false,
        kv: false,
        migrate: false,
      });
      secondApp.listen(0);

      connection = await connectSync(syncUrl, first.token);
      subscribe(connection, 0);
      const snapshot = await connection.waitForMessage(
        (message) => message.type === 'sync.snapshot'
          && message.plane === 'system',
      );
      expect(snapshot.type).toBe('sync.snapshot');
      if (snapshot.type !== 'sync.snapshot') throw new Error('Expected snapshot');
      // This row belongs to the first app before any test-local membership
      // churn. Depending on a prior test to admit room-second hid policy/DB
      // isolation regressions behind suite ordering.
      expect(snapshot.tables.rooms).toHaveProperty('room-first');
    } finally {
      await connection?.close();
      await secondApp?.stop(true);
    }
  });
});

function installPlatformServiceProbe(testApp: ZeroApp): PlatformServiceProbe {
  const path = `/__zero_test/platform-services-${crypto.randomUUID()}`;
  let captured: PlatformTestServices | null = null;

  testApp.get(path, (context) => {
    const scoped = context as unknown as {
      syncDB?: ReactiveDB;
      authStore?: UserStore | null;
      tokenService?: TokenService | null;
      roomService?: RoomService | null;
      storageService?: StorageService | null;
    };
    const systemDB = scoped.authStore
      ? serviceDatabase(scoped.authStore)
      : null;
    if (
      scoped.syncDB
      && systemDB
      && scoped.authStore
      && scoped.tokenService
      && scoped.roomService
      && scoped.storageService
    ) {
      expect(serviceDatabase(scoped.roomService)).toBe(systemDB);
      expect(serviceDatabase(scoped.storageService)).toBe(systemDB);
      captured = {
        appDB: scoped.syncDB,
        systemDB,
        authStore: scoped.authStore,
        tokenService: scoped.tokenService,
        rooms: scoped.roomService,
        storage: scoped.storageService,
      };
    }

    return { ready: captured !== null };
  });

  return {
    path,
    read: () => captured,
  };
}

async function waitForPlatformServices(
  testApp: ZeroApp,
  probe: PlatformServiceProbe,
): Promise<PlatformTestServices> {
  for (let attempt = 0; attempt < 100; attempt++) {
    await fetch(`http://localhost:${testApp.server!.port}${probe.path}`);
    const captured = probe.read();
    if (captured?.systemDB.hasTable('workflow_instances')) return captured;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Platform services did not start');
}

/** Test-only confirmation that every mounted built-in shares one system plane. */
function serviceDatabase(service: object): ReactiveDB | null {
  return (service as { db?: ReactiveDB }).db ?? null;
}

function requirePlatformServices(): PlatformTestServices {
  if (!testServices) throw new Error('Platform test services are unavailable');
  return testServices;
}

async function createIdentity(name: string, role: string): Promise<TestIdentity> {
  const { authStore, tokenService } = requirePlatformServices();
  const suffix = crypto.randomUUID();
  const user = await authStore.createUser({
    username: `${name}-${suffix}`,
    email: `${name}-${suffix}@example.test`,
    password: 'password123',
    role,
  });
  const tokens = await tokenService.issueTokenPair(user);
  return { user, token: tokens.accessToken };
}

function seedPlatformRows(): void {
  const appDB = requirePlatformServices().appDB;
  appDB.insert('todos', {
    todo_id: 'todo-1',
    title: 'First app row',
    secret: 'must-not-cross-snapshot-sync',
  });
  appDB.insert('todos', { todo_id: 'todo-2', title: 'Second app row' });

  insertNotification('notification-all', 'all', null);
  insertNotification('notification-first', 'user', first.user.userId);
  insertNotification('notification-second', 'user', second.user.userId);
  insertNotification('notification-users-first', 'users', JSON.stringify([
    first.user.userId,
  ]));
  insertNotification('notification-role-user', 'role', 'user');
  insertNotification('notification-role-admin', 'role', 'admin');
  insertReceipt('receipt-first', 'notification-first', first.user.userId);
  insertReceipt('receipt-second', 'notification-second', second.user.userId);

  requirePlatformServices().systemDB.transaction(() => {
    insertRoom('room-first', first.user.userId);
    insertMember('member-first-owner', 'room-first', first.user.userId, 'owner');
    insertMember('member-first-second', 'room-first', second.user.userId, 'member');
    insertRoom('room-second', second.user.userId);
    insertMember('member-second-owner', 'room-second', second.user.userId, 'owner');
    insertRoom('room-shared', second.user.userId);
    insertMember('member-shared-owner', 'room-shared', second.user.userId, 'owner');
    insertMember('member-shared-first', 'room-shared', first.user.userId, 'member');
    insertRoom('room-admin', admin.user.userId);
    insertMember('member-admin-owner', 'room-admin', admin.user.userId, 'owner');
  });

  insertWorkflowDefinition();
  insertWorkflow('workflow-first', first.user.userId, 'step-first', 'event-first');
  insertWorkflow('workflow-second', second.user.userId, 'step-second', 'event-second');
}

function insertNotification(
  id: string,
  targetType: 'all' | 'user' | 'users' | 'role',
  targetValue: string | null,
): void {
  requirePlatformServices().systemDB.insert('notifications', {
    notification_id: id,
    type: 'info',
    priority: 'normal',
    title: id,
    body: null,
    target_type: targetType,
    target_value: targetValue,
    sender_id: null,
    action_url: null,
    metadata: null,
    created_at: Date.now(),
    expires_at: null,
  });
}

function insertReceipt(id: string, notificationId: string, userId: string): void {
  requirePlatformServices().systemDB.insert('notification_receipts', {
    receipt_id: id,
    notification_id: notificationId,
    user_id: userId,
    seen_at: Date.now(),
    read_at: null,
    dismissed_at: null,
  });
}

function insertRoom(roomId: string, createdBy: string): void {
  requirePlatformServices().systemDB.insert('rooms', {
    room_id: roomId,
    name: roomId,
    type: 'default',
    created_by: createdBy,
    metadata: null,
    max_members: 100,
    created_at: Date.now(),
  });
}

function insertMember(
  memberId: string,
  roomId: string,
  userId: string,
  role: 'owner' | 'member',
): void {
  requirePlatformServices().systemDB.insert('room_members', {
    member_id: memberId,
    room_id: roomId,
    user_id: userId,
    role,
    joined_at: Date.now(),
    metadata: null,
  });
}

function insertWorkflowDefinition(): void {
  requirePlatformServices().systemDB.insert('workflow_definitions', {
    definition_id: 'definition-private',
    name: 'private-definition',
    version: 1,
    steps_json: '[]',
    input_schema: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

function insertWorkflow(
  instanceId: string,
  startedBy: string,
  stepId: string,
  eventId: string,
): void {
  const db = requirePlatformServices().systemDB;
  const now = new Date().toISOString();
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: 'definition-private',
    name: 'private-definition',
    status: 'running',
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: startedBy,
    steps_json: '[]',
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
  db.insert('workflow_steps', {
    step_id: stepId,
    instance_id: instanceId,
    step_index: 0,
    step_name: 'test',
    status: 'running',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: null,
    timeout_at: null,
    started_at: now,
    completed_at: null,
    created_at: now,
  });
  db.insert('workflow_events', {
    event_id: eventId,
    instance_id: instanceId,
    event_name: 'test',
    payload: null,
    sent_by: startedBy,
    created_at: now,
  });
}

function insertStorageObject(id: string, driveId: string, createdBy: string): void {
  requirePlatformServices().systemDB.insert('storage_objects', {
    object_id: id,
    drive_id: driveId,
    parent_id: null,
    name: `${id}.txt`,
    path: `/${id}.txt`,
    type: 'file',
    mime_type: 'text/plain',
    size_bytes: 1,
    checksum: `checksum-${id}`,
    public: 0,
    metadata: '{}',
    created_by: createdBy,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
}

function subscribe(
  connection: SyncConnection,
  lastSeq: number,
  epoch?: string,
  scope?: string | null,
  tables = requestedTables(),
  cursors?: Partial<Record<'default' | 'system', Readonly<{
    lastSeq: number;
    epoch?: string;
    scope?: string | null;
  }>>>,
): void {
  connection.ws.send(JSON.stringify({
    type: 'sync.subscribe',
    tables,
    snapshot: tables,
    lastSeq,
    ...(epoch ? { epoch } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(cursors ? { cursors } : {}),
  }));
}

function syncCursor(
  snapshot: Extract<ServerMessage, { type: 'sync.snapshot' }>,
): Readonly<{ lastSeq: number; epoch?: string; scope?: string | null }> {
  return {
    lastSeq: snapshot.seq,
    ...(snapshot.epoch === undefined ? {} : { epoch: snapshot.epoch }),
    ...(snapshot.scope === undefined ? {} : { scope: snapshot.scope }),
  };
}

function requestedTables(): string[] {
  return [
    'todos',
    ...identityMirrorTables(),
    'notifications',
    'notification_receipts',
    'rooms',
    'room_members',
    'workflow_definitions',
    'workflow_instances',
    'workflow_steps',
    'workflow_events',
    'storage_drives',
    'storage_objects',
  ];
}

function identityMirrorTables(): string[] {
  return [
    'users',
    'tenant_memberships',
    '_zero_identity_projection_state',
    '_zero_identity_projection_receipts',
  ];
}

async function assertIdentityMirrorMutationsRejected(
  connection: SyncConnection,
): Promise<void> {
  for (const table of identityMirrorTables()) {
    const ref = `private-mirror-${table}`;
    connection.ws.send(JSON.stringify({
      type: 'sync.mutate',
      ref,
      table,
      op: 'DELETE',
      rowId: 'must-not-change',
    }));
    expect(await connection.waitForMessage(
      (message) => message.type === 'sync.ack' && message.ref === ref,
    )).toMatchObject({
      type: 'sync.ack',
      ref,
      ok: false,
    });
  }
}

function tableColumns(db: ReactiveDB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

function hasPhysicalTable(db: ReactiveDB, table: string): boolean {
  return Boolean(db.prepare(
    'SELECT 1 FROM sqlite_schema WHERE type = \'table\' AND name = ? LIMIT 1',
  ).get(table));
}

async function connectSync(url: string, token: string): Promise<SyncConnection> {
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data) as ServerMessage;
      messages.push(message);
      for (let index = waiters.length - 1; index >= 0; index--) {
        if (!waiters[index].predicate(message)) continue;
        waiters[index].resolve(message);
        waiters.splice(index, 1);
      }
    } catch {}
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  let closePromise: Promise<void> | null = null;
  let connection!: SyncConnection;
  const closed = new Promise<CloseEvent>((resolve) => {
    ws.addEventListener('close', (event) => {
      if (connection) openConnections.delete(connection);
      resolve(event);
    }, { once: true });
  });
  connection = {
    ws,
    messages,
    waitForMessage(predicate, timeout = 3_000, description = 'Sync message') {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          timeout,
        );
        waiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timer);
            resolve(message);
          },
        });
      });
    },
    waitForClose(timeout = 3_000, description = 'Sync socket close') {
      return withTimeout(closed, timeout, description);
    },
    close() {
      if (closePromise) return closePromise;
      if (ws.readyState === WebSocket.CLOSED) {
        openConnections.delete(connection);
        return Promise.resolve();
      }
      ws.close();
      closePromise = withTimeout(closed, 2_000, 'Sync socket cleanup close')
        .then(() => undefined, () => {
          openConnections.delete(connection);
        });
      return closePromise;
    },
  };

  ws.send(JSON.stringify({ type: 'sync.auth', token }));
  await connection.waitForMessage((message) => message.type === 'sync.auth.ready');
  openConnections.add(connection);
  return connection;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  description: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          timeout,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
