import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { SyncResourcePolicyAdapter } from '../sync/types';
import { defineWorkflowTables } from './workflow-schema';
import { createWorkflowSyncPolicyAdapter } from './workflow-sync-policy';
import { WORKFLOW_SERVER_TABLE_NAMES } from './types';

describe('workflow sync policy', () => {
  let db: ReactiveDB | null = null;

  afterEach(() => {
    db?.dispose();
    db = null;
  });

  test('excludes definitions and filters runtime rows to their owner', async () => {
    db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    seedWorkflow(db, 'owned', 'user-1', 'visible');
    seedWorkflow(db, 'foreign', 'user-2', 'visible');
    // Migration 030 annotates legacy rows; that must not silently change the
    // established 1.3 payload projection when the owning instance is legacy.
    db.update('workflow_steps', 'step-owned', {
      node_id: 'legacy.0',
      node_kind: 'task',
    });

    const policy = createWorkflowSyncPolicyAdapter({ getDB: () => db });
    const access = await policy.resolveTableAccess({
      tableNames: [
        'workflow_definitions',
        'workflow_definition_versions',
        '_workflow_memory',
        'workflow_instances',
        'workflow_steps',
        'workflow_events',
        'workflow_interactions',
      ],
      authContext: { userId: 'user-1', email: 'one@example.test', role: 'user' },
    });

    expect(access.readableTables.has('workflow_definitions')).toBe(false);
    expect(access.readableTables.has('workflow_definition_versions')).toBe(false);
    expect(access.readableTables.has('_workflow_memory')).toBe(false);
    expect(matchingIds(db, 'workflow_instances', 'instance_id', access, 'workflow_instances'))
      .toEqual(['owned']);
    expect(matchingIds(db, 'workflow_steps', 'step_id', access, 'workflow_steps'))
      .toEqual(['step-owned']);
    expect(matchingIds(db, 'workflow_events', 'event_id', access, 'workflow_events'))
      .toEqual(['event-owned']);
    expect(matchingIds(
      db,
      'workflow_interactions',
      'interaction_id',
      access,
      'workflow_interactions',
    )).toEqual(['interaction-owned']);
    const instanceFilter = access.rowFilters.get('workflow_instances')!;
    const projected = instanceFilter.project!(
      db.queryOne('workflow_instances', 'owned')!,
    );
    expect(projected).not.toHaveProperty('steps_json');
    expect(projected.input).toBeNull();
    expect(projected.output).toBeNull();
    expect(projected.error).toBeNull();
    const stepFilter = access.rowFilters.get('workflow_steps')!;
    const projectedStep = stepFilter.project!(db.queryOne('workflow_steps', 'step-owned')!);
    expect(projectedStep.step_name).toBe('Public step');
    expect(projectedStep).not.toHaveProperty('wait_event');
    expect(projectedStep.input).toBeNull();
    expect(projectedStep.output).toBeNull();
    expect(projectedStep.error).toBeNull();
  });

  test('lets global admins inspect runtime rows while retaining delegate denials and predicates', async () => {
    db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    seedWorkflow(db, 'allowed', 'user-1', 'allowed');
    seedWorkflow(db, 'filtered', 'user-2', 'filtered');

    const delegate: SyncResourcePolicyAdapter = {
      async resolveTableAccess({ tableNames }) {
        const readableTables = new Set(tableNames);
        readableTables.delete('delegate_denied');
        return {
          readableTables,
          rowFilters: new Map([[
            'workflow_instances',
            {
              matches: (row) => row.name === 'allowed',
              project(row) {
                expect(row).not.toHaveProperty('steps_json');
                const { delegate_secret: _delegateSecret, ...projected } = row;
                return projected;
              },
            },
          ]]),
          policyFingerprint: 'delegate-policy',
        };
      },
      async authorizeMutation() {
        return { ok: false, reason: 'delegate denied', code: 'delegate-denied' };
      },
    };
    const policy = createWorkflowSyncPolicyAdapter({ getDB: () => db, delegate });
    const access = await policy.resolveTableAccess({
      tableNames: ['workflow_definitions', 'workflow_instances', 'delegate_denied'],
      authContext: { userId: 'admin-1', email: 'admin@example.test', role: 'admin' },
    });

    expect(access.readableTables.has('workflow_definitions')).toBe(false);
    expect(access.readableTables.has('delegate_denied')).toBe(false);
    expect(matchingIds(db, 'workflow_instances', 'instance_id', access, 'workflow_instances'))
      .toEqual(['allowed']);
    const projected = access.rowFilters.get('workflow_instances')!.project!({
      ...db.queryOne('workflow_instances', 'allowed')!,
      delegate_secret: 'hidden',
    });
    expect(projected).not.toHaveProperty('steps_json');
    expect(projected).not.toHaveProperty('delegate_secret');

    const workflowMutation = await policy.authorizeMutation!({
      table: 'workflow_instances', op: 'UPDATE', rowId: 'allowed', row: {},
      authContext: { userId: 'admin-1', email: 'admin@example.test', role: 'admin' },
      loadRow: () => null,
    });
    expect(workflowMutation).toEqual({
      ok: false,
      reason: 'Table is read-only over sync: workflow_instances',
      code: 'workflow-sync-read-only',
    });

    const delegatedMutation = await policy.authorizeMutation!({
      table: 'app_records', op: 'UPDATE', rowId: 'record-1', row: {},
      authContext: { userId: 'admin-1', email: 'admin@example.test', role: 'admin' },
      loadRow: () => null,
    });
    expect(delegatedMutation).toEqual({
      ok: false, reason: 'delegate denied', code: 'delegate-denied',
    });
  });

  test('fails workflow runtime rows closed when no authenticated owner exists', async () => {
    db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    seedWorkflow(db, 'instance-1', 'user-1', 'visible');
    const policy = createWorkflowSyncPolicyAdapter({ getDB: () => db });
    const access = await policy.resolveTableAccess({
      tableNames: [
        'workflow_instances', 'workflow_steps', 'workflow_events', 'workflow_interactions',
      ],
      authContext: null,
    });

    for (const table of [
      'workflow_instances', 'workflow_steps', 'workflow_events', 'workflow_interactions',
    ]) {
      const filter = access.rowFilters.get(table);
      expect(filter).toBeDefined();
      expect(db.query(table).every((row) => !filter!.matches(row))).toBe(true);
    }
  });

  test('denies every server-only workflow table even if a delegate exposes it', async () => {
    const runtimeTables = new Set([
      'workflow_instances',
      'workflow_steps',
      'workflow_events',
      'workflow_interactions',
    ]);
    const access = await createWorkflowSyncPolicyAdapter({ getDB: () => null })
      .resolveTableAccess({
        tableNames: [...WORKFLOW_SERVER_TABLE_NAMES],
        authContext: { userId: 'admin-1', email: 'admin@example.test', role: 'admin' },
      });

    for (const table of WORKFLOW_SERVER_TABLE_NAMES) {
      expect(access.readableTables.has(table)).toBe(runtimeTables.has(table));
      if (!runtimeTables.has(table)) expect(access.rowFilters.has(table)).toBe(false);
    }
  });

  test('keeps all graph execution payloads out of the live projection', async () => {
    db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    seedWorkflow(db, 'graph-run', 'user-1', 'private-progress');
    db.update('workflow_instances', 'graph-run', {
      graph_json: '{"schemaVersion":1}',
      graph_fingerprint: 'private-fingerprint',
      input: '{"patient":"private"}',
      output: '{"result":"private"}',
      error: 'private instance failure',
    });
    db.update('workflow_steps', 'step-graph-run', {
      // Even a malformed graph row without node metadata fails closed based
      // on its owning graph instance.
      node_id: null,
      node_kind: 'activity',
      input: '{"request":"private"}',
      output: '{"accepted":"private"}',
      error: 'private activity failure',
    });
    db.update('workflow_events', 'event-graph-run', {
      payload: '{"code":"123456"}',
    });
    const now = new Date().toISOString();
    db.insert('workflow_steps', {
      step_id: 'delivery-graph-run', instance_id: 'graph-run', step_index: 0,
      step_name: 'Deliver approval', status: 'completed',
      input: '{"request":"private"}', output: '{"provider":"private"}', error: null,
      retries: 0, max_retries: 3, retry_at: null, wait_event: null,
      timeout_at: null, started_at: now, completed_at: now, created_at: now,
      node_id: 'approval/delivery/0', node_kind: 'activity', node_path: 'approval/delivery/0',
      parent_step_id: 'step-graph-run', branch_key: null, item_key: null,
      item_index: null, activation_key: 'delivery:0', updated_at: now,
    });

    const access = await createWorkflowSyncPolicyAdapter({ getDB: () => db })
      .resolveTableAccess({
        tableNames: ['workflow_instances', 'workflow_steps', 'workflow_events'],
        authContext: { userId: 'user-1', email: 'one@example.test', role: 'user' },
      });
    const projectedInstance = access.rowFilters.get('workflow_instances')!.project!(
      db.queryOne('workflow_instances', 'graph-run')!,
    );
    expect(projectedInstance.input).toBeNull();
    expect(projectedInstance.output).toBeNull();
    expect(projectedInstance.error).toBeNull();
    const stepProjection = access.rowFilters.get('workflow_steps')!.project!;
    for (const stepId of ['step-graph-run', 'delivery-graph-run']) {
      const projected = stepProjection(db.queryOne('workflow_steps', stepId)!);
      expect(projected.input).toBeNull();
      expect(projected.output).toBeNull();
      expect(projected.error).toBeNull();
    }
    const projectedEvent = access.rowFilters.get('workflow_events')!.project!(
      db.queryOne('workflow_events', 'event-graph-run')!,
    );
    expect(projectedEvent.payload).toBeNull();

    // The durable server rows remain available to the workflow runtime.
    expect(db.queryOne('workflow_steps', 'step-graph-run')?.output)
      .toBe('{"accepted":"private"}');
    expect(db.queryOne('workflow_instances', 'graph-run')?.output)
      .toBe('{"result":"private"}');
    expect(db.queryOne('workflow_events', 'event-graph-run')?.payload)
      .toBe('{"code":"123456"}');
  });

  test('fails orphaned child records closed even for platform administrators', async () => {
    db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const now = new Date().toISOString();
    const orphanStep = {
      step_id: 'orphan-step', instance_id: 'missing-instance', step_index: 0,
      step_name: 'private-handler', status: 'failed', input: '{"secret":"input"}',
      output: '{"secret":"output"}', error: 'private failure', retries: 0,
      max_retries: 0, retry_at: null, wait_event: null, timeout_at: null,
      started_at: now, completed_at: now, created_at: now,
    };
    const orphanEvent = {
      event_id: 'orphan-event', instance_id: 'missing-instance',
      event_name: 'private-event', payload: '{"secret":"event"}',
      sent_by: 'user-1', created_at: now,
    };
    const orphanInteraction = {
      interaction_id: 'orphan-interaction', instance_id: 'missing-instance',
      node_id: 'approval', step_id: 'orphan-step', safe_label: 'Approval required',
      status: 'open', opened_at: now, expires_at: null, accepted_at: null,
      accepted_by: null, rejection_count: 0, max_rejections: 3,
      created_at: now, updated_at: now,
    };

    const access = await createWorkflowSyncPolicyAdapter({ getDB: () => db })
      .resolveTableAccess({
        tableNames: ['workflow_steps', 'workflow_events', 'workflow_interactions'],
        authContext: { userId: 'admin-1', email: 'admin@example.test', role: 'admin' },
      });

    for (const [table, row] of [
      ['workflow_steps', orphanStep],
      ['workflow_events', orphanEvent],
      ['workflow_interactions', orphanInteraction],
    ] as const) {
      const filter = access.rowFilters.get(table)!;
      expect(filter.matches(row)).toBe(false);
    }

    // Projection also fails closed if a caller projects a corrupted child row
    // before evaluating its predicate.
    const projectedStep = access.rowFilters.get('workflow_steps')!.project!(
      orphanStep,
    );
    expect(projectedStep.input).toBeNull();
    expect(projectedStep.output).toBeNull();
    expect(projectedStep.error).toBeNull();
    const projectedEvent = access.rowFilters.get('workflow_events')!.project!(
      orphanEvent,
    );
    expect(projectedEvent.payload).toBeNull();
  });

  test('preserves an unfingerprintable delegated row policy', async () => {
    const delegate: SyncResourcePolicyAdapter = {
      async resolveTableAccess({ tableNames }) {
        return {
          readableTables: new Set(tableNames),
          rowFilters: new Map([[
            'app_records',
            { matches: (row) => row.owner_id === 'dynamic-owner' },
          ]]),
        };
      },
      async authorizeMutation() {
        return { ok: true };
      },
    };
    const policy = createWorkflowSyncPolicyAdapter({ getDB: () => db, delegate });
    const access = await policy.resolveTableAccess({
      tableNames: ['app_records', 'workflow_instances'],
      authContext: { userId: 'user-1', email: 'one@example.test', role: 'user' },
    });

    expect(access.rowFilters.has('app_records')).toBe(true);
    expect(access.rowFilters.has('workflow_instances')).toBe(true);
    expect(access.policyFingerprint).toBeUndefined();
  });
});

function matchingIds(
  db: ReactiveDB,
  table: string,
  id: string,
  access: Awaited<ReturnType<SyncResourcePolicyAdapter['resolveTableAccess']>>,
  filterTable: string,
): string[] {
  const filter = access.rowFilters.get(filterTable);
  return db.query(table)
    .filter((row) => filter?.matches(row) ?? true)
    .map((row) => String(row[id]))
    .sort();
}

function seedWorkflow(
  db: ReactiveDB,
  instanceId: string,
  ownerId: string,
  name: string,
): void {
  const now = new Date().toISOString();
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: `definition-${instanceId}`,
    name,
    status: 'running',
    current_step: 0,
    input: '{"legacy":"input"}',
    output: '{"legacy":"output"}',
    error: 'legacy error',
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
    input: '{"legacy":"step-input"}',
    output: '{"legacy":"step-output"}',
    error: 'legacy step error',
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: 'continue',
    timeout_at: null,
    started_at: now,
    completed_at: null,
    created_at: now,
  });
  db.insert('workflow_events', {
    event_id: `event-${instanceId}`,
    instance_id: instanceId,
    event_name: 'continue',
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
