import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { allowLegacyEphemeralTopicPolicy } from './ephemeral-policy';
import { createSyncPlugin } from './sync.plugin';
import type { ReactiveDB } from './reactive-db';
import type {
  ServerMessage,
  SyncAuthContext,
  SyncAuthContextAuthorityReference,
  SyncTokenVerifier,
} from './types';

interface TestApp {
  server: { hostname?: string; port?: number } | null;
  stop(closeActiveConnections?: boolean): Promise<unknown>;
  disposeSyncDatabase?: () => void;
  disposeRuntime?: () => Promise<void>;
}

interface TestConnection {
  ws: WebSocket;
  messages: ServerMessage[];
  waitForMessage(
    predicate: (message: ServerMessage) => boolean,
    timeout?: number,
  ): Promise<ServerMessage>;
  waitForClose(timeout?: number): Promise<void>;
  close(): void;
}

const apps: TestApp[] = [];
const connections: TestConnection[] = [];
const directories: string[] = [];
let serverInitiatedClose = false;

afterEach(async () => {
  const currentConnections = connections.splice(0);
  for (const connection of currentConnections) connection.close();
  await Bun.sleep(25);
  for (const app of apps.splice(0).reverse()) {
    if (serverInitiatedClose) {
      // Bun can leave the stop promise pending after the server initiated a WS
      // close. Forced stop is still initiated; do not make the test hook wait
      // on that close-handshake bug.
      void app.stop(true).catch(() => {});
    } else {
      await app.stop(true);
    }
    await app.disposeRuntime?.();
    app.disposeSyncDatabase?.();
  }
  serverInitiatedClose = false;
  await Bun.sleep(25);
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('State Sync shared-file runtimes', () => {
  test('fans set, delete, and clear out to the same principal exactly once', async () => {
    const directory = await createTempDirectory('zero-state-replica-live-');
    const path = join(directory, 'app.sqlite');
    const appA = createStateApp(path, 10);
    const appB = createStateApp(path, 10);
    apps.push(appA, appB);

    const sender = await connect(appA);
    const localPeer = await connect(appA);
    const receiver = await connect(appB);
    const otherUser = await connect(appB);
    connections.push(sender, localPeer, receiver, otherUser);
    await authenticate(sender, 'user-1-token');
    await authenticate(localPeer, 'user-1-token');
    await authenticate(receiver, 'user-1-token');
    await authenticate(otherUser, 'user-2-token');
    await subscribeState(sender);
    await subscribeState(localPeer);
    await subscribeState(receiver);
    await subscribeState(otherUser);

    sender.ws.send(JSON.stringify({
      type: 'state.set', ref: 'set', key: 'theme', value: 'dark',
    }));
    await sender.waitForMessage(
      (message) => message.type === 'state.ack' && message.ref === 'set' && message.ok,
    );
    await localPeer.waitForMessage(
      (message) => message.type === 'state.change'
        && message.op === 'set'
        && message.key === 'theme',
    );
    const remoteSet = await receiver.waitForMessage(
      (message) => message.type === 'state.change'
        && message.op === 'set'
        && message.key === 'theme',
    );
    expect(remoteSet).toMatchObject({ value: 'dark' });
    expect(otherUser.messages.filter((message) => message.type === 'state.change')).toEqual([]);

    sender.ws.send(JSON.stringify({
      type: 'state.delete', ref: 'delete', key: 'theme',
    }));
    await sender.waitForMessage(
      (message) => message.type === 'state.ack' && message.ref === 'delete' && message.ok,
    );
    await receiver.waitForMessage(
      (message) => message.type === 'state.change'
        && message.op === 'delete'
        && message.key === 'theme',
    );

    sender.ws.send(JSON.stringify({
      type: 'state.set', ref: 'set-2', key: 'density', value: 'compact',
    }));
    await sender.waitForMessage(
      (message) => message.type === 'state.ack' && message.ref === 'set-2' && message.ok,
    );
    await receiver.waitForMessage(
      (message) => message.type === 'state.change'
        && message.op === 'set'
        && message.key === 'density',
    );

    sender.ws.send(JSON.stringify({ type: 'state.clear', ref: 'clear' }));
    await sender.waitForMessage(
      (message) => message.type === 'state.ack' && message.ref === 'clear' && message.ok,
    );
    await receiver.waitForMessage(
      (message) => message.type === 'state.change' && message.op === 'clear',
    );

    expect(localPeer.messages.filter(
      (message) => message.type === 'state.change' && message.op === 'set' && message.key === 'theme',
    )).toHaveLength(1);
    expect(sender.messages.filter(
      (message) => message.type === 'state.change' && message.op === 'set' && message.key === 'theme',
    )).toHaveLength(0);
    expect(receiver.messages.filter(
      (message) => message.type === 'state.change' && message.op === 'set' && message.key === 'theme',
    )).toHaveLength(1);
    expect(otherUser.messages.filter((message) => message.type === 'state.change')).toEqual([]);
  });

  test('snapshots a remote commit before polling and suppresses its later replay', async () => {
    const directory = await createTempDirectory('zero-state-replica-snapshot-');
    const path = join(directory, 'app.sqlite');
    const appA = createStateApp(path, 60_000);
    const appB = createStateApp(path, 60_000);
    apps.push(appA, appB);

    const sender = await connect(appA);
    const receiver = await connect(appB);
    connections.push(sender, receiver);
    await authenticate(sender, 'user-1-token');
    await authenticate(receiver, 'user-1-token');

    sender.ws.send(JSON.stringify({
      type: 'state.set', ref: 'remote-set', key: 'theme', value: 'dark',
    }));
    await sender.waitForMessage(
      (message) => message.type === 'state.ack'
        && message.ref === 'remote-set'
        && message.ok,
    );

    receiver.ws.send(JSON.stringify({ type: 'state.subscribe' }));
    const snapshot = await receiver.waitForMessage(
      (message) => message.type === 'state.snapshot',
    );
    expect(snapshot).toEqual({ type: 'state.snapshot', entries: { theme: 'dark' } });

    // A local write synchronously drains B's pending remote state event. The
    // snapshot cursor already represents it, so no duplicate state.change is sent.
    receiver.ws.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'wake-dispatcher',
      table: 'todos',
      op: 'INSERT',
      row: { id: 'wake', title: 'Wake ordered dispatcher' },
    }));
    await receiver.waitForMessage(
      (message) => message.type === 'sync.ack'
        && message.ref === 'wake-dispatcher'
        && message.ok,
    );
    expect(receiver.messages.filter(
      (message) => message.type === 'state.change' && message.key === 'theme',
    )).toEqual([]);
  });

  test('state-disabled replicas ignore the internal state event stream', async () => {
    const directory = await createTempDirectory('zero-state-replica-disabled-');
    const path = join(directory, 'app.sqlite');
    const stateApp = createStateApp(path, 60_000);
    const disabledApp = createStateApp(path, 60_000, false);
    apps.push(stateApp, disabledApp);

    const sender = await connect(stateApp);
    const disabled = await connect(disabledApp);
    connections.push(sender, disabled);
    await authenticate(sender, 'user-1-token');
    await authenticate(disabled, 'user-1-token');

    sender.ws.send(JSON.stringify({
      type: 'state.set', ref: 'state-write', key: 'theme', value: 'dark',
    }));
    await sender.waitForMessage(
      (message) => message.type === 'state.ack'
        && message.ref === 'state-write'
        && message.ok,
    );

    // This local write drains the pending _user_state row synchronously. The
    // disabled runtime must stay open and continue serving ordinary Sync.
    disabled.ws.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'ordinary-write',
      table: 'todos',
      op: 'INSERT',
      row: { id: 'ordinary', title: 'Still connected' },
    }));
    const ack = await disabled.waitForMessage(
      (message) => message.type === 'sync.ack' && message.ref === 'ordinary-write',
    );
    expect(ack).toMatchObject({ ok: true });
  });

  test('same-runtime delivery revalidates every recipient and excludes the sender', async () => {
    serverInitiatedClose = true;
    const authority = createDurableAuthorityHarness();
    authority.add('writer-token', tenantContext(
      'shared-user', 'writer-session', 'tenant-a', 'writer-membership',
    ));
    authority.add('active-peer-token', tenantContext(
      'shared-user', 'active-peer-session', 'tenant-a', 'active-peer-membership',
    ));
    authority.add('revoked-peer-token', tenantContext(
      'shared-user', 'revoked-peer-session', 'tenant-a', 'revoked-peer-membership',
    ));
    const app = createDurableStateApp('memory', 60_000, authority.verifier);
    apps.push(app);

    const writer = await connect(app);
    const activePeer = await connect(app);
    const revokedPeer = await connect(app);
    connections.push(writer, activePeer, revokedPeer);
    await authenticate(writer, 'writer-token');
    await authenticate(activePeer, 'active-peer-token');
    await authenticate(revokedPeer, 'revoked-peer-token');
    await subscribeState(writer);
    await subscribeState(activePeer);
    await subscribeState(revokedPeer);

    authority.revoke('revoked-peer-session');
    writer.ws.send(JSON.stringify({
      type: 'state.set', ref: 'local-authority', key: 'theme', value: 'dark',
    }));
    await writer.waitForMessage(
      (message) => message.type === 'state.ack'
        && message.ref === 'local-authority'
        && message.ok,
    );
    await activePeer.waitForMessage(
      (message) => message.type === 'state.change'
        && message.key === 'theme'
        && message.op === 'set',
    );
    await revokedPeer.waitForClose();
    await Bun.sleep(25);

    expect(writer.messages.filter((message) => message.type === 'state.change')).toEqual([]);
    expect(revokedPeer.messages.filter(
      (message) => message.type === 'state.change' && message.key === 'theme',
    )).toEqual([]);
  });

  test('commit and snapshot fences reject authority revoked after token revalidation', async () => {
    const authority = createDurableAuthorityHarness();
    authority.add('writer-token', tenantContext(
      'shared-user', 'writer-session', 'tenant-a', 'writer-membership',
    ));
    authority.add('reader-token', tenantContext(
      'shared-user', 'reader-session', 'tenant-a', 'reader-membership',
    ));
    const app = createDurableStateApp('memory', 60_000, authority.verifier);
    apps.push(app);

    const writer = await connect(app);
    const reader = await connect(app);
    connections.push(writer, reader);
    await authenticate(writer, 'writer-token');
    await authenticate(reader, 'reader-token');
    authority.revoke('writer-session');
    authority.revoke('reader-session');

    writer.ws.send(JSON.stringify({
      type: 'state.set', ref: 'revoked-commit', key: 'secret', value: 'blocked',
    }));
    expect(await writer.waitForMessage(
      (message) => message.type === 'state.ack' && message.ref === 'revoked-commit',
    )).toEqual({
      type: 'state.ack',
      ref: 'revoked-commit',
      ok: false,
      error: 'UNAUTHORIZED',
    });

    reader.ws.send(JSON.stringify({ type: 'state.subscribe' }));
    await Bun.sleep(25);
    expect(reader.messages.filter((message) => message.type === 'state.snapshot')).toEqual([]);

    authority.restore('reader-session');
    reader.ws.send(JSON.stringify({ type: 'state.subscribe' }));
    expect(await reader.waitForMessage(
      (message) => message.type === 'state.snapshot',
    )).toEqual({ type: 'state.snapshot', entries: {} });
  });

  test('shared-file delivery isolates tenant principals and revalidates revocation', async () => {
    serverInitiatedClose = true;
    const directory = await createTempDirectory('zero-state-replica-tenant-authority-');
    const path = join(directory, 'app.sqlite');
    const authority = createDurableAuthorityHarness();
    authority.add('writer-token', tenantContext(
      'shared-user', 'writer-session', 'tenant-a', 'writer-membership',
    ));
    authority.add('same-tenant-token', tenantContext(
      'shared-user', 'same-tenant-session', 'tenant-a', 'same-tenant-membership',
    ));
    authority.add('other-tenant-token', tenantContext(
      'shared-user', 'other-tenant-session', 'tenant-b', 'other-tenant-membership',
    ));
    const appA = createDurableStateApp(path, 10, authority.verifier);
    const appB = createDurableStateApp(path, 10, authority.verifier);
    apps.push(appA, appB);

    const writer = await connect(appA);
    const sameTenant = await connect(appB);
    const otherTenant = await connect(appB);
    connections.push(writer, sameTenant, otherTenant);
    await authenticate(writer, 'writer-token');
    await authenticate(sameTenant, 'same-tenant-token');
    await authenticate(otherTenant, 'other-tenant-token');
    await subscribeState(writer);
    await subscribeState(sameTenant);
    await subscribeState(otherTenant);

    writer.ws.send(JSON.stringify({
      type: 'state.set', ref: 'tenant-isolation', key: 'theme', value: 'dark',
    }));
    await writer.waitForMessage(
      (message) => message.type === 'state.ack'
        && message.ref === 'tenant-isolation'
        && message.ok,
    );
    await sameTenant.waitForMessage(
      (message) => message.type === 'state.change' && message.key === 'theme',
    );
    expect(otherTenant.messages.filter((message) => message.type === 'state.change')).toEqual([]);

    authority.revoke('same-tenant-session');
    writer.ws.send(JSON.stringify({
      type: 'state.set', ref: 'revoked-replica', key: 'density', value: 'compact',
    }));
    await writer.waitForMessage(
      (message) => message.type === 'state.ack'
        && message.ref === 'revoked-replica'
        && message.ok,
    );
    await sameTenant.waitForClose();
    await Bun.sleep(50);
    expect(sameTenant.messages.filter(
      (message) => message.type === 'state.change' && message.key === 'density',
    )).toEqual([]);
    expect(otherTenant.messages.filter((message) => message.type === 'state.change')).toEqual([]);
  });
});

