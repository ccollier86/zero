import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createSyncPlugin } from './sync.plugin';
import { SYNC_INGRESS_MAX_PENDING_MESSAGES } from './sync-socket-ingress';
import type { SyncTokenVerifier } from './types';

let app: ReturnType<typeof createApp> | null = null;

describe('Sync ingress integration', () => {
  test('closes 1013 when frames outrun asynchronous authentication admission', async () => {
    let releaseBarrier!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    const verifier: SyncTokenVerifier = {
      async verifyAccessToken() {
        started();
        await barrier;
        return {
          sub: 'user-1',
          email: 'user@example.test',
          role: 'user',
        };
      },
    };
    app = createApp(verifier);
    const socket = new WebSocket(url(app));
    await opened(socket);
    const closed = waitForClose(socket);
    const handshake = JSON.stringify({ type: 'sync.auth', token: 'token' });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseBarrier();
    };

    try {
      socket.send(handshake);
      await resolving;
      for (let index = 0; index < SYNC_INGRESS_MAX_PENDING_MESSAGES; index += 1) {
        socket.send(handshake);
      }
      // Bun completes the currently executing async message callback before it
      // finalizes the close handshake. The admission fence has already
      // cancelled authorization; let that ignored verifier promise settle.
      setTimeout(release, 25);
      const event = await closed;
      expect(event.code).toBe(1013);
      expect(event.reason).toBe('Sync ingress capacity exceeded');
    } finally {
      release();
      socket.close();
    }
  });
});

afterEach(() => {
  app?.stop();
  app = null;
});

function createApp(verifier: SyncTokenVerifier) {
  return new Elysia().use(createSyncPlugin({
    db: { mode: 'memory' },
    tables: { todos: { id: 'text primary key' } },
    auth: {
      required: true,
      getTokenVerifier: () => verifier,
    },
  })).listen(0);
}

function url(value: ReturnType<typeof createApp>): string {
  const server = value.server;
  if (!server) throw new Error('Expected Sync test server');
  return `ws://${server.hostname}:${server.port}/sync`;
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('WebSocket connection failed'));
  });
}

function waitForClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for ingress close')),
      5_000,
    );
    socket.onclose = (event) => {
      clearTimeout(timeout);
      resolve(event);
    };
  });
}
