/**
 * sync-policy.integration.test.ts
 *
 * Exercises sync policy enforcement through the real WebSocket lifecycle. Unit
 * tests cover helper semantics; this file verifies socket read and mutation
 * behavior stays separated in transport.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createSyncPlugin, getSyncDB } from './sync.plugin';
import { createDefaultSyncPolicy } from './sync-policy';
import type { ServerMessage, SyncTokenVerifier } from './types';

interface TestApp {
  stop(): void;
  server: { hostname?: string; port?: number } | null;
}

let app: TestApp | null = null;

function createApp() {
  return new Elysia()
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
      })
    )
    .listen(0);
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

  return new Elysia()
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
      })
    )
    .listen(0);
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
    const db = getSyncDB();

    expect(db).not.toBeNull();
    db!.insert('readonly_docs', { id: 'r1', title: 'Readable but service-owned' });
    db!.insert('hidden_docs', { id: 'h1', title: 'Hidden from sync snapshots' });

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
    const db = getSyncDB();

    expect(db).not.toBeNull();
    db!.insert('public_docs', { id: 'p0', title: 'Public seed' });
    db!.insert('admin_docs', { id: 'a0', title: 'Admin seed' });

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

    db!.insert('public_docs', { id: 'p1', title: 'Public replay' });
    db!.insert('admin_docs', { id: 'a1', title: 'Admin replay' });
    firstUser.close();

    const secondUser = await connectWS(getUrl(testApp, 'user-token'));
    secondUser.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['public_docs', 'admin_docs'],
        snapshot: ['public_docs', 'admin_docs'],
        lastSeq: initialSnapshot.seq,
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

    const adminCatchup = await admin.waitForMessage(
      (msg) => msg.type === 'sync.catchup'
    );
    expect(adminCatchup.type).toBe('sync.catchup');
    if (adminCatchup.type === 'sync.catchup') {
      expect(adminCatchup.changes.map((change) => change.rowId)).toEqual([
        'p1',
        'a1',
      ]);
    }

    secondUser.close();
    admin.close();
  });
});
