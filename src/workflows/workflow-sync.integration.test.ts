import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createSyncPlugin, getSyncDB } from '../sync/sync.plugin';
import { createDefaultSyncPolicy } from '../sync/sync-policy';
import type { ServerMessage, SyncTokenVerifier } from '../sync/types';
import { flow, parallel, requestAndWait, step, waitFor } from './workflow-dsl';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';
import { createWorkflowSyncPolicyAdapter } from './workflow-sync-policy';

describe('workflow Sync isolation', () => {
  test('filters snapshots and live changes by owner while admins retain runtime visibility', async () => {
    const verifier = createVerifier();
    const snapshotTables = new Set([
      'workflow_instances', 'workflow_steps', 'workflow_events', 'workflow_interactions',
    ]);
    const pending = new Elysia().use(createSyncPlugin({
      db: { mode: 'memory', ringBufferDepth: 100 },
      tables: {},
      snapshotTables,
      auth: {
        required: false,
        allowLegacyQueryToken: true,
        getTokenVerifier: () => verifier,
      },
      policy: createDefaultSyncPolicy({
        readProtectedTables: ['workflow_definitions'],
        writeProtectedTables: [
          'workflow_definitions', 'workflow_instances',
          'workflow_steps', 'workflow_events', 'workflow_interactions',
        ],
      }),
      resourcePolicy: createWorkflowSyncPolicyAdapter({ getDB: getSyncDB }),
    }));
    const db = getSyncDB()!;
    defineWorkflowTables(db);
    seedWorkflow(db, 'a-seed', 'user-a');
    seedWorkflow(db, 'b-seed', 'user-b');
    seedDefinition(db, 'server-definition');
    const app = pending.listen(0);
    const user = await connectWS(appUrl(app, 'user-a-token'));
    const admin = await connectWS(appUrl(app, 'admin-token'));
    const anonymous = await connectWS(appUrl(app));
    const reconnects: Array<{ close: () => void }> = [];

    try {
      subscribe(user.ws);
      subscribe(admin.ws);
      subscribe(anonymous.ws);
      const userSnapshot = await user.waitForMessage((message) => message.type === 'sync.snapshot');
      const adminSnapshot = await admin.waitForMessage((message) => message.type === 'sync.snapshot');
      const anonymousSnapshot = await anonymous.waitForMessage(
        (message) => message.type === 'sync.snapshot',
      );
      if (userSnapshot.type !== 'sync.snapshot'
        || adminSnapshot.type !== 'sync.snapshot'
        || anonymousSnapshot.type !== 'sync.snapshot') {
        throw new Error('Expected workflow snapshots');
      }

      expect(userSnapshot.tables.workflow_definitions).toBeUndefined();
      expect(Object.keys(userSnapshot.tables.workflow_instances ?? {})).toEqual(['a-seed']);
      expect(userSnapshot.tables.workflow_instances?.['a-seed'])
        .not.toHaveProperty('steps_json');
      expect(Object.keys(userSnapshot.tables.workflow_steps ?? {})).toEqual(['step-a-seed']);
      expect(userSnapshot.tables.workflow_steps?.['step-a-seed']?.step_name)
        .toBe('Public step');
      expect(userSnapshot.tables.workflow_steps?.['step-a-seed'])
        .not.toHaveProperty('wait_event');
      expect(Object.keys(userSnapshot.tables.workflow_events ?? {})).toEqual(['event-a-seed']);
      expect(Object.keys(userSnapshot.tables.workflow_interactions ?? {}))
        .toEqual(['interaction-a-seed']);

      expect(adminSnapshot.tables.workflow_definitions).toBeUndefined();
      expect(Object.keys(adminSnapshot.tables.workflow_instances ?? {}).sort())
        .toEqual(['a-seed', 'b-seed']);
      expect(adminSnapshot.tables.workflow_instances?.['b-seed'])
        .not.toHaveProperty('steps_json');
      expect(Object.keys(adminSnapshot.tables.workflow_steps ?? {}).sort())
        .toEqual(['step-a-seed', 'step-b-seed']);
      expect(adminSnapshot.tables.workflow_steps?.['step-b-seed']?.step_name)
        .toBe('Public step');
      expect(Object.keys(adminSnapshot.tables.workflow_events ?? {}).sort())
        .toEqual(['event-a-seed', 'event-b-seed']);
      expect(Object.keys(adminSnapshot.tables.workflow_interactions ?? {}).sort())
        .toEqual(['interaction-a-seed', 'interaction-b-seed']);

      expect(anonymousSnapshot.tables.workflow_definitions).toBeUndefined();
      expect(anonymousSnapshot.tables.workflow_instances).toEqual({});
      expect(anonymousSnapshot.tables.workflow_steps).toEqual({});
      expect(anonymousSnapshot.tables.workflow_events).toEqual({});
      expect(anonymousSnapshot.tables.workflow_interactions).toEqual({});

      user.ws.send(JSON.stringify({
        type: 'sync.mutate',
        ref: 'workflow-runtime-write',
        table: 'workflow_instances',
        op: 'UPDATE',
        rowId: 'a-seed',
        row: { status: 'cancelled' },
      }));
      const deniedMutation = await user.waitForMessage(
        (message) => message.type === 'sync.ack'
          && message.ref === 'workflow-runtime-write',
      );
      expect(deniedMutation).toEqual({
        type: 'sync.ack',
        ref: 'workflow-runtime-write',
        seq: null,
        ok: false,
        error: 'Table is read-only over sync: workflow_instances',
      });
      expect(db.queryOne('workflow_instances', 'a-seed')?.status).toBe('running');

      seedWorkflow(db, 'b-live', 'user-b');
      seedDefinition(db, 'never-synced');
      seedWorkflow(db, 'a-live', 'user-a');
      await user.waitForMessage(
        (message) => message.type === 'sync.change' && message.rowId === 'interaction-a-live',
      );
      await admin.waitForMessage(
        (message) => message.type === 'sync.change' && message.rowId === 'interaction-b-live',
      );

      const userLiveIds = user.messages
        .filter((message) => message.type === 'sync.change')
        .map((message) => message.rowId);
      expect(userLiveIds).toEqual([
        'a-live', 'step-a-live', 'event-a-live', 'interaction-a-live',
      ]);
      expect(userLiveIds).not.toContain('b-live');
      expect(userLiveIds).not.toContain('step-b-live');
      expect(userLiveIds).not.toContain('event-b-live');
      expect(userLiveIds).not.toContain('interaction-b-live');
      expect(userLiveIds).not.toContain('definition-never-synced');
      const userLiveInstance = user.messages.find(
        (message) => message.type === 'sync.change' && message.rowId === 'a-live',
      );
      expect(userLiveInstance).toMatchObject({ type: 'sync.change' });
      if (userLiveInstance?.type === 'sync.change') {
        expect(userLiveInstance.row).not.toHaveProperty('steps_json');
      }
      const userLiveStep = user.messages.find(
        (message) => message.type === 'sync.change' && message.rowId === 'step-a-live',
      );
      if (userLiveStep?.type !== 'sync.change') {
        throw new Error('Expected projected live workflow step');
      }
      expect(userLiveStep.row?.step_name).toBe('Public step');
      expect(userLiveStep.row).not.toHaveProperty('wait_event');

      const adminLiveIds = admin.messages
        .filter((message) => message.type === 'sync.change')
        .map((message) => message.rowId);
      expect(adminLiveIds).toContain('b-live');
      expect(adminLiveIds).toContain('step-b-live');
      expect(adminLiveIds).toContain('event-b-live');
      expect(adminLiveIds).toContain('interaction-b-live');
      expect(adminLiveIds).not.toContain('definition-never-synced');
      const adminLiveInstance = admin.messages.find(
        (message) => message.type === 'sync.change' && message.rowId === 'b-live',
      );
      if (adminLiveInstance?.type !== 'sync.change') {
        throw new Error('Expected projected admin workflow instance');
      }
      expect(adminLiveInstance.row).not.toHaveProperty('steps_json');
      const adminLiveStep = admin.messages.find(
        (message) => message.type === 'sync.change' && message.rowId === 'step-b-live',
      );
      if (adminLiveStep?.type !== 'sync.change') {
        throw new Error('Expected projected admin workflow step');
      }
      expect(adminLiveStep.row?.step_name).toBe('Public step');
      expect(adminLiveStep.row).not.toHaveProperty('wait_event');
      expect(anonymous.messages.filter((message) => message.type === 'sync.change'))
        .toEqual([]);

      const resumed = await connectWS(appUrl(app, 'user-a-token'));
      reconnects.push(resumed);
      resumed.ws.send(JSON.stringify({
        type: 'sync.subscribe',
        tables: [
          'workflow_definitions', 'workflow_instances',
          'workflow_steps', 'workflow_events', 'workflow_interactions',
        ],
        lastSeq: userSnapshot.seq,
        epoch: userSnapshot.epoch,
        scope: userSnapshot.scope,
      }));
      const catchup = await resumed.waitForMessage(
        (message) => message.type === 'sync.catchup',
      );
      if (catchup.type !== 'sync.catchup') throw new Error('Expected Sync catchup');
      expect(catchup.changes.map((change) => change.rowId)).toEqual([
        'a-live', 'step-a-live', 'event-a-live', 'interaction-a-live',
      ]);
      expect(catchup.changes.find((change) => change.rowId === 'a-live')?.row)
        .not.toHaveProperty('steps_json');
      expect(catchup.changes.find((change) => change.rowId === 'step-a-live')?.row?.step_name)
        .toBe('Public step');
      expect(catchup.changes.find((change) => change.rowId === 'step-a-live')?.row)
        .not.toHaveProperty('wait_event');

      const adminResumed = await connectWS(appUrl(app, 'admin-token'));
      reconnects.push(adminResumed);
      subscribeFrom(adminResumed.ws, adminSnapshot);
      const adminCatchup = await adminResumed.waitForMessage(
        (message) => message.type === 'sync.catchup',
      );
      if (adminCatchup.type !== 'sync.catchup') {
        throw new Error('Expected admin Sync catchup');
      }
      expect(adminCatchup.changes.map((change) => change.rowId)).toEqual([
        'b-live', 'step-b-live', 'event-b-live', 'interaction-b-live',
        'a-live', 'step-a-live', 'event-a-live', 'interaction-a-live',
      ]);
      expect(adminCatchup.changes.find((change) => change.rowId === 'b-live')?.row)
        .not.toHaveProperty('steps_json');
      expect(adminCatchup.changes.find((change) => change.rowId === 'step-b-live')?.row?.step_name)
        .toBe('Public step');
      expect(adminCatchup.changes.find((change) => change.rowId === 'step-b-live')?.row)
        .not.toHaveProperty('wait_event');

      const anonymousResumed = await connectWS(appUrl(app));
      reconnects.push(anonymousResumed);
      subscribeFrom(anonymousResumed.ws, anonymousSnapshot);
      const anonymousCatchup = await anonymousResumed.waitForMessage(
        (message) => message.type === 'sync.catchup',
      );
      if (anonymousCatchup.type !== 'sync.catchup') {
        throw new Error('Expected anonymous Sync catchup');
      }
      expect(anonymousCatchup.changes).toEqual([]);

      seedWorkflow(db, 'scope-move', 'user-a');
      await user.waitForMessage(
        (message) => message.type === 'sync.change'
          && message.rowId === 'interaction-scope-move',
      );
      expect(() => db.update('workflow_instances', 'scope-move', {
        started_by: 'user-b',
        updated_at: new Date().toISOString(),
      })).toThrow(/ownership is immutable/);
      expect(db.queryOne('workflow_instances', 'scope-move')?.started_by)
        .toBe('user-a');
      expect(user.messages.some((message) => message.type === 'sync.change'
        && message.rowId === 'scope-move'
        && (message.op === 'UPDATE' || message.op === 'DELETE'))).toBe(false);
      expect(anonymous.messages.filter((message) => message.type === 'sync.change'))
        .toEqual([]);
    } finally {
      for (const reconnect of reconnects) reconnect.close();
      user.close();
      admin.close();
      anonymous.close();
      await app.stop(true);
    }
  });

  test('streams safe graph, parallel-branch, and interaction progress in real time', async () => {
    const verifier = createVerifier();
    const snapshotTables = new Set([
      'workflow_instances', 'workflow_steps', 'workflow_events', 'workflow_interactions',
    ]);
    const pending = new Elysia().use(createSyncPlugin({
      db: { mode: 'memory', ringBufferDepth: 500 },
      tables: {},
      snapshotTables,
      auth: {
        required: true,
        allowLegacyQueryToken: true,
        getTokenVerifier: () => verifier,
      },
      policy: createDefaultSyncPolicy({
        writeProtectedTables: [...snapshotTables],
      }),
      resourcePolicy: createWorkflowSyncPolicyAdapter({ getDB: getSyncDB }),
    }));
    const db = getSyncDB()!;
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'finalize-live-run',
      version: '1',
      default: true,
      handler: async ({ input }) => ({ finalized: true, branches: input }),
    });
    registry.registerWorkflow({
      name: 'live-visual-workflow',
      flow: flow(
        parallel('prepare', {
          records: [waitFor('records-ready', 'records.ready', { label: 'Records ready' })],
          approval: [requestAndWait('approval', 'approval.responded', {
            label: 'Approval required',
          })],
        }, { label: 'Prepare in parallel' }),
        step('finalize', 'finalize-live-run', { label: 'Finalize request' }),
      ),
    });
    const service = new WorkflowService(db, registry);
    const app = pending.listen(0);
    const owner = await connectWS(appUrl(app, 'user-a-token'));

    try {
      subscribe(owner.ws);
      await owner.waitForMessage((message) => message.type === 'sync.snapshot');
      const instanceId = await service.start(
        'live-visual-workflow',
        { privateRequest: 'must-not-sync' },
        'user-a',
      );

      const recordsStep = await owner.waitForMessage((message) =>
        message.type === 'sync.change'
        && message.table === 'workflow_steps'
        && message.row?.instance_id === instanceId
        && message.row?.node_id === 'records-ready'
        && message.row?.status === 'waiting');
      const approvalStep = await owner.waitForMessage((message) =>
        message.type === 'sync.change'
        && message.table === 'workflow_steps'
        && message.row?.instance_id === instanceId
        && message.row?.node_id === 'approval'
        && message.row?.status === 'waiting');
      if (recordsStep.type !== 'sync.change' || approvalStep.type !== 'sync.change') {
        throw new Error('Expected live graph step changes');
      }
      expect(recordsStep.row).toMatchObject({
        branch_key: 'records',
        step_name: 'Records ready',
        input: null,
        output: null,
        error: null,
      });
      expect(approvalStep.row).toMatchObject({
        branch_key: 'approval',
        step_name: 'Approval required',
        input: null,
        output: null,
        error: null,
      });

      const opened = await owner.waitForMessage((message) =>
        message.type === 'sync.change'
        && message.table === 'workflow_interactions'
        && message.row?.instance_id === instanceId
        && message.row?.status === 'open');
      if (opened.type !== 'sync.change') throw new Error('Expected live interaction change');
      expect(opened.row?.safe_label).toBe('Approval required');

      expect(await service.sendEvent(
        instanceId,
        'records.ready',
        { privateRecordId: 'record-1' },
        'user-a',
        { actorId: 'user-a', roles: ['user'] },
      )).toBe(true);
      const interaction = service.getGraphRuntime().interactions.listByInstance(instanceId)[0]!;
      await service.getGraphRuntime().submitInteraction({
        interactionId: interaction.interactionId,
        submissionId: 'live-approval-1',
        actor: { actorId: 'user-a', roles: ['user'] },
        payload: { approved: true },
        channel: 'test',
      });

      const completed = await owner.waitForMessage((message) =>
        message.type === 'sync.change'
        && message.table === 'workflow_instances'
        && message.rowId === instanceId
        && message.row?.status === 'completed');
      if (completed.type !== 'sync.change') throw new Error('Expected completed live run');
      expect(completed.row).toMatchObject({ input: null, output: null, error: null });
      expect(completed.row).not.toHaveProperty('graph_json');

      const eventChange = owner.messages.find((message) =>
        message.type === 'sync.change'
        && message.table === 'workflow_events'
        && message.row?.instance_id === instanceId);
      if (eventChange?.type !== 'sync.change') throw new Error('Expected live event audit row');
      expect(eventChange.row?.payload).toBeNull();
      expect(owner.messages.some((message) =>
        message.type === 'sync.change'
        && message.table === 'workflow_interactions'
        && message.row?.interaction_id === interaction.interactionId
        && message.row?.status === 'accepted')).toBe(true);
    } finally {
      owner.close();
      await service.dispose();
      await app.stop(true);
    }
  });
});

