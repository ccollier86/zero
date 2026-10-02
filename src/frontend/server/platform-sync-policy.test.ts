import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { deliverSyncChange } from '../../sync/sync-change-delivery';
import { handleSyncSubscribe } from '../../sync/sync-subscribe-handler';
import { clearSyncBackpressure } from '../../sync/sync-wire-send';
import type {
  Row,
  ServerMessage,
  SyncHistoryGap,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccessContext,
  SyncSocketData,
} from '../../sync/types';
import { PlatformSyncPolicyService } from './platform-sync-policy';

const GAP: SyncHistoryGap = {
  kind: 'retention',
  afterSeq: 0,
  oldestSeq: 2,
  currentSeq: 3,
};

const CONTEXT: SyncResourceTableAccessContext = {
  tableNames: ['rooms'],
  authContext: {
    userId: 'user-1',
    email: 'user-1@example.test',
    role: 'user',
  },
};

let db: ReactiveDB | null = null;

afterEach(() => {
  db?.dispose();
  db = null;
});

describe('PlatformSyncPolicyService history-gap reset', () => {
  test('fails closed when a delegated reserved table is absent from the system data plane', async () => {
    db = createReactiveDB({ mode: 'memory' });
    const policy = new PlatformSyncPolicyService({
      delegate: allowAllPolicy(),
      getDB: () => db,
      tenancyMode: 'single',
    });

    const access = await policy.resolveTableAccess({
      tableNames: [
        'workflow_instances',
        'notifications',
        'rooms',
        'app_documents',
      ],
      authContext: CONTEXT.authContext,
    });

    expect([...access.readableTables]).toEqual(['app_documents']);
    expect(access.rowFilters.size).toBe(0);
    expect(access.rowProjectors?.size ?? 0).toBe(0);
  });

  test('composes platform and delegated projections for snapshot, catch-up, and live rows', async () => {
    db = createReactiveDB({ mode: 'memory' });
    defineWorkflowInstanceProjectionTable(db);
    db.insert('workflow_instances', workflowProjectionRow('private-before'));

    let fullRowMatches = 0;
    const delegate = allowAllPolicy();
    delegate.resolveTableAccess = async ({ tableNames }) => ({
      readableTables: new Set(tableNames),
      rowFilters: new Map([[
        'workflow_instances',
        {
          matches(row) {
            if (row.private_secret === 'private-before'
              || row.private_secret === 'private-after') fullRowMatches += 1;
            return row.private_secret === 'private-before'
              || row.private_secret === 'private-after';
          },
          project(row) {
            expect(row).not.toHaveProperty('private_secret');
            expect(row).not.toHaveProperty('graph_json');
            return { ...row, delegated_filter_projection: true };
          },
        },
      ]]),
      rowProjectors: new Map([[
        'workflow_instances',
        {
          project(row) {
            expect(row.delegated_filter_projection).toBe(true);
            return { ...row, delegated_row_projection: true };
          },
        },
      ]]),
      policyFingerprint: 'delegated-projection-policy',
    });
    const policy = new PlatformSyncPolicyService({
      delegate,
      getDB: () => db,
      tenancyMode: 'single',
    });
    const access = await policy.resolveTableAccess({
      tableNames: ['workflow_instances'],
      authContext: CONTEXT.authContext,
    });
    const row = db.get('workflow_instances', 'workflow-projection-1');
    if (!row) throw new Error('Expected workflow projection fixture');
    expect(access.rowFilters.get('workflow_instances')?.matches(row)).toBe(true);
    expect(fullRowMatches).toBeGreaterThan(0);

    const target = platformSocket();
    installAccess(target.data, access);
    await handleSyncSubscribe(target.value, {
      type: 'sync.subscribe',
      tables: ['workflow_instances'],
      snapshot: ['workflow_instances'],
      lastSeq: 0,
      epoch: 'force-snapshot',
      scope: 'scope-a',
    }, db);
    const snapshot = target.messages.find((message) => message.type === 'sync.snapshot');
    if (snapshot?.type !== 'sync.snapshot') throw new Error('Expected Sync snapshot');
    expectPublicDelegatedProjection(
      snapshot.tables.workflow_instances?.['workflow-projection-1'],
    );

    const baselineSequence = snapshot.seq;
    const updated = db.update('workflow_instances', 'workflow-projection-1', {
      private_secret: 'private-after',
      status: 'waiting',
    });
    if (!updated) throw new Error('Expected workflow update');
    deliverSyncChange(
      [target.value],
      updated,
      db.syncEpoch,
      'other-connection',
    );
    const live = target.messages.find(
      (message) => message.type === 'sync.change' && message.seq === updated.seq,
    );
    if (live?.type !== 'sync.change') throw new Error('Expected live Sync change');
    expectPublicDelegatedProjection(live.row);

    const resumed = platformSocket();
    installAccess(resumed.data, access);
    await handleSyncSubscribe(resumed.value, {
      type: 'sync.subscribe',
      tables: ['workflow_instances'],
      lastSeq: baselineSequence,
      epoch: db.syncEpoch,
      scope: 'scope-a',
    }, db);
    const catchup = resumed.messages.find((message) => message.type === 'sync.catchup');
    if (catchup?.type !== 'sync.catchup') throw new Error('Expected Sync catch-up');
    expect(catchup.changes).toHaveLength(1);
    expectPublicDelegatedProjection(catchup.changes[0]?.row);
  });

  test('fails closed when a delegated projector removes the row identity', async () => {
    db = createReactiveDB({ mode: 'memory' });
    defineWorkflowInstanceProjectionTable(db);
    db.insert('workflow_instances', workflowProjectionRow('private-before'));
    const delegate = allowAllPolicy();
    delegate.resolveTableAccess = async ({ tableNames }) => ({
      readableTables: new Set(tableNames),
      rowFilters: new Map(),
      rowProjectors: new Map([[
        'workflow_instances',
        {
          project(row) {
            const { instance_id: _identity, ...withoutIdentity } = row;
            return withoutIdentity;
          },
        },
      ]]),
      policyFingerprint: 'invalid-projection-policy',
    });
    const policy = new PlatformSyncPolicyService({
      delegate,
      getDB: () => db,
      tenancyMode: 'single',
    });
    const access = await policy.resolveTableAccess({
      tableNames: ['workflow_instances'],
      authContext: CONTEXT.authContext,
    });
    const row = db.get('workflow_instances', 'workflow-projection-1');
    if (!row) throw new Error('Expected workflow projection fixture');

    expect(() => access.rowProjectors?.get('workflow_instances')?.project(row))
      .toThrow("ZERO_SYNC_ROW_PROJECTION_IDENTITY: projector changed or removed 'workflow_instances.instance_id'");
  });

  test('preserves delegated realm, exposure, and physical data-plane proofs', () => {
    const delegate = allowAllPolicy();
    delegate.classifyManagedTableRealm = (table) => table === 'documents'
      ? 'tenant'
      : null;
    delegate.classifyManagedTableExposure = (table) => table === 'documents'
      ? 'all'
      : null;
    delegate.classifyManagedTableDataPlane = (table) => table === 'documents'
      ? 'tenant'
      : null;
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => null });

    expect(policy.classifyManagedTableRealm('documents')).toBe('tenant');
    expect(policy.classifyManagedTableExposure('documents')).toBe('all');
    expect(policy.classifyManagedTableDataPlane('documents')).toBe('tenant');
    expect(policy.classifyManagedTableDataPlane('unknown')).toBeNull();
  });

  test('preserves delegated comparable read authority and validator receiver', async () => {
    const delegate = allowAllPolicy() as SyncResourcePolicyAdapter & {
      revision: string;
    };
    delegate.revision = 'revision-1';
    delegate.resolveTableAccess = async function resolveTableAccess(context) {
      return {
        readableTables: new Set(context.tableNames),
        rowFilters: new Map(),
        policyFingerprint: 'allow-all',
        readAuthorityFingerprint: this.revision,
      };
    };
    delegate.validateReadAuthorityAtDelivery = function validate(_context, expected) {
      return this.revision === expected;
    };
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => null });
    const access = await policy.resolveTableAccess({
      tableNames: ['documents'],
      authContext: CONTEXT.authContext,
    });

    expect(access.readAuthorityFingerprint).toBe('revision-1');
    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      'revision-1',
    )).toBeTrue();
    delegate.revision = 'revision-2';
    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      'revision-1',
    )).toBeFalse();
  });

  test('invalidates comparable delivery authority when room membership changes', async () => {
    db = createPolicyDatabase();
    db.insert('rooms', {
      room_id: 'room-1',
      created_by: 'user-2',
      tenant_id: null,
    });
    db.insert('room_members', {
      member_id: 'member-1',
      room_id: 'room-1',
      user_id: 'user-1',
      tenant_id: null,
    });
    const policy = new PlatformSyncPolicyService({
      delegate: comparableAllowAllPolicy(),
      getDB: () => db,
    });
    const access = await policy.resolveTableAccess(CONTEXT);
    const fingerprint = access.readAuthorityFingerprint;
    if (!fingerprint) throw new Error('Expected comparable room authority');

    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      fingerprint,
    )).toBeTrue();
    const change = db.delete('room_members', 'member-1');
    if (!change) throw new Error('Expected membership deletion');
    policy.observeChange(change);
    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      fingerprint,
    )).toBeFalse();
  });

  test('stops a backpressured room snapshot after membership is revoked', async () => {
    db = createPolicyDatabase();
    for (const suffix of ['1', '2']) {
      db.insert('rooms', {
        room_id: `room-${suffix}`,
        created_by: `user-2-${'x'.repeat(600_000)}`,
        tenant_id: null,
      });
      db.insert('room_members', {
        member_id: `member-${suffix}`,
        room_id: `room-${suffix}`,
        user_id: 'user-1',
        tenant_id: null,
      });
    }
    const policy = new PlatformSyncPolicyService({
      delegate: comparableAllowAllPolicy(),
      getDB: () => db,
    });
    const access = await policy.resolveTableAccess(CONTEXT);
    const fingerprint = access.readAuthorityFingerprint;
    if (!fingerprint) throw new Error('Expected comparable room authority');
    const target = platformSocket([-1]);
    installAccess(target.data, access);
    const assertAuthority = () => {
      if (!policy.validateReadAuthorityAtDelivery(CONTEXT.authContext, fingerprint)) {
        throw new Error('read authority changed');
      }
    };

    const pending = handleSyncSubscribe(target.value, {
      type: 'sync.subscribe',
      tables: ['rooms'],
      snapshot: ['rooms'],
      lastSeq: 0,
      epoch: 'force-snapshot',
      scope: 'scope-a',
    }, db, undefined, undefined, assertAuthority);
    await Promise.resolve();
    await Promise.resolve();
    expect(target.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);

    const change = db.delete('room_members', 'member-1');
    if (!change) throw new Error('Expected membership deletion');
    policy.observeChange(change);
    clearSyncBackpressure(target.value);

    await expect(pending).rejects.toThrow('read authority changed');
    expect(target.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);
    expect(target.data.lastSeq).toBe(0);
  });

  test('does not flush a room change queued before membership revocation', async () => {
    db = createPolicyDatabase();
    db.insert('rooms', {
      room_id: 'room-1',
      created_by: 'user-2',
      tenant_id: null,
    });
    db.insert('room_members', {
      member_id: 'member-1',
      room_id: 'room-1',
      user_id: 'user-1',
      tenant_id: null,
    });
    const policy = new PlatformSyncPolicyService({
      delegate: comparableAllowAllPolicy(),
      getDB: () => db,
    });
    const access = await policy.resolveTableAccess(CONTEXT);
    const fingerprint = access.readAuthorityFingerprint;
    if (!fingerprint) throw new Error('Expected comparable room authority');
    const target = platformSocket([-1]);
    installAccess(target.data, access);
    const isCurrent = () => policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      fingerprint,
    );
    const assertAuthority = () => {
      if (!isCurrent()) throw new Error('read authority changed');
    };

    const pending = handleSyncSubscribe(target.value, {
      type: 'sync.subscribe',
      tables: ['rooms'],
      snapshot: ['rooms'],
      lastSeq: 0,
      epoch: 'force-snapshot',
      scope: 'scope-a',
    }, db, undefined, undefined, assertAuthority);
    await Promise.resolve();
    await Promise.resolve();
    expect(target.messages.map((message) => message.type)).toEqual(['sync.snapshot']);

    const roomChange = db.update('rooms', 'room-1', { created_by: 'user-3' });
    if (!roomChange) throw new Error('Expected room update');
    policy.observeChange(roomChange);
    deliverSyncChange(
      [target.value],
      roomChange,
      db.syncEpoch,
      'other-connection',
      () => isCurrent(),
    );
    const membershipChange = db.delete('room_members', 'member-1');
    if (!membershipChange) throw new Error('Expected membership deletion');
    policy.observeChange(membershipChange);
    clearSyncBackpressure(target.value);

    await expect(pending).rejects.toThrow('read authority changed');
    expect(target.messages.map((message) => message.type)).toEqual(['sync.snapshot']);
    expect(target.data.lastSeq).toBe(2);
  });

  test('rejects an asynchronous delegated observer before its result can be hidden', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy();
    delegate.observeChange = (async () => {}) as typeof delegate.observeChange;
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    expect(() => policy.observeChange({
      seq: 1,
      table: 'rooms',
      op: 'INSERT',
      rowId: 'room-1',
      row: { room_id: 'room-1' },
      previousRow: null,
      ts: Date.now(),
    })).toThrow('ZERO_SYNC_POLICY_OBSERVER_ASYNC');
  });

  test('preserves the delegated observer method receiver', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy() as SyncResourcePolicyAdapter & { observations: number };
    delegate.observations = 0;
    delegate.observeChange = function observeChange() {
      this.observations += 1;
    };
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    policy.observeChange({
      seq: 1,
      table: 'rooms',
      op: 'INSERT',
      rowId: 'room-1',
      row: { room_id: 'room-1' },
      previousRow: null,
      ts: Date.now(),
    });

    expect(delegate.observations).toBe(1);
  });

  test('refreshes an existing room-membership filter after skipped history', async () => {
    db = createPolicyDatabase();
    db.insert('rooms', {
      room_id: 'room-1',
      created_by: 'user-2',
      tenant_id: null,
    });
    db.insert('room_members', {
      member_id: 'member-1',
      room_id: 'room-1',
      user_id: 'user-1',
      tenant_id: null,
    });
    const policy = new PlatformSyncPolicyService({
      delegate: allowAllPolicy(),
      getDB: () => db,
    });
    const before = await policy.resolveTableAccess(CONTEXT);
    const filter = before.rowFilters.get('rooms');
    const room = db.get('rooms', 'room-1');
    if (!filter || !room) throw new Error('Expected room policy fixture');

    expect(filter.matches(room)).toBe(true);
    // Model a skipped remote change: SQLite is authoritative, while the
    // process-local observeChange-derived revision did not see this DELETE.
    db.getRawDatabase().run(
      "DELETE FROM main.room_members WHERE member_id = 'member-1'",
    );
    expect(filter.matches(room)).toBe(true);

    policy.onHistoryGap(GAP);

    expect(filter.matches(room)).toBe(false);
    const after = await policy.resolveTableAccess(CONTEXT);
    expect(after.policyFingerprint).not.toBe(before.policyFingerprint);
  });

  test('rejects a stateful delegate that cannot reset after skipped history', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy();
    delegate.observeChange = () => {};
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    expect(() => policy.onHistoryGap(GAP)).toThrow(
      'ZERO_SYNC_POLICY_HISTORY_GAP_UNHANDLED',
    );
  });

  test('rejects an asynchronous delegated reset before reconnect can proceed', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy();
    delegate.observeChange = () => {};
    delegate.onHistoryGap = (async () => {}) as typeof delegate.onHistoryGap;
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    expect(() => policy.onHistoryGap(GAP)).toThrow(
      'ZERO_SYNC_POLICY_HISTORY_GAP_ASYNC',
    );
  });

  test('preserves the delegated method receiver while resetting policy state', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy() as SyncResourcePolicyAdapter & { resets: number };
    delegate.resets = 0;
    delegate.observeChange = function observeChange() {
      void this.resets;
    };
    delegate.onHistoryGap = function onHistoryGap() {
      this.resets += 1;
    };
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    policy.onHistoryGap(GAP);

    expect(delegate.resets).toBe(1);
  });
});

