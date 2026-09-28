import { Elysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../reactive-db';
import { createSyncPlugin } from '../sync.plugin';
import type { SyncResourcePolicyAdapter, SyncTokenVerifier } from '../types';

const RESULT_PREFIX = 'ZERO_FATAL_REPLICA_RESULT:';
const path = Bun.argv[2];
if (!path) throw new Error('Expected a SQLite path');

try {
  const dbHolder: { value?: ReactiveDB } = {};
  const app = new Elysia().use(createSyncPlugin({
    db: { mode: path, busyTimeout: 10_000 },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    replicaChangePolling: { intervalMs: 10 },
    onDatabaseCreated(created) { dbHolder.value = created; },
  })).listen(0);
  const db = dbHolder.value;
  if (!db) throw new Error('Sync database was not created');

  const url = `ws://${app.server!.hostname}:${app.server!.port}/sync`;
  const current = await openSocket(url);
  current.socket.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['todos'],
    snapshot: ['todos'],
    lastSeq: 0,
  }));
  await current.waitForMessage((message) => message.type === 'sync.snapshot');

  const raw = db.getRawDatabase();
  raw.run('DROP TRIGGER _zero_sync_log_state_update_fence_v1');
  raw.run(`
    UPDATE _zero_sync_log_state
    SET schema_version = 2, write_format = 2
    WHERE singleton = 1
  `);
  const currentClose = await current.closed;

  const future = await openSocket(url);
  const futureClose = await future.closed;

  const recoveryDbHolder: { value?: ReactiveDB } = {};
  const observedHistoryGaps: Array<Record<string, unknown>> = [];
  const recoveryApp = new Elysia().use(createSyncPlugin({
    db: { mode: `${path}.recovery`, busyTimeout: 10_000 },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    replicaChangePolling: { intervalMs: 10 },
    resourcePolicy: {
      async resolveTableAccess() {
        return {
          readableTables: new Set(['todos']),
          rowFilters: new Map(),
          policyFingerprint: 'fixture-policy',
        };
      },
      async authorizeMutation() { return { ok: true }; },
      observeChange() {},
      onHistoryGap(gap) { observedHistoryGaps.push({ ...gap }); },
    },
    onDatabaseCreated(created) { recoveryDbHolder.value = created; },
  })).listen(0);
  const recoveryDb = recoveryDbHolder.value;
  if (!recoveryDb) throw new Error('Recovery Sync database was not created');
  const recoveryUrl = `ws://${recoveryApp.server!.hostname}:${recoveryApp.server!.port}/sync`;
  const stale = await openSocket(recoveryUrl);
  stale.socket.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['todos'],
    snapshot: ['todos'],
    lastSeq: 0,
  }));
  const baseline = await stale.waitForMessage((message) => message.type === 'sync.snapshot');
  const recoveryRaw = recoveryDb.getRawDatabase();
  recoveryRaw.run('DROP TRIGGER _zero_sync_changes_insert_fence_v1');
  recoveryRaw.transaction(() => {
    recoveryRaw.run(`
      UPDATE main._zero_sync_log_state
      SET seq = seq + 1
      WHERE singleton = 1
    `);
    recoveryRaw.run(`
      INSERT INTO main._changes
        (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
      VALUES (1, 'todos', 'INSERT', 'future', '{"id":"future","title":"Future"}',
        NULL, 1, 'future-writer', 2)
    `);
  }).immediate();
  const staleClose = await stale.closed;
  const recovered = await openSocket(recoveryUrl);
  recovered.socket.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['todos'],
    snapshot: ['todos'],
    lastSeq: 0,
    epoch: baseline.epoch,
    scope: baseline.scope,
  }));
  const replacement = await recovered.waitForMessage(
    (message) => message.type === 'sync.snapshot',
  );

  const missingPolicyReset = await exerciseUnsafeGapPolicy(
    `${path}.missing-policy-reset`,
    {
      async resolveTableAccess() {
        return {
          readableTables: new Set(['todos']),
          rowFilters: new Map(),
          policyFingerprint: 'missing-reset-policy',
        };
      },
      async authorizeMutation() { return { ok: true }; },
      observeChange() {},
    },
  );
  const asyncPolicyReset = await exerciseUnsafeGapPolicy(
    `${path}.async-policy-reset`,
    {
      async resolveTableAccess() {
        return {
          readableTables: new Set(['todos']),
          rowFilters: new Map(),
          policyFingerprint: 'async-reset-policy',
        };
      },
      async authorizeMutation() { return { ok: true }; },
      observeChange() {},
      onHistoryGap: (async () => {}) as SyncResourcePolicyAdapter['onHistoryGap'],
    },
  );
  const localObserverFailure = await exercisePolicyDeliveryFailure(
    `${path}.local-observer-failure`,
    'local',
    'observer-throw',
  );
  const externalObserverFailure = await exercisePolicyDeliveryFailure(
    `${path}.external-observer-failure`,
    'external',
    'observer-throw',
  );
  const asyncObserverFailure = await exercisePolicyDeliveryFailure(
    `${path}.async-observer-failure`,
    'local',
    'observer-async',
  );
  const projectorFailure = await exercisePolicyDeliveryFailure(
    `${path}.projector-failure`,
    'local',
    'projector-throw',
  );

  let releaseVerification!: () => void;
  let markVerificationStarted!: () => void;
  const verificationStarted = new Promise<void>((resolve) => {
    markVerificationStarted = resolve;
  });
  const verificationReleased = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  const verifier: SyncTokenVerifier = {
    async verifyAccessToken() {
      markVerificationStarted();
      await verificationReleased;
      return { sub: 'pending-user', email: 'pending@example.test', role: 'user' };
    },
  };
  const pendingDbHolder: { value?: ReactiveDB } = {};
  const pendingApp = new Elysia().use(createSyncPlugin({
    db: { mode: `${path}.pending`, busyTimeout: 10_000 },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    replicaChangePolling: { intervalMs: 10 },
    auth: {
      required: true,
      getTokenVerifier: () => verifier,
    },
    onDatabaseCreated(created) { pendingDbHolder.value = created; },
  })).listen(0);
  const pendingDb = pendingDbHolder.value;
  if (!pendingDb) throw new Error('Pending-auth Sync database was not created');
  const pending = await openSocket(
    `ws://${pendingApp.server!.hostname}:${pendingApp.server!.port}/sync`,
  );
  pending.socket.send(JSON.stringify({ type: 'sync.auth', token: 'pending-token' }));
  await withTimeout(verificationStarted, 'Deferred verification start');
  const pendingRaw = pendingDb.getRawDatabase();
  pendingRaw.run('DROP TRIGGER _zero_sync_log_state_update_fence_v1');
  pendingRaw.run(`
    UPDATE _zero_sync_log_state
    SET schema_version = 2, write_format = 2
    WHERE singleton = 1
  `);
  const pendingClose = await pending.closed;
  releaseVerification();
  await Bun.sleep(25);

  console.log(`${RESULT_PREFIX}${JSON.stringify({
    current: { code: currentClose.code, reason: currentClose.reason },
    future: { code: futureClose.code, reason: futureClose.reason },
    futureMessages: future.messages,
    pending: { code: pendingClose.code, reason: pendingClose.reason },
    pendingMessages: pending.messages,
    recovery: {
      close: { code: staleClose.code, reason: staleClose.reason },
      replacement,
      observedHistoryGaps,
    },
    missingPolicyReset,
    asyncPolicyReset,
    localObserverFailure,
    externalObserverFailure,
    asyncObserverFailure,
    projectorFailure,
  })}`);
  // Bun's in-process WebSocket client can leave a server-side close handshake
  // pending after it has emitted the correct CloseEvent. This fixture exits
  // only after capturing the wire result so the parent test can reap the
  // disposable process deterministically.
  await Bun.sleep(10);
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}

