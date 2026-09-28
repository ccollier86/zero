import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { EphemeralTopicPolicy } from '../../sync/ephemeral-policy';
import type { ServerMessage } from '../../sync/types';
import { createApp } from './app-factory';

type ZeroApp = Awaited<ReturnType<typeof createApp>>;

interface Registration {
  accessToken: string;
  user: { userId: string };
}

interface SyncConnection {
  ws: WebSocket;
  messages: ServerMessage[];
  waitFor(
    predicate: (message: ServerMessage) => boolean,
    description: string,
  ): Promise<ServerMessage>;
  close(): Promise<void>;
}

let app: ZeroApp | null = null;
let tempRoot: string | null = null;
const connections = new Set<SyncConnection>();

afterEach(async () => {
  await Promise.all([...connections].map((connection) => connection.close()));
  await app?.stop(true);
  app = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe('createApp managed ephemeral topic policy', () => {
  test('uses the app-local RoomService, denies non-members, supports custom topics, and revokes live access', async () => {
    tempRoot = await createTestRoot();
    app = await createApp({
      db: { mode: 'memory' },
      tables: {},
      auth: { bootstrap: 'public' },
      ephemeralPolicy: customCanvasPolicy,
      appDir: join(tempRoot, 'app'),
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
    app.listen(0);
    const baseUrl = `http://localhost:${app.server!.port}`;
    const wsUrl = `ws://localhost:${app.server!.port}/sync`;
    const owner = await register(baseUrl, 'owner');
    const outsider = await register(baseUrl, 'outsider');
    const roomResponse = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: bearerJson(owner.accessToken),
      body: JSON.stringify({ name: 'Policy room' }),
    });
    expect(roomResponse.status).toBe(200);
    const room = (await roomResponse.json() as {
      room: { room_id: string };
    }).room;

    const ownerConnection = await connectSync(wsUrl, owner.accessToken);
    const outsiderConnection = await connectSync(wsUrl, outsider.accessToken);
    connections.add(ownerConnection);
    connections.add(outsiderConnection);

    ownerConnection.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: `presence:${room.room_id}`,
    }));
    await ownerConnection.waitFor(
      (message) => message.type === 'ephemeral.snapshot'
        && message.topic === `presence:${room.room_id}`,
      'owner room snapshot',
    );
    ownerConnection.ws.send(JSON.stringify({
      type: 'ephemeral.set',
      topic: `presence:${room.room_id}`,
      key: `user:${owner.user.userId}`,
      value: { online: true },
    }));
    const presence = await ownerConnection.waitFor(
      (message) => message.type === 'ephemeral.change'
        && message.topic === `presence:${room.room_id}`,
      'owner presence change',
    );
    expect(presence).toMatchObject({
      type: 'ephemeral.change',
      key: `user:${owner.user.userId}`,
      value: { online: true },
    });

    outsiderConnection.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: `presence:${room.room_id}`,
    }));
    const denied = await outsiderConnection.waitFor(
      (message) => message.type === 'ephemeral.error'
        && message.topic === `presence:${room.room_id}`,
      'non-member denial',
    );
    expect(denied).toMatchObject({
      type: 'ephemeral.error',
      operation: 'subscribe',
      code: 'EPHEMERAL_FORBIDDEN',
    });

    ownerConnection.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: 'canvas:team-a',
    }));
    await ownerConnection.waitFor(
      (message) => message.type === 'ephemeral.snapshot'
        && message.topic === 'canvas:team-a',
      'custom topic snapshot',
    );
    ownerConnection.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: 'unclassified:team-a',
    }));
    const unclassified = await ownerConnection.waitFor(
      (message) => message.type === 'ephemeral.error'
        && message.topic === 'unclassified:team-a',
      'unclassified topic denial',
    );
    expect(unclassified).toMatchObject({
      code: 'EPHEMERAL_TOPIC_UNCLASSIFIED',
    });

    const deleteRoom = await fetch(`${baseUrl}/rooms/${room.room_id}`, {
      method: 'DELETE',
      headers: bearerJson(owner.accessToken),
    });
    expect(deleteRoom.status).toBe(200);
    const revoked = await ownerConnection.waitFor(
      (message) => message.type === 'ephemeral.error'
        && message.topic === `presence:${room.room_id}`
        && message.revoked === true,
      'revoked room subscription',
    );
    expect(revoked).toMatchObject({
      code: 'EPHEMERAL_FORBIDDEN',
      operation: 'subscribe',
      revoked: true,
    });
  }, 60_000);

  test('preserves shared legacy topics for an explicitly authless app', async () => {
    tempRoot = await createTestRoot();
    app = await createApp({
      db: { mode: 'memory' },
      tables: {},
      auth: false,
      appDir: join(tempRoot, 'app'),
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
    app.listen(0);
    const wsUrl = `ws://localhost:${app.server!.port}/sync`;
    const writer = await connectSync(wsUrl);
    const reader = await connectSync(wsUrl);
    connections.add(writer);
    connections.add(reader);

    writer.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: 'legacy-shared',
    }));
    await writer.waitFor(
      (message) => message.type === 'ephemeral.snapshot'
        && message.topic === 'legacy-shared',
      'writer legacy snapshot',
    );
    writer.ws.send(JSON.stringify({
      type: 'ephemeral.set',
      topic: 'legacy-shared',
      key: 'cursor',
      value: { x: 42 },
    }));
    await writer.waitFor(
      (message) => message.type === 'ephemeral.change'
        && message.topic === 'legacy-shared'
        && message.key === 'cursor',
      'writer legacy change',
    );
    reader.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: 'legacy-shared',
    }));

    const snapshot = await reader.waitFor(
      (message) => message.type === 'ephemeral.snapshot'
        && message.topic === 'legacy-shared',
      'authless legacy snapshot',
    );
    expect(snapshot).toMatchObject({
      type: 'ephemeral.snapshot',
      entries: {
        cursor: { value: { x: 42 } },
      },
    });
    expect(reader.messages.some(
      (message) => message.type === 'ephemeral.error',
    )).toBe(false);
  }, 60_000);
});