function createVerifier(): SyncTokenVerifier {
  return {
    async resolveAuthContext(token) {
      if (token === 'user-a-token') {
        return { userId: 'user-a', email: 'a@example.test', role: 'user' };
      }
      if (token === 'admin-token') {
        return { userId: 'admin', email: 'admin@example.test', role: 'admin' };
      }
      return null;
    },
    async verifyAccessToken() {
      return null;
    },
  };
}

function subscribe(ws: WebSocket): void {
  const tables = [
    'workflow_definitions',
    'workflow_instances',
    'workflow_steps',
    'workflow_events',
    'workflow_interactions',
  ];
  ws.send(JSON.stringify({
    type: 'sync.subscribe', tables, snapshot: tables, lastSeq: 0,
  }));
}

function subscribeFrom(
  ws: WebSocket,
  snapshot: Extract<ServerMessage, { type: 'sync.snapshot' }>,
): void {
  ws.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: [
      'workflow_definitions', 'workflow_instances',
      'workflow_steps', 'workflow_events', 'workflow_interactions',
    ],
    lastSeq: snapshot.seq,
    epoch: snapshot.epoch,
    scope: snapshot.scope,
  }));
}

function appUrl(
  app: { server: { hostname?: string; port?: number } | null },
  token?: string,
): string {
  const port = app.server?.port;
  if (typeof port !== 'number') throw new Error('Test server did not expose a port');
  const url = new URL(`ws://${app.server?.hostname ?? 'localhost'}:${port}/sync`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

async function connectWS(url: string): Promise<{
  ws: WebSocket;
  messages: ServerMessage[];
  waitForMessage: (predicate: (message: ServerMessage) => boolean) => Promise<ServerMessage>;
  close: () => void;
}> {
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];
  const ws = new WebSocket(url);
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (!waiters[index].predicate(message)) continue;
      waiters[index].resolve(message);
      waiters.splice(index, 1);
    }
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  return {
    ws,
    messages,
    waitForMessage(predicate) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for Sync message')),
          2_000,
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
    close: () => ws.close(),
  };
}