async function exercisePolicyDeliveryFailure(
  databasePath: string,
  source: 'local' | 'external',
  failure: 'observer-throw' | 'observer-async' | 'projector-throw',
): Promise<{
  current: { code: number; reason: string };
  future: { code: number; reason: string };
}> {
  let armed = false;
  const holder: { value?: ReactiveDB } = {};
  const resourcePolicy: SyncResourcePolicyAdapter = {
    async resolveTableAccess() {
      return {
        readableTables: new Set(['todos']),
        rowFilters: new Map(),
        rowProjectors: failure === 'projector-throw'
          ? new Map([['todos', {
            project(row) {
              if (armed) throw new Error('projector failed');
              return row;
            },
          }]])
          : new Map(),
        policyFingerprint: `delivery-failure-${failure}`,
      };
    },
    async authorizeMutation() { return { ok: true }; },
    observeChange: failure === 'observer-throw'
      ? () => {
        if (armed) throw new Error('observer failed');
      }
      : failure === 'observer-async'
        ? (async () => {}) as SyncResourcePolicyAdapter['observeChange']
        : undefined,
    onHistoryGap() {},
  };
  const policyApp = new Elysia().use(createSyncPlugin({
    db: { mode: databasePath, busyTimeout: 10_000 },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    replicaChangePolling: { intervalMs: 10 },
    resourcePolicy,
    onDatabaseCreated(created) { holder.value = created; },
  })).listen(0);
  const policyDb = holder.value;
  if (!policyDb) throw new Error('Policy-delivery Sync database was not created');
  const policyUrl = `ws://${policyApp.server!.hostname}:${policyApp.server!.port}/sync`;
  const current = await openSocket(policyUrl);
  current.socket.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['todos'],
    snapshot: ['todos'],
    lastSeq: 0,
  }));
  await current.waitForMessage((message) => message.type === 'sync.snapshot');
  armed = true;

  if (source === 'local') {
    policyDb.insert('todos', { id: 'unsafe', title: 'Unsafe delivery' });
  } else {
    const writer = createReactiveDB({ mode: databasePath, busyTimeout: 10_000 });
    try {
      writer.defineTable('todos', {
        id: 'text primary key',
        title: 'text not null',
      });
      writer.insert('todos', { id: 'unsafe', title: 'Unsafe delivery' });
    } finally {
      writer.dispose();
    }
  }

  const currentClose = await current.closed;
  const future = await openSocket(policyUrl);
  const futureClose = await future.closed;
  return {
    current: { code: currentClose.code, reason: currentClose.reason },
    future: { code: futureClose.code, reason: futureClose.reason },
  };
}

