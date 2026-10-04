import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createWorkflowMemoryContext } from './workflow-memory-context';
import { WorkflowError, type WorkflowErrorCode } from './workflow-error';
import { WorkflowMemoryStore } from './workflow-memory-store';
import { defineWorkflowTables } from './workflow-schema';

const NOW = '2030-01-02T03:04:05.000Z';
const SCOPE = { instanceId: 'instance-1', kind: 'instance' as const };

let db: ReactiveDB;
let store: WorkflowMemoryStore;

beforeEach(() => {
  db = openMemoryDb();
  seedWorkflow(db, 'instance-1');
  store = new WorkflowMemoryStore(db, { clock: () => new Date(NOW) });
});

afterEach(() => {
  db.dispose();
});

describe('workflow scratch memory', () => {
  test('provides atomic optimistic set, update, delete, and transaction operations', () => {
    const created = store.set(SCOPE, 'counter', 0, { expectedVersion: null });
    expect(created).toMatchObject({ value: 0, version: 1, updatedAt: NOW });

    const incremented = store.update(SCOPE, 'counter', (value) => Number(value) + 1, {
      expectedVersion: 1,
      updatedByStepId: 'step-1',
      updatedByAttemptId: 'attempt-1',
    });
    expect(incremented).toMatchObject({
      value: 1,
      version: 2,
      updatedByStepId: 'step-1',
      updatedByAttemptId: 'attempt-1',
    });

    expectWorkflowCode(
      () => store.set(SCOPE, 'counter', 2, { expectedVersion: 1 }),
      'WORKFLOW_MEMORY_CONFLICT',
    );
    store.transaction(SCOPE, undefined, (memory) => {
      memory.set('first', { ok: true }, { expectedVersion: null });
      memory.set('second', ['a', 'b'], { expectedVersion: null });
      memory.delete('counter', { expectedVersion: 2 });
    });
    expect(store.list(SCOPE).map((entry) => entry.key)).toEqual(['first', 'second']);
  });

  test('rolls back all writes when the fence goes stale before commit', () => {
    let fenceChecks = 0;
    expectWorkflowCode(
      () => store.transaction(SCOPE, () => ++fenceChecks === 1, (memory) => {
        memory.set('unsafe', 'must rollback');
      }),
      'WORKFLOW_ATTEMPT_STALE',
    );
    expect(fenceChecks).toBe(2);
    expect(store.get(SCOPE, 'unsafe')).toBeNull();
  });

  test('rolls back callbacks and aggregate limit failures without publishing changes', () => {
    const limited = new WorkflowMemoryStore(db, {
      clock: () => new Date(NOW),
      limits: { maxEntries: 1, maxTotalBytes: 32, maxValueBytes: 16 },
    });
    const changes: string[] = [];
    const unsubscribe = db.onChange((change) => {
      if (change.table === '_workflow_memory') changes.push(change.rowId);
    });
    expectWorkflowCode(
      () => limited.transaction(SCOPE, undefined, (memory) => {
        memory.set('a', 1);
        memory.set('b', 2);
      }),
      'WORKFLOW_MEMORY_LIMIT_EXCEEDED',
    );
    expect(limited.list(SCOPE)).toEqual([]);
    expect(changes).toEqual([]);

    expect(() => limited.transaction(SCOPE, undefined, (memory) => {
      memory.set('a', 1);
      throw new Error('rollback requested');
    })).toThrow('rollback requested');
    expect(limited.list(SCOPE)).toEqual([]);
    unsubscribe();
  });

  test('rejects non-JSON and oversized values before durable state changes', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const invalid of [undefined, Number.NaN, 1n, new Date(), cyclic]) {
      expectWorkflowCode(
        () => store.set(SCOPE, 'invalid', invalid),
        'WORKFLOW_MEMORY_VALUE_INVALID',
      );
    }
    const sparse = new Array(2);
    sparse[1] = 'value';
    expectWorkflowCode(
      () => store.set(SCOPE, 'invalid', sparse),
      'WORKFLOW_MEMORY_VALUE_INVALID',
    );

    const limited = new WorkflowMemoryStore(db, {
      limits: { maxValueBytes: 8, maxTotalBytes: 16 },
    });
    expectWorkflowCode(
      () => limited.set(SCOPE, 'large', '123456789'),
      'WORKFLOW_MEMORY_LIMIT_EXCEEDED',
    );
    expect(limited.get(SCOPE, 'large')).toBeNull();
  });

  test('isolates instance and each-item namespaces', () => {
    const itemA = { instanceId: 'instance-1', kind: 'each-item' as const, scopeId: 'patient-a' };
    const itemB = { instanceId: 'instance-1', kind: 'each-item' as const, scopeId: 'patient-b' };
    store.set(SCOPE, 'status', 'workflow');
    store.set(itemA, 'status', 'verified');
    store.set(itemB, 'status', 'pending');

    expect(store.get(SCOPE, 'status')?.value).toBe('workflow');
    expect(store.get(itemA, 'status')?.value).toBe('verified');
    expect(store.get(itemB, 'status')?.value).toBe('pending');
  });

  test('pins a restart-safe per-instance budget without changing ordinary defaults', () => {
    seedWorkflow(db, 'instance-default');
    const policy = store.createInstancePolicy('instance-1', {
      maxEntries: 512,
      maxTotalBytes: 2 * 1024 * 1024,
    });

    expect(policy).toMatchObject({
      maxKeyBytes: 256,
      maxValueBytes: 64 * 1024,
      maxEntries: 512,
      maxTotalBytes: 2 * 1024 * 1024,
    });
    expect(store.limitsForInstance('instance-1')).toEqual(policy);
    expect(store.limitsForInstance('instance-default')).toEqual(store.limits);
    expectWorkflowCode(
      () => store.createInstancePolicy('instance-1', { maxEntries: 513 }),
      'WORKFLOW_STATE_INVALID',
    );
  });

  test('returns each concurrent increment result and preserves the final count', async () => {
    store.set(SCOPE, 'counter', 0);
    const values = await Promise.all(Array.from({ length: 100 }, async () => {
      return store.update(SCOPE, 'counter', (value) => Number(value) + 1).value;
    }));
    expect([...values].sort((a, b) => Number(a) - Number(b)))
      .toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    expect(store.get(SCOPE, 'counter')?.value).toBe(100);
  });
});