function createStateApp(
  path: string,
  pollingMs: number,
  stateSync = true,
): TestApp {
  const verifier: SyncTokenVerifier = {
    async verifyAccessToken(token) {
      if (token === 'user-1-token') {
        return { sub: 'user-1', email: 'user-1@example.test', role: 'user' };
      }
      if (token === 'user-2-token') {
        return { sub: 'user-2', email: 'user-2@example.test', role: 'user' };
      }
      return null;
    },
  };

  return new Elysia()
    .use(createSyncPlugin({
      db: { mode: path, busyTimeout: 10_000 },
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      stateSync,
      replicaChangePolling: { intervalMs: pollingMs },
      auth: {
        required: true,
        getTokenVerifier: () => verifier,
      },
      ephemeralPolicy: allowLegacyEphemeralTopicPolicy,
    }))
    .listen(0) as unknown as TestApp;
}

function createDurableStateApp(
  mode: 'memory' | string,
  pollingMs: number,
  verifier: SyncTokenVerifier,
): TestApp {
  let syncDatabase: ReactiveDB | null = null;
  const runtime = new ZeroAppRuntime(`state-sync-authority-${crypto.randomUUID()}`);
  const app = new Elysia()
    .use(createSyncPlugin({
      runtime,
      db: { mode, busyTimeout: 10_000 },
      tables: {},
      stateSync: true,
      tenancyMode: 'multi',
      replicaChangePolling: { intervalMs: pollingMs },
      auth: {
        required: true,
        revalidateIntervalMs: 60_000,
        getTokenVerifier: () => verifier,
      },
      onDatabaseCreated(database) {
        syncDatabase = database;
      },
      ephemeralPolicy: allowLegacyEphemeralTopicPolicy,
    }))
    .listen(0) as unknown as TestApp;
  app.disposeSyncDatabase = () => syncDatabase?.dispose();
  app.disposeRuntime = () => runtime.dispose();
  return app;
}

