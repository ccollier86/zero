/** Real cross-replica Sync invalidation over one file-backed SQLite database. */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Elysia } from 'elysia';
import type { AuthRuntime } from '../auth/auth-runtime';
import { createAuthPlugin } from '../auth/auth.plugin';
import { MemoryEventStore } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { EphemeralTopicPolicy } from './ephemeral-policy';
import type { ReactiveDB } from './reactive-db';
import { createSyncPlugin } from './sync.plugin';
import { requiresSyncCachePurge } from './client/sync-authorization-boundary';
import type { ServerMessage } from './types';

const AUTHORITY_EPHEMERAL_TOPIC = 'authority:workspace';
const AUTHORITY_EPHEMERAL_PROPERTY = 'ephemeral_workspace_access';

interface Replica {
  app: { stop(closeActiveConnections?: boolean): Promise<unknown> };
  auth: AuthRuntime;
  db: ReactiveDB;
  runtime: ZeroAppRuntime;
  httpUrl: string;
  syncUrl: string;
}

interface SyncConnection {
  ws: WebSocket;
  waitForMessage(
    predicate: (message: ServerMessage) => boolean,
    timeout?: number,
  ): Promise<ServerMessage>;
  waitForClose(timeout?: number): Promise<CloseEvent>;
  close(): void;
}

