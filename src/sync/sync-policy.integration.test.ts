/**
 * sync-policy.integration.test.ts
 *
 * Exercises sync policy enforcement through the real WebSocket lifecycle. Unit
 * tests cover helper semantics; this file verifies socket read and mutation
 * behavior stays separated in transport.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { defineAuthTables } from '../auth/auth-schema';
import { UserStore } from '../auth/user-store';
import type { ReactiveDB } from './reactive-db';
import { createSyncPlugin } from './sync.plugin';
import { createDefaultSyncPolicy } from './sync-policy';
import type { ServerMessage, SyncTokenVerifier } from './types';
import {
  adminOnly,
  anyOf,
  defineResource,
  metadataPolicy,
  ownerPolicy,
  ResourceRegistry,
  ResourceSyncPolicyService,
} from '../resources';

interface TestApp {
  stop(): void;
  server: { hostname?: string; port?: number } | null;
}

let app: TestApp | null = null;
const appDatabases = new WeakMap<object, ReactiveDB>();

function bindDatabase<T extends object>(testApp: T, db: ReactiveDB): T {
  if (!db) throw new Error('Sync test database was not created');
  appDatabases.set(testApp, db);
  return testApp;
}

function getAppDatabase(testApp: object): ReactiveDB {
  const db = appDatabases.get(testApp);
  if (!db) throw new Error('Sync test database is not bound to this app');
  return db;
}

function createApp() {
  let db!: ReactiveDB;
  const testApp = new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory', ringBufferDepth: 100 },
        tables: {
          public_docs: {
            id: 'text primary key',
            title: 'text not null',
          },
          readonly_docs: {
            id: 'text primary key',
            title: 'text not null',
          },
          hidden_docs: {
            id: 'text primary key',
            title: 'text not null',
          },
        },
        policy: createDefaultSyncPolicy({
          readProtectedTables: ['hidden_docs'],
          writeProtectedTables: ['readonly_docs'],
        }),
        onDatabaseCreated(created) {
          db = created;
        },
      })
    )
    .listen(0);

  return bindDatabase(testApp, db);
}

function createVerifier(): SyncTokenVerifier {
  return {
    async verifyAccessToken(token: string) {
      if (token === 'user-token') {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      }
      if (token === 'admin-token') {
        return { sub: 'admin-1', email: 'admin@test.local', role: 'admin' };
      }
      return null;
    },
  };
}

function createAuthFilteredApp() {
  const verifier = createVerifier();
  let db!: ReactiveDB;

  const testApp = new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory', ringBufferDepth: 100 },
        tables: {
          public_docs: {
            id: 'text primary key',
            title: 'text not null',
          },
          admin_docs: {
            id: 'text primary key',
            title: 'text not null',
          },
        },
        auth: {
          getTokenVerifier: () => verifier,
          allowLegacyQueryToken: true,
        },
        policy: {
          canReadTable({ table, authContext }) {
            if (table === 'admin_docs' && authContext?.role !== 'admin') {
              return {
                ok: false,
                reason: 'Admin table requires admin sync role',
              };
            }
            return true;
          },
        },
        onDatabaseCreated(created) {
          db = created;
        },
      })
    )
    .listen(0);

  return bindDatabase(testApp, db);
}

function createResourceSyncApp() {
  const verifier = createVerifier();
  let db!: ReactiveDB;
  const tables = {
    tickets: {
      id: 'text primary key',
      title: 'text not null',
      owner_id: 'text not null',
    },
  };
  const registry = new ResourceRegistry();
  registry.register(
    defineResource({
      table: 'tickets',
      policy: {
        list: anyOf(adminOnly(), ownerPolicy({ userField: 'owner_id' })),
        get: anyOf(adminOnly(), ownerPolicy({ userField: 'owner_id' })),
        create: anyOf(adminOnly(), ownerPolicy({ userField: 'owner_id' })),
        update: anyOf(adminOnly(), ownerPolicy({ userField: 'owner_id' })),
        delete: adminOnly(),
      },
    }),
    {
      tables,
      authConfig: { userProperties: {} },
    }
  );

  const testApp = new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory', ringBufferDepth: 100 },
        tables,
        auth: {
          getTokenVerifier: () => verifier,
          allowLegacyQueryToken: true,
        },
        resourcePolicy: new ResourceSyncPolicyService({
          registry,
          authConfig: { userProperties: {} },
        }),
        onDatabaseCreated(created) {
          db = created;
        },
      })
    )
    .listen(0);

  return bindDatabase(testApp, db);
}

function createLocationPolicyApp() {
  const verifier: SyncTokenVerifier = {
    async resolveAuthContext(token) {
      if (!['location-one', 'location-two'].includes(token)) return null;
      const suffix = token === 'location-one' ? 'one' : 'two';
      return { userId: `location-${suffix}`, email: `${suffix}@example.test`, role: 'user' };
    },
    async verifyAccessToken() {
      return null;
    },
  };
  const tables = {
    location_docs: { id: 'text primary key', title: 'text not null' },
  };
  const authConfig = resolveAuthBehaviorConfig({
    userProperties: {
      locations: {
        type: 'enum', values: ['clinic-a', 'clinic-b'],
        editableBy: 'admin', useInPolicies: true,
      },
    },
  });
  const registry = new ResourceRegistry();
  registry.register(defineResource({
    table: 'location_docs', actions: ['list'],
    policy: { list: metadataPolicy({ locations: 'clinic-a' }) },
  }), { tables, authConfig });
  let store: UserStore | null = null;
  let db!: ReactiveDB;
  const pendingApp = new Elysia().use(createSyncPlugin({
    db: { mode: 'memory', ringBufferDepth: 100 }, tables,
    auth: {
      required: true, getTokenVerifier: () => verifier,
      revalidateIntervalMs: 10, allowLegacyQueryToken: true,
    },
    resourcePolicy: new ResourceSyncPolicyService({
      registry, authConfig, getUserStore: () => store,
    }),
    onDatabaseCreated(created) {
      db = created;
    },
  }));
  if (!db) throw new Error('Sync test database was not created');
  defineAuthTables(db);
  store = new UserStore(db);
  for (const suffix of ['one', 'two']) {
    db.prepare(`INSERT INTO users
      (user_id, username, email, role, status, password_change_required,
       email_verification_required, mfa_required, created_at)
      VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?)`)
      .run(`location-${suffix}`, `location-${suffix}`, `${suffix}@example.test`, Date.now());
    store.setProperty(`location-${suffix}`, 'locations', 'clinic-a');
  }
  const testApp = bindDatabase(pendingApp.listen(0), db);
  return { app: testApp, db, store };
}

function getUrl(app: TestApp, token?: string): string {
  const { hostname, port } = app.server!;
  if (typeof port !== 'number') {
    throw new Error('Test server did not expose a port');
  }

  const url = new URL(`ws://${hostname ?? 'localhost'}:${port}/sync`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

async function connectWS(
  url: string
): Promise<{
  ws: WebSocket;
  messages: ServerMessage[];
  waitForMessage: (
    predicate: (msg: ServerMessage) => boolean,
    timeout?: number
  ) => Promise<ServerMessage>;
  close: () => void;
}> {
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
  }> = [];
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;

    try {
      const msg = JSON.parse(event.data) as ServerMessage;
      messages.push(msg);

      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    } catch {}
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  function waitForMessage(
    predicate: (msg: ServerMessage) => boolean,
    timeout = 2000
  ): Promise<ServerMessage> {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout waiting for message')),
        timeout
      );

      waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  }

  return {
    ws,
    messages,
    waitForMessage,
    close: () => ws.close(),
  };
}

afterEach(() => {
  app?.stop();
  app = null;
});

describe('sync policy WebSocket integration', () => {
  test('allows read-protected and write-protected tables to differ', async () => {
    const testApp = createApp();
    app = testApp;
    const db = getAppDatabase(testApp);

    db.insert('readonly_docs', { id: 'r1', title: 'Readable but service-owned' });
    db.insert('hidden_docs', { id: 'h1', title: 'Hidden from sync snapshots' });

    const conn = await connectWS(getUrl(testApp));

    conn.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['public_docs', 'readonly_docs', 'hidden_docs'],
        snapshot: ['public_docs', 'readonly_docs', 'hidden_docs'],
        lastSeq: 0,
      })
    );

    const snapshot = await conn.waitForMessage((msg) => msg.type === 'sync.snapshot');
    expect(snapshot.type).toBe('sync.snapshot');

    if (snapshot.type === 'sync.snapshot') {
      expect(snapshot.tables.readonly_docs).toEqual({
        r1: { id: 'r1', title: 'Readable but service-owned' },
      });
      expect(snapshot.tables.hidden_docs).toBeUndefined();
    }

    conn.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'readonly-insert',
        table: 'readonly_docs',
        op: 'INSERT',
        row: { id: 'r2', title: 'Should fail' },
      })
    );

    const deniedAck = await conn.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'readonly-insert'
    );
    expect(deniedAck).toEqual({
      type: 'sync.ack',
      ref: 'readonly-insert',
      seq: null,
      ok: false,
      error: 'Table is read-only over sync: readonly_docs',
    });

    conn.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'public-insert',
        table: 'public_docs',
        op: 'INSERT',
        row: { id: 'p1', title: 'Writable by sync' },
      })
    );

    const allowedAck = await conn.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'public-insert'
    );
    expect(allowedAck.type).toBe('sync.ack');
    if (allowedAck.type === 'sync.ack') {
      expect(allowedAck.ok).toBe(true);
      expect(typeof allowedAck.seq).toBe('number');
    }

    conn.close();
  });

  test('filters reconnect catchup through auth-aware read policy', async () => {
    const testApp = createAuthFilteredApp();
    app = testApp;
    const db = getAppDatabase(testApp);

    db.insert('public_docs', { id: 'p0', title: 'Public seed' });
    db.insert('admin_docs', { id: 'a0', title: 'Admin seed' });

    const firstUser = await connectWS(getUrl(testApp, 'user-token'));
    firstUser.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['public_docs', 'admin_docs'],
        snapshot: ['public_docs', 'admin_docs'],
        lastSeq: 0,
      })
    );

    const initialSnapshot = await firstUser.waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );
    expect(initialSnapshot.type).toBe('sync.snapshot');

    if (initialSnapshot.type !== 'sync.snapshot') {
      throw new Error('Expected initial snapshot');
    }

    expect(initialSnapshot.tables.public_docs).toEqual({
      p0: { id: 'p0', title: 'Public seed' },
    });
    expect(initialSnapshot.tables.admin_docs).toBeUndefined();

    db.insert('public_docs', { id: 'p1', title: 'Public replay' });
    db.insert('admin_docs', { id: 'a1', title: 'Admin replay' });
    firstUser.close();

    const secondUser = await connectWS(getUrl(testApp, 'user-token'));
    secondUser.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['public_docs', 'admin_docs'],
        snapshot: ['public_docs', 'admin_docs'],
        lastSeq: initialSnapshot.seq,
        epoch: initialSnapshot.epoch,
        scope: initialSnapshot.scope,
      })
    );

    const userCatchup = await secondUser.waitForMessage(
      (msg) => msg.type === 'sync.catchup'
    );
    expect(userCatchup.type).toBe('sync.catchup');
    if (userCatchup.type === 'sync.catchup') {
      expect(userCatchup.changes.map((change) => change.rowId)).toEqual(['p1']);
    }

    const admin = await connectWS(getUrl(testApp, 'admin-token'));
    admin.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['public_docs', 'admin_docs'],
        snapshot: ['public_docs', 'admin_docs'],
        lastSeq: initialSnapshot.seq,
      })
    );

    const adminSnapshot = await admin.waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );
    expect(adminSnapshot.type).toBe('sync.snapshot');
    if (adminSnapshot.type === 'sync.snapshot') {
      expect(adminSnapshot.reset).toBe('purge');
      expect(Object.keys(adminSnapshot.tables.public_docs)).toEqual(['p0', 'p1']);
      expect(Object.keys(adminSnapshot.tables.admin_docs)).toEqual(['a0', 'a1']);
    }

    secondUser.close();
    admin.close();
  });

  test('filters row-constrained resource snapshots and live changes per connection', async () => {
    const testApp = createResourceSyncApp();
    app = testApp;
    const db = getAppDatabase(testApp);

    db.insert('tickets', {
      id: 'user-ticket',
      title: 'User Ticket',
      owner_id: 'user-1',
    });
    db.insert('tickets', {
      id: 'other-ticket',
      title: 'Other Ticket',
      owner_id: 'user-2',
    });

    const user = await connectWS(getUrl(testApp, 'user-token'));
    user.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['tickets'],
        snapshot: ['tickets'],
        lastSeq: 0,
      })
    );

    const userSnapshot = await user.waitForMessage((msg) => msg.type === 'sync.snapshot');
    expect(userSnapshot.type).toBe('sync.snapshot');
    if (userSnapshot.type === 'sync.snapshot') {
      expect(userSnapshot.tables.tickets).toEqual({
        'user-ticket': {
          id: 'user-ticket',
          title: 'User Ticket',
          owner_id: 'user-1',
        },
      });
    }

    const admin = await connectWS(getUrl(testApp, 'admin-token'));
    admin.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['tickets'],
        snapshot: ['tickets'],
        lastSeq: 0,
      })
    );

    const adminSnapshot = await admin.waitForMessage((msg) => msg.type === 'sync.snapshot');
    expect(adminSnapshot.type).toBe('sync.snapshot');
    if (adminSnapshot.type === 'sync.snapshot') {
      expect(Object.keys(adminSnapshot.tables.tickets ?? {}).sort()).toEqual([
        'other-ticket',
        'user-ticket',
      ]);
    }

    db.insert('tickets', {
      id: 'new-user-ticket',
      title: 'New User Ticket',
      owner_id: 'user-1',
    });
    const visibleInsert = await user.waitForMessage(
      (msg) => msg.type === 'sync.change' && msg.rowId === 'new-user-ticket'
    );
    expect(visibleInsert.type).toBe('sync.change');
    if (visibleInsert.type === 'sync.change') {
      expect(visibleInsert.op).toBe('INSERT');
      expect(visibleInsert.row?.owner_id).toBe('user-1');
    }

    db.update('tickets', 'new-user-ticket', { owner_id: 'user-2' });
    const movedOut = await user.waitForMessage(
      (msg) =>
        msg.type === 'sync.change' &&
        msg.rowId === 'new-user-ticket' &&
        msg.op === 'DELETE'
    );
    expect(movedOut.type).toBe('sync.change');
    if (movedOut.type === 'sync.change') {
      expect(movedOut.op).toBe('DELETE');
      expect(movedOut.row).toBeNull();
    }

    db.update('tickets', 'other-ticket', { owner_id: 'user-1' });
    const movedIn = await user.waitForMessage(
      (msg) => msg.type === 'sync.change' && msg.rowId === 'other-ticket'
    );
    expect(movedIn.type).toBe('sync.change');
    if (movedIn.type === 'sync.change') {
      expect(movedIn.op).toBe('UPDATE');
      expect(movedIn.row?.owner_id).toBe('user-1');
    }

    user.close();
    admin.close();
  });

  test('filters row-constrained resource reconnect catchup', async () => {
    const testApp = createResourceSyncApp();
    app = testApp;
    const db = getAppDatabase(testApp);

    db.insert('tickets', {
      id: 'user-ticket',
      title: 'User Ticket',
      owner_id: 'user-1',
    });

    const first = await connectWS(getUrl(testApp, 'user-token'));
    first.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['tickets'],
        snapshot: ['tickets'],
        lastSeq: 0,
      })
    );

    const snapshot = await first.waitForMessage((msg) => msg.type === 'sync.snapshot');
    expect(snapshot.type).toBe('sync.snapshot');
    if (snapshot.type !== 'sync.snapshot') throw new Error('Expected snapshot');
    first.close();

    db.insert('tickets', {
      id: 'after-user',
      title: 'After User',
      owner_id: 'user-1',
    });
    db.insert('tickets', {
      id: 'after-other',
      title: 'After Other',
      owner_id: 'user-2',
    });
    db.update('tickets', 'user-ticket', { owner_id: 'user-2' });

    const second = await connectWS(getUrl(testApp, 'user-token'));
    second.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['tickets'],
        snapshot: ['tickets'],
        lastSeq: snapshot.seq,
        epoch: snapshot.epoch,
        scope: snapshot.scope,
      })
    );

    const catchup = await second.waitForMessage((msg) => msg.type === 'sync.catchup');
    expect(catchup.type).toBe('sync.catchup');
    if (catchup.type === 'sync.catchup') {
      expect(catchup.changes.map((change) => ({
        rowId: change.rowId,
        op: change.op,
        owner: change.row?.owner_id,
      }))).toEqual([
        { rowId: 'after-user', op: 'INSERT', owner: 'user-1' },
        { rowId: 'user-ticket', op: 'DELETE', owner: undefined },
      ]);
    }

    second.close();
  });

  test('closes only the connection whose location property loses read access', async () => {
    const local = createLocationPolicyApp();
    app = local.app;
    const db = local.db;
    db.insert('location_docs', { id: 'before-revoke', title: 'Visible initially' });

    const first = await connectWS(getUrl(local.app, 'location-one'));
    const second = await connectWS(getUrl(local.app, 'location-two'));
    for (const connection of [first, second]) {
      connection.ws.send(JSON.stringify({
        type: 'sync.subscribe', tables: ['location_docs'],
        snapshot: ['location_docs'], lastSeq: 0,
      }));
      const snapshot = await connection.waitForMessage((message) => message.type === 'sync.snapshot');
      expect(snapshot.type === 'sync.snapshot' && snapshot.tables.location_docs)
        .toHaveProperty('before-revoke');
    }

    const firstClosed = waitForSocketClose(first.ws);
    local.store.deleteProperty('location-one', 'locations');
    const close = await firstClosed;
    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Sync access changed');

    db.insert('location_docs', { id: 'after-revoke', title: 'Still visible to location two' });
    const live = await second.waitForMessage(
      (message) => message.type === 'sync.change' && message.rowId === 'after-revoke'
    );
    expect(live.type).toBe('sync.change');
    expect(first.messages.some(
      (message) => message.type === 'sync.change' && message.rowId === 'after-revoke'
    )).toBe(false);
    second.close();
  });

  test('enforces resource policies on direct sync mutations', async () => {
    const testApp = createResourceSyncApp();
    app = testApp;
    const db = getAppDatabase(testApp);

    db.insert('tickets', {
      id: 'other-ticket',
      title: 'Other Ticket',
      owner_id: 'user-2',
    });

    const user = await connectWS(getUrl(testApp, 'user-token'));
    user.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'create-ticket',
        table: 'tickets',
        op: 'INSERT',
        row: {
          id: 'created-ticket',
          title: 'Created Ticket',
          owner_id: 'attacker-id',
        },
      })
    );

    const createAck = await user.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'create-ticket'
    );
    expect(createAck.type).toBe('sync.ack');
    if (createAck.type === 'sync.ack') {
      expect(createAck.ok).toBe(true);
    }
    expect(db.get('tickets', 'created-ticket')?.owner_id).toBe('user-1');

    user.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'update-other',
        table: 'tickets',
        op: 'UPDATE',
        rowId: 'other-ticket',
        row: { title: 'Should Not Update' },
      })
    );

    const deniedUpdate = await user.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'update-other'
    );
    expect(deniedUpdate).toMatchObject({
      type: 'sync.ack',
      ref: 'update-other',
      seq: null,
      ok: false,
      error: 'Forbidden',
    });
    expect(db.get('tickets', 'other-ticket')?.title).toBe('Other Ticket');

    const admin = await connectWS(getUrl(testApp, 'admin-token'));
    admin.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'admin-update',
        table: 'tickets',
        op: 'UPDATE',
        rowId: 'other-ticket',
        row: { title: 'Admin Updated' },
      })
    );

    const adminAck = await admin.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'admin-update'
    );
    expect(adminAck.type).toBe('sync.ack');
    if (adminAck.type === 'sync.ack') {
      expect(adminAck.ok).toBe(true);
    }
    expect(db.get('tickets', 'other-ticket')?.title).toBe('Admin Updated');

    user.close();
    admin.close();
  });
});

function waitForSocketClose(ws: WebSocket, timeout = 2_000): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeout);
    ws.addEventListener('close', (event) => {
      clearTimeout(timer);
      resolve(event);
    }, { once: true });
  });
}