const customCanvasPolicy: EphemeralTopicPolicy = {
  async authorize(context) {
    if (context.topic === 'canvas:team-a') {
      return {
        ok: true,
        namespace: 'app:canvas:team-a',
        keyOwnership: 'actor',
      };
    }
    return {
      ok: false,
      code: 'EPHEMERAL_TOPIC_UNCLASSIFIED',
      reason: 'Custom topic is not classified',
    };
  },
};

async function createTestRoot(): Promise<string> {
  const zeroDir = join(process.cwd(), '.zero');
  await mkdir(zeroDir, { recursive: true });
  const root = await mkdtemp(join(zeroDir, 'ephemeral-policy-'));
  await mkdir(join(root, 'app'), { recursive: true });
  return root;
}

async function register(baseUrl: string, name: string): Promise<Registration> {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `${name}-${crypto.randomUUID()}`,
      email: `${name}-${crypto.randomUUID()}@example.test`,
      password: 'password123',
    }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Registration>;
}

function bearerJson(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function connectSync(url: string, token?: string): Promise<SyncConnection> {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index--) {
      if (!waiters[index].predicate(message)) continue;
      waiters[index].resolve(message);
      waiters.splice(index, 1);
    }
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  let closePromise: Promise<void> | null = null;
  const connection: SyncConnection = {
    ws,
    messages,
    waitFor(predicate, description) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          3_000,
        );
        waiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timeout);
            resolve(message);
          },
        });
      });
    },
    close() {
      if (closePromise) return closePromise;
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      closePromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1_000);
        ws.addEventListener('close', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        ws.close();
      });
      return closePromise;
    },
  };

  ws.send(JSON.stringify({
    type: 'sync.auth',
    ...(token ? { token } : {}),
  }));
  const ready = await connection.waitFor(
    (message) => message.type === 'sync.auth.ready',
    'auth ready',
  );
  expect(ready).toMatchObject({
    type: 'sync.auth.ready',
    authenticated: Boolean(token),
  });
  return connection;
}