describe('attempt-local memory context', () => {
  test('stages an overlay and commits it with step and attempt attribution', () => {
    store.set(SCOPE, 'profile', { name: 'Before' });
    const attempt = createWorkflowMemoryContext(store, {
      scope: SCOPE,
      stepId: 'step-1',
      attemptId: 'attempt-1',
    });
    attempt.memory.update('profile', () => ({ name: 'After' }));
    attempt.memory.set('approved', true);
    expect(attempt.memory.toJSON()).toEqual({ approved: true, profile: { name: 'After' } });
    expect(store.get(SCOPE, 'approved')).toBeNull();

    const committed = attempt.commit(() => true);
    expect(committed.find((entry) => entry.key === 'approved')).toMatchObject({
      value: true,
      updatedByStepId: 'step-1',
      updatedByAttemptId: 'attempt-1',
    });
    expect(() => attempt.memory.get('approved')).toThrow(/no longer active/);
  });

  test('discarded and stale attempts never leak partial state into a retry', () => {
    const failed = createWorkflowMemoryContext(store, {
      scope: SCOPE, stepId: 'step-1', attemptId: 'attempt-failed',
    });
    failed.memory.set('partial', { shouldNotPersist: true });
    failed.discard();

    const retry = createWorkflowMemoryContext(store, {
      scope: SCOPE, stepId: 'step-1', attemptId: 'attempt-retry',
    });
    expect(retry.memory.has('partial')).toBe(false);
    retry.memory.set('result', 'complete');
    expectWorkflowCode(() => retry.commit(() => false), 'WORKFLOW_ATTEMPT_STALE');
    expect(store.list(SCOPE)).toEqual([]);
  });

  test('detects an external write made after the attempt snapshot', () => {
    store.set(SCOPE, 'shared', 1);
    const attempt = createWorkflowMemoryContext(store, {
      scope: SCOPE, stepId: 'step-1', attemptId: 'attempt-1',
    });
    attempt.memory.set('shared', 2);
    store.set(SCOPE, 'shared', 3);
    expectWorkflowCode(() => attempt.commit(() => true), 'WORKFLOW_MEMORY_CONFLICT');
    expect(store.get(SCOPE, 'shared')?.value).toBe(3);
  });
});

test('workflow memory survives a file-backed restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zero-workflow-memory-'));
  const path = join(directory, 'workflow.db');
  let first: ReactiveDB | null = null;
  let second: ReactiveDB | null = null;
  try {
    first = openMemoryDb(path);
    seedWorkflow(first, 'restart-instance');
    const firstStore = new WorkflowMemoryStore(first);
    firstStore.set(
      { instanceId: 'restart-instance', kind: 'instance' },
      'checkpoint',
      { page: 7 },
    );
    firstStore.createInstancePolicy('restart-instance', {
      maxEntries: 512,
      maxTotalBytes: 2 * 1024 * 1024,
    });
    first.dispose();
    first = null;

    second = openMemoryDb(path);
    const recoveredStore = new WorkflowMemoryStore(second);
    const recovered = recoveredStore.get(
      { instanceId: 'restart-instance', kind: 'instance' },
      'checkpoint',
    );
    expect(recovered).toMatchObject({ value: { page: 7 }, version: 1 });
    expect(recoveredStore.limitsForInstance('restart-instance')).toMatchObject({
      maxEntries: 512,
      maxTotalBytes: 2 * 1024 * 1024,
    });
  } finally {
    first?.dispose();
    second?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

function openMemoryDb(path?: string): ReactiveDB {
  const database = createReactiveDB({ mode: path ?? 'memory' });
  defineWorkflowTables(database);
  return database;
}

function seedWorkflow(database: ReactiveDB, instanceId: string): void {
  const definitionId = `definition-${instanceId}`;
  database.insert('workflow_definitions', {
    definition_id: definitionId,
    name: definitionId,
    steps_json: '[]',
    created_at: NOW,
    updated_at: NOW,
  });
  database.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: definitionId,
    name: definitionId,
    input: null,
    steps_json: '[]',
    created_at: NOW,
    updated_at: NOW,
  });
  database.prepare(`INSERT INTO _workflow_runtime_usage (instance_id, runtime_bytes)
    VALUES (?, 0)`).run(instanceId);
  database.prepare(`INSERT INTO _workflow_event_usage (
    instance_id, total_count, total_bytes, queued_count, queued_bytes, revision
  ) VALUES (?, 0, 0, 0, 0, 0)`).run(instanceId);
}

function expectWorkflowCode(fn: () => unknown, code: WorkflowErrorCode): void {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowError);
    expect((error as WorkflowError).code).toBe(code);
  }
}