function tenantContext(
  userId: string,
  sessionId: string,
  tenantId: string,
  membershipId: string,
): SyncAuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    sessionKind: 'web',
    sessionId,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
    authorizationAssignmentRevision: '0',
  };
}

function createDurableAuthorityHarness(): {
  verifier: SyncTokenVerifier;
  add(token: string, context: SyncAuthContext): void;
  revoke(sessionId: string): void;
  restore(sessionId: string): void;
} {
  const contextsByToken = new Map<string, SyncAuthContext>();
  const contextsBySession = new Map<string, SyncAuthContext>();
  const activeSessions = new Set<string>();

  const verifier: SyncTokenVerifier = {
    async resolveAuthContext(token) {
      return contextsByToken.get(token) ?? null;
    },
    async verifyAccessToken(token) {
      const context = contextsByToken.get(token);
      return context
        ? { sub: context.userId, email: context.email, role: context.role }
        : null;
    },
    captureAuthContextAuthority(context) {
      if (!context.sessionId
        || !context.sessionKind
        || !context.sessionScopeKind
        || !context.sessionScopeId) return null;
      return {
        version: 1,
        userId: context.userId,
        platformRole: context.role,
        authGeneration: 0,
        sessionKind: context.sessionKind,
        sessionId: context.sessionId,
        sessionGeneration: context.sessionGeneration ?? null,
        clientId: context.clientId ?? null,
        identityScopes: context.scope ?? [],
        sessionScopeKind: context.sessionScopeKind,
        sessionScopeId: context.sessionScopeId,
        tenantId: context.tenantId ?? null,
        membershipId: context.membershipId ?? null,
        tenantRole: context.tenantRole ?? null,
        tenantAuthorizationGeneration: context.tenantAuthorizationGeneration ?? null,
        membershipAuthorizationGeneration: context.membershipAuthorizationGeneration ?? null,
        authorizationAssignmentRevision: context.authorizationAssignmentRevision ?? null,
      } satisfies SyncAuthContextAuthorityReference;
    },
    resolveAuthContextAuthority(reference) {
      if (!activeSessions.has(reference.sessionId)) return null;
      return contextsBySession.get(reference.sessionId) ?? null;
    },
  };

  return {
    verifier,
    add(token, context) {
      if (!context.sessionId) throw new Error('Test context requires a session id');
      contextsByToken.set(token, context);
      contextsBySession.set(context.sessionId, context);
      activeSessions.add(context.sessionId);
    },
    revoke(sessionId) {
      activeSessions.delete(sessionId);
    },
    restore(sessionId) {
      if (!contextsBySession.has(sessionId)) throw new Error('Unknown test session');
      activeSessions.add(sessionId);
    },
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function connect(app: TestApp): Promise<TestConnection> {
  const server = app.server!;
  const ws = new WebSocket(
    `ws://${server.hostname ?? 'localhost'}:${server.port!}/sync`,
  );
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index]!;
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(index, 1);
      waiter.resolve(message);
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  return {
    ws,
    messages,
    waitForMessage(predicate, timeout = 2_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index !== -1) waiters.splice(index, 1);
            reject(new Error('Timed out waiting for WebSocket message'));
          }, timeout),
        };
        waiters.push(waiter);
      });
    },
    waitForClose(timeout = 2_000) {
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.removeEventListener('close', onClose);
          reject(new Error('Timed out waiting for WebSocket close'));
        }, timeout);
        const onClose = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.addEventListener('close', onClose, { once: true });
      });
    },
    close() {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('WebSocket closed'));
      }
      const terminable = ws as WebSocket & { terminate?: () => void };
      if (typeof terminable.terminate === 'function') terminable.terminate();
      else ws.close();
    },
  };
}

async function authenticate(connection: TestConnection, token: string): Promise<void> {
  connection.ws.send(JSON.stringify({ type: 'sync.auth', token }));
  await connection.waitForMessage((message) => message.type === 'sync.auth.ready');
}

async function subscribeState(connection: TestConnection): Promise<void> {
  connection.ws.send(JSON.stringify({ type: 'state.subscribe' }));
  await connection.waitForMessage((message) => message.type === 'state.snapshot');
}
