import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { SyncResourcePolicyAdapter } from '../sync/types';
import { defineWorkflowTables } from './workflow-schema';
import { createWorkflowSyncPolicyAdapter } from './workflow-sync-policy';

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

    const policy = createWorkflowSyncPolicyAdapter({ getDB: () => db });
    const access = await policy.resolveTableAccess({
      tableNames: [
        'workflow_definitions',
        'workflow_instances',
        'workflow_steps',
        'workflow_events',
      ],
      authContext: { userId: 'user-1', email: 'one@example.test', role: 'user' },
    });

    expect(access.readableTables.has('workflow_definitions')).toBe(false);
    expect(matchingIds(db, 'workflow_instances', 'instance_id', access, 'workflow_instances'))
      .toEqual(['owned']);
    expect(matchingIds(db, 'workflow_steps', 'step_id', access, 'workflow_steps'))
      .toEqual(['step-owned']);
    expect(matchingIds(db, 'workflow_events', 'event_id', access, 'workflow_events'))
      .toEqual(['event-owned']);
    const instanceFilter = access.rowFilters.get('workflow_instances')!;
    const projected = instanceFilter.project!(
      db.queryOne('workflow_instances', 'owned')!,
    );
    expect(projected).not.toHaveProperty('steps_json');
    const stepFilter = access.rowFilters.get('workflow_steps')!;
    const projectedStep = stepFilter.project!(db.queryOne('workflow_steps', 'step-owned')!);
    expect(projectedStep.step_name).toBe('Public step');
    expect(projectedStep).not.toHaveProperty('wait_event');
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
      tableNames: ['workflow_instances', 'workflow_steps', 'workflow_events'],
      authContext: null,
    });

    for (const table of ['workflow_instances', 'workflow_steps', 'workflow_events']) {
      const filter = access.rowFilters.get(table);
      expect(filter).toBeDefined();
      expect(db.query(table).every((row) => !filter!.matches(row))).toBe(true);
    }
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
}