async function exerciseUnsafeGapPolicy(
  databasePath: string,
  resourcePolicy: SyncResourcePolicyAdapter,
): Promise<{
  current: { code: number; reason: string };
  future: { code: number; reason: string };
}> {
  const holder: { value?: ReactiveDB } = {};
  const policyApp = new Elysia().use(createSyncPlugin({
    db: { mode: databasePath, busyTimeout: 10_000 },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    replicaChangePolling: { intervalMs: 10 },
    resourcePolicy,
    onDatabaseCreated(created) { holder.value = created; },
  })).listen(0);
  const policyDb = holder.value;
  if (!policyDb) throw new Error('Unsafe-policy Sync database was not created');
  const policyUrl = `ws://${policyApp.server!.hostname}:${policyApp.server!.port}/sync`;
  const current = await openSocket(policyUrl);
  current.socket.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['todos'],
    snapshot: ['todos'],
    lastSeq: 0,
  }));
  await current.waitForMessage((message) => message.type === 'sync.snapshot');

  const raw = policyDb.getRawDatabase();
  raw.run('DROP TRIGGER _zero_sync_changes_insert_fence_v1');
  raw.transaction(() => {
    raw.run(`
      UPDATE main._zero_sync_log_state
      SET seq = seq + 1
      WHERE singleton = 1
    `);
    raw.run(`
      INSERT INTO main._changes
        (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
      VALUES (1, 'todos', 'INSERT', 'future', '{"id":"future","title":"Future"}',
        NULL, 1, 'future-writer', 2)
    `);
  }).immediate();

  const currentClose = await current.closed;
  const future = await openSocket(policyUrl);
  const futureClose = await future.closed;
  return {
    current: { code: currentClose.code, reason: currentClose.reason },
    future: { code: futureClose.code, reason: futureClose.reason },
  };
}

async function openSocket(url: string): Promise<{
  socket: WebSocket;
  messages: Array<Record<string, unknown>>;
  closed: Promise<CloseEvent>;
  waitForMessage: (
    predicate: (message: Record<string, unknown>) => boolean,
  ) => Promise<Record<string, unknown>>;
}> {
  const socket = new WebSocket(url);
  const closed = waitForClose(socket);
  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
  }> = [];
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as Record<string, unknown>;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  await withTimeout(new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket open failed')), {
      once: true,
    });
  }), 'WebSocket open');
  return {
    socket,
    messages,
    closed,
    waitForMessage: (predicate) => withTimeout(new Promise((resolve) => {
      const existing = messages.find(predicate);
      if (existing) {
        resolve(existing);
        return;
      }
      waiters.push({ predicate, resolve });
    }), 'WebSocket message'),
  };
}

function waitForClose(socket: WebSocket): Promise<CloseEvent> {
  return withTimeout(new Promise((resolve) => {
    socket.addEventListener('close', resolve, { once: true });
  }), 'WebSocket close');
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), 2_000);
    }),
  ]);
}