function createPolicyDatabase(): ReactiveDB {
  const reactive = createReactiveDB({ mode: 'memory' });
  reactive.defineTable('rooms', {
    room_id: 'text primary key',
    created_by: 'text not null',
    tenant_id: 'text',
  });
  reactive.defineTable('room_members', {
    member_id: 'text primary key',
    room_id: 'text not null',
    user_id: 'text not null',
    tenant_id: 'text',
  });
  return reactive;
}

function defineWorkflowInstanceProjectionTable(reactive: ReactiveDB): void {
  reactive.defineTable('workflow_instances', {
    instance_id: 'text primary key',
    tenant_id: 'text',
    definition_id: 'text not null',
    name: 'text not null',
    status: 'text not null',
    input: 'text',
    output: 'text',
    error: 'text',
    current_step: 'integer not null',
    started_by: 'text not null',
    steps_json: 'text not null',
    graph_json: 'text',
    definition_version_id: 'text',
    definition_version: 'integer',
    graph_fingerprint: 'text',
    private_secret: 'text not null',
    created_at: 'text not null',
    updated_at: 'text not null',
    completed_at: 'text',
  });
}

function workflowProjectionRow(privateSecret: string): Row {
  const now = new Date().toISOString();
  return {
    instance_id: 'workflow-projection-1',
    tenant_id: null,
    definition_id: 'projection-definition',
    name: 'projection-test',
    status: 'running',
    input: JSON.stringify({ secret: 'input' }),
    output: JSON.stringify({ secret: 'output' }),
    error: 'private error',
    current_step: 0,
    started_by: CONTEXT.authContext!.userId,
    steps_json: '[]',
    graph_json: JSON.stringify({ nodes: [] }),
    definition_version_id: 'definition-version-1',
    definition_version: 1,
    graph_fingerprint: 'graph-fingerprint-1',
    private_secret: privateSecret,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
}

function expectPublicDelegatedProjection(row: Row | null | undefined): void {
  expect(row).toMatchObject({
    instance_id: 'workflow-projection-1',
    input: null,
    output: null,
    error: null,
    delegated_filter_projection: true,
    delegated_row_projection: true,
  });
  expect(row).not.toHaveProperty('private_secret');
  expect(row).not.toHaveProperty('graph_json');
  expect(row).not.toHaveProperty('definition_version_id');
}

function allowAllPolicy(): SyncResourcePolicyAdapter {
  return {
    async resolveTableAccess(context) {
      return {
        readableTables: new Set(context.tableNames),
        rowFilters: new Map(),
        policyFingerprint: 'allow-all',
      };
    },
    async authorizeMutation() {
      return { ok: true };
    },
  };
}

function comparableAllowAllPolicy(): SyncResourcePolicyAdapter {
  const delegate = allowAllPolicy();
  delegate.resolveTableAccess = async (context) => ({
    readableTables: new Set(context.tableNames),
    rowFilters: new Map(),
    policyFingerprint: 'allow-all',
    readAuthorityFingerprint: 'delegate-authority',
  });
  delegate.validateReadAuthorityAtDelivery = (_context, expected) => (
    expected === 'delegate-authority'
  );
  return delegate;
}

function platformSocket(sendStatuses: number[] = []) {
  const messages: ServerMessage[] = [];
  const data: SyncSocketData = {
    allowedTables: new Set(['rooms']),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: CONTEXT.authContext,
    authResolved: true,
    authorizationFingerprint: 'policy',
    readAuthorizationFingerprint: null,
    authorizationScope: 'scope-a',
    connectionId: 'connection-1',
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
    resourceRowFilters: new Map(),
    resourceRowProjectors: new Map(),
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) {
      messages.push(JSON.parse(payload));
      return sendStatuses.shift() ?? payload.length;
    },
    close() {},
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, messages };
}

function installAccess(
  data: SyncSocketData,
  access: Awaited<ReturnType<PlatformSyncPolicyService['resolveTableAccess']>>,
): void {
  data.allowedTables = access.readableTables;
  data.resourceRowFilters = access.rowFilters;
  data.resourceRowProjectors = access.rowProjectors ?? new Map();
  data.readAuthorizationFingerprint = access.readAuthorityFingerprint ?? null;
}