describe('Sync auth cross-replica invalidation', () => {
  test('logout on one runtime promptly closes the exact session socket on another', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-sync-auth-replica-'));
    const path = join(directory, 'shared.sqlite');
    const replicas: Replica[] = [];
    let connection: SyncConnection | null = null;

    try {
      const first = createReplica('authority-replica-a', path);
      replicas.push(first);
      await waitForAuth(first);

      const registration = await requestJson(first.httpUrl, '/auth/register', {
        username: 'replica-session-user',
        email: 'replica-session-user@example.test',
        password: 'password123',
      });
      expect(registration.status).toBe(200);
      const accessToken = registration.body.accessToken as string;
      const refreshToken = registration.body.refreshToken as string;

      // Start the second runtime only after the first has persisted the shared
      // signing key and exact web-session family into the common SQLite file.
      const second = createReplica('authority-replica-b', path);
      replicas.push(second);
      await waitForAuth(second);

      const secondContext = await second.auth.getTokenService()!
        .resolveAuthContext(accessToken);
      expect(secondContext).toMatchObject({
        userId: registration.body.user.userId,
        sessionKind: 'web',
      });
      expect(secondContext?.sessionId).toBeString();

      connection = await connectSync(second.syncUrl);
      connection.ws.send(JSON.stringify({
        type: 'sync.auth',
        token: accessToken,
      }));
      expect(await connection.waitForMessage(
        (message) => message.type === 'sync.auth.ready',
      )).toEqual({ type: 'sync.auth.ready', authenticated: true });

      const revisionBeforeLogout = second.auth.getTokenService()!
        .getAuthorityRevision();
      expect(revisionBeforeLogout).toBeNumber();
      const startedAt = performance.now();
      const logout = await requestJson(first.httpUrl, '/auth/logout', {
        refreshToken,
      });
      expect(logout).toMatchObject({ status: 200, body: { ok: true } });

      const revoked = first.auth.getAuthSessionService()!.store
        .getById(secondContext!.sessionId!);
      expect(revoked).toMatchObject({
        status: 'revoked',
        revocationReason: 'logout',
      });
      expect(first.auth.getTokenService()!.getAuthorityRevision())
        .toBeGreaterThan(revisionBeforeLogout as number);

      // Periodic token revalidation is deliberately one minute. A close in
      // this bound therefore proves runtime B observed the durable revision
      // written by runtime A instead of waiting for its local fallback timer.
      const close = await connection.waitForClose(2_000);
      expect(performance.now() - startedAt).toBeLessThan(2_000);
      expect(close.code).toBe(4001);
      // Durable session revocation is a cache-purging authorization boundary,
      // not ordinary bearer expiry (which can retain same-authority caches).
      expect(close.reason).toBe('Auth context changed');
      expect(requiresSyncCachePurge(close)).toBeTrue();
      await expect(second.auth.getTokenService()!.resolveAuthContext(accessToken))
        .resolves.toBeNull();
    } finally {
      connection?.close();
      // The server initiated the tested close. Give Bun one event-loop turn to
      // finish its WebSocket close callback before stopping the listener.
      await new Promise((resolve) => setTimeout(resolve, 25));
      for (const replica of replicas.reverse()) {
        // Bun's server.stop(true) promise can remain pending after the server
        // initiated a WebSocket close. Initiate the forced listener shutdown,
        // but own deterministic service cleanup through the app-local runtime.
        void replica.app.stop(true).catch(() => {});
        await replica.runtime.dispose();
        replica.db.dispose();
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  test('authority changes on one runtime promptly revoke an ephemeral binding on another', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-ephemeral-authority-replica-'));
    const path = join(directory, 'shared.sqlite');
    const replicas: Replica[] = [];
    let connection: SyncConnection | null = null;

    try {
      const first = createReplica('ephemeral-authority-replica-a', path);
      replicas.push(first);
      await waitForAuth(first);

      const registration = await requestJson(first.httpUrl, '/auth/register', {
        username: 'replica-ephemeral-user',
        email: 'replica-ephemeral-user@example.test',
        password: 'password123',
      });
      expect(registration.status).toBe(200);
      const userId = registration.body.user.userId as string;
      const accessToken = registration.body.accessToken as string;
      first.auth.getStore()!.setProperty(
        userId,
        AUTHORITY_EPHEMERAL_PROPERTY,
        'allowed',
      );

      const second = createReplica('ephemeral-authority-replica-b', path);
      replicas.push(second);
      await waitForAuth(second);

      connection = await connectSync(second.syncUrl);
      connection.ws.send(JSON.stringify({
        type: 'sync.auth',
        token: accessToken,
      }));
      await connection.waitForMessage((message) => message.type === 'sync.auth.ready');
      connection.ws.send(JSON.stringify({
        type: 'ephemeral.subscribe',
        topic: AUTHORITY_EPHEMERAL_TOPIC,
      }));
      expect(await connection.waitForMessage(
        (message) => message.type === 'ephemeral.snapshot'
          && message.topic === AUTHORITY_EPHEMERAL_TOPIC,
      )).toMatchObject({
        type: 'ephemeral.snapshot',
        topic: AUTHORITY_EPHEMERAL_TOPIC,
      });

      const revisionBeforeRevocation = second.auth.getTokenService()!
        .getAuthorityRevision();
      expect(revisionBeforeRevocation).toBeNumber();
      const startedAt = performance.now();
      first.auth.getStore()!.setProperty(
        userId,
        AUTHORITY_EPHEMERAL_PROPERTY,
        'denied',
      );
      expect(first.auth.getTokenService()!.getAuthorityRevision())
        .toBeGreaterThan(revisionBeforeRevocation as number);

      // Both socket and ephemeral fallback revalidation are deliberately one
      // minute. This revocation therefore has to come from runtime B observing
      // runtime A's durable authority revision and invoking the composed
      // EphemeralChannel callback.
      const revoked = await connection.waitForMessage(
        (message) => message.type === 'ephemeral.error'
          && message.topic === AUTHORITY_EPHEMERAL_TOPIC
          && message.revoked === true,
        2_000,
      );
      expect(performance.now() - startedAt).toBeLessThan(2_000);
      expect(revoked).toMatchObject({
        type: 'ephemeral.error',
        operation: 'subscribe',
        code: 'EPHEMERAL_FORBIDDEN',
        topic: AUTHORITY_EPHEMERAL_TOPIC,
        revoked: true,
      });

      // The property controls only this app-policy topic. Its removal must not
      // masquerade as a session revocation; the same authenticated socket can
      // still complete an ordinary Sync subscription afterward.
      connection.ws.send(JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      }));
      expect(await connection.waitForMessage(
        (message) => message.type === 'sync.snapshot',
      )).toMatchObject({ type: 'sync.snapshot' });
    } finally {
      connection?.close();
      await new Promise((resolve) => setTimeout(resolve, 25));
      for (const replica of replicas.reverse()) {
        void replica.app.stop(true).catch(() => {});
        await replica.runtime.dispose();
        replica.db.dispose();
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});

function createReplica(name: string, path: string): Replica {
  const runtime = new ZeroAppRuntime(name);
  const events = new MemoryEventStore({ maxEvents: 100 });
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    sink: events,
    store: events,
    config: { console: false },
  });
  const services: {
    auth?: AuthRuntime;
    db?: ReactiveDB;
  } = {};
  const ephemeralPolicy: EphemeralTopicPolicy = {
    async authorize(context) {
      const userId = context.authContext?.userId;
      if (context.topic !== AUTHORITY_EPHEMERAL_TOPIC || !userId) {
        return {
          ok: false,
          code: 'EPHEMERAL_TOPIC_UNCLASSIFIED',
          reason: 'Ephemeral topic is not classified',
        };
      }
      if (services.auth?.getStore()?.getProperty(
        userId,
        AUTHORITY_EPHEMERAL_PROPERTY,
      ) !== 'allowed') {
        return {
          ok: false,
          code: 'EPHEMERAL_FORBIDDEN',
          reason: 'Ephemeral workspace access was revoked',
        };
      }
      return {
        ok: true,
        namespace: `authority:${userId}:workspace`,
        keyOwnership: 'actor',
      };
    },
  };
  const sync = createSyncPlugin({
    runtime,
    db: {
      mode: 'file',
      path,
      busyTimeout: 10_000,
      clearChangesOnStart: false,
    },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    auth: {
      required: true,
      getTokenVerifier: () => services.auth?.getTokenService() ?? null,
      revalidateIntervalMs: 60_000,
      invalidationPollIntervalMs: 10,
    },
    ephemeralPolicy,
    replicaChangePolling: { intervalMs: 10 },
    onDatabaseCreated(db) {
      services.db = db;
    },
  });
  if (!services.db) throw new Error('Sync database was not created');

  const app = new Elysia({ name })
    .use(sync)
    .use(createAuthPlugin({
      runtime,
      db: services.db,
      bootstrap: 'public',
      registration: { mode: 'public' },
      onRuntimeCreated(auth) {
        services.auth = auth;
      },
    }));
  if (!services.auth) throw new Error('Auth runtime was not created');
  app.listen(0);
  const port = app.server!.port;
  return {
    app,
    auth: services.auth,
    db: services.db,
    runtime,
    httpUrl: `http://localhost:${port}`,
    syncUrl: `ws://localhost:${port}/sync`,
  };
}

async function waitForAuth(replica: Replica): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!replica.auth.getStore() || !replica.auth.getTokenService()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for replica auth startup');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function requestJson(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Connection': 'close',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

async function connectSync(url: string): Promise<SyncConnection> {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  const messageWaiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];
  const closeWaiters: Array<(event: CloseEvent) => void> = [];
  let closeEvent: CloseEvent | null = null;

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (let index = messageWaiters.length - 1; index >= 0; index--) {
      const waiter = messageWaiters[index]!;
      if (!waiter.predicate(message)) continue;
      messageWaiters.splice(index, 1);
      waiter.resolve(message);
    }
  };
  ws.onclose = (event) => {
    closeEvent = event;
    while (closeWaiters.length > 0) closeWaiters.shift()!(event);
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  return {
    ws,
    waitForMessage(predicate, timeout = 2_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for Sync message')),
          timeout,
        );
        messageWaiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timer);
            resolve(message);
          },
        });
      });
    },
    waitForClose(timeout = 2_000) {
      if (closeEvent) return Promise.resolve(closeEvent);
      return new Promise<CloseEvent>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for Sync socket close')),
          timeout,
        );
        closeWaiters.push((event) => {
          clearTimeout(timer);
          resolve(event);
        });
      });
    },
    close() {
      (ws as WebSocket & { terminate(): void }).terminate();
    },
  };
}