function seedDefinition(db: NonNullable<ReturnType<typeof getSyncDB>>, name: string): void {
  const now = new Date().toISOString();
  db.insert('workflow_definitions', {
    definition_id: `definition-${name}`,
    name,
    version: 1,
    steps_json: '[]',
    input_schema: null,
    created_at: now,
    updated_at: now,
  });
}

function seedWorkflow(
  db: NonNullable<ReturnType<typeof getSyncDB>>,
  instanceId: string,
  ownerId: string,
): void {
  const now = new Date().toISOString();
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: 'manual-definition',
    name: 'manual',
    status: 'running',
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: ownerId,
    steps_json: JSON.stringify([{ name: 'Public step', handler: 'internal-handler' }]),
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
  db.insert('workflow_steps', {
    step_id: `step-${instanceId}`,
    instance_id: instanceId,
    step_index: 0,
    step_name: 'internal-handler',
    status: 'waiting',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: 'continue',
    timeout_at: null,
    started_at: null,
    completed_at: null,
    created_at: now,
  });
  db.insert('workflow_events', {
    event_id: `event-${instanceId}`,
    instance_id: instanceId,
    event_name: 'audit',
    payload: null,
    sent_by: ownerId,
    created_at: now,
  });
  db.insert('workflow_interactions', {
    interaction_id: `interaction-${instanceId}`,
    instance_id: instanceId,
    node_id: 'approval',
    step_id: `step-${instanceId}`,
    safe_label: 'Approval required',
    status: 'open',
    opened_at: now,
    expires_at: null,
    accepted_at: null,
    accepted_by: null,
    rejection_count: 0,
    max_rejections: 3,
    created_at: now,
    updated_at: now,
  });
}
