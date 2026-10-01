import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { WorkflowRepository } from './workflow-repository';
import { defineWorkflowTables } from './workflow-schema';

const NOW = '2030-01-02T03:04:05.000Z';

let db: ReactiveDB;
let repository: WorkflowRepository;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
  repository = new WorkflowRepository(db);
});

afterEach(() => {
  db.dispose();
});

describe('workflow repository query contracts', () => {
  test('uses runtime indexes for frontier, retry, and timeout discovery', () => {
    const indexNames = (db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name LIKE 'idx_workflow_%'
    `).all() as Array<{ name: string }>).map((row) => row.name);
    expect(indexNames).toContain('idx_workflow_steps_instance_order');
    expect(indexNames).toContain('idx_workflow_steps_retry_due');
    expect(indexNames).toContain('idx_workflow_steps_timeout_due');

    expect(queryPlan(`
      SELECT * FROM workflow_steps
      WHERE instance_id = ?
      ORDER BY step_index ASC, rowid ASC
    `, 'instance')).toContain('idx_workflow_steps_instance_order');
    expect(queryPlan(`
      SELECT * FROM workflow_steps
      WHERE status = 'failed' AND retry_at IS NOT NULL AND retry_at <= ?
    `, NOW)).toContain('idx_workflow_steps_retry_due');
    expect(queryPlan(`
      SELECT * FROM workflow_steps
      WHERE timeout_at IS NOT NULL AND timeout_at <= ?
      ORDER BY timeout_at ASC, rowid ASC
    `, NOW)).toContain('idx_workflow_steps_timeout_due');
  });

  test('discovers only a due failed legal frontier on a running instance', () => {
    seedInstance('due', 'running');
    seedStep('due-0', 'due', 0, 'completed');
    seedStep('due-1', 'due', 1, 'failed', { retry_at: NOW });

    seedInstance('blocked', 'running');
    seedStep('blocked-0', 'blocked', 0, 'pending');
    seedStep('blocked-1', 'blocked', 1, 'failed', { retry_at: NOW });

    seedInstance('paused', 'paused');
    seedStep('paused-0', 'paused', 0, 'failed', { retry_at: NOW });

    seedInstance('later', 'running');
    seedStep('later-0', 'later', 0, 'failed', {
      retry_at: '2030-01-02T03:04:06.000Z',
    });

    expect(repository.listDueRetryInstanceIds(NOW)).toEqual(['due']);
  });

  test('orders equal-timestamp events by durable insertion order', () => {
    seedInstance('events', 'running');
    repository.insertEvent({
      event_id: 'event-z',
      instance_id: 'events',
      event_name: 'ready',
      payload: null,
      sent_by: null,
      created_at: NOW,
    });
    repository.insertEvent({
      event_id: 'event-a',
      instance_id: 'events',
      event_name: 'ready',
      payload: null,
      sent_by: null,
      created_at: NOW,
    });

    expect(repository.getEvents('events').map((event) => event.event_id))
      .toEqual(['event-z', 'event-a']);
  });

  test('requires exactly one durable predecessor output', () => {
    seedInstance('valid', 'running');
    seedStep('valid-0', 'valid', 0, 'completed', { output: '{"ok":true}' });
    seedStep('valid-1', 'valid', 1, 'pending');
    expect(repository.getPreviousStepOutput('valid', 1)).toBe('{"ok":true}');

    seedInstance('duplicate', 'running');
    seedStep('duplicate-a', 'duplicate', 0, 'completed');
    seedStep('duplicate-b', 'duplicate', 0, 'pending');
    expect(() => repository.getPreviousStepOutput('duplicate', 1)).toThrow(/exactly one/);
  });

  test('rejects workflow ownership and child-parent reassignment, including replacement writes', () => {
    seedInstance('owned', 'running', 'owner-a');
    seedInstance('other', 'running', 'owner-b');
    seedStep('owned-step', 'owned', 0, 'pending');
    repository.insertEvent({
      event_id: 'owned-event',
      instance_id: 'owned',
      event_name: 'ready',
      payload: null,
      sent_by: 'owner-a',
      created_at: NOW,
    });

    expect(() => db.update('workflow_instances', 'owned', { started_by: 'owner-b' }))
      .toThrow(/ownership is immutable/);
    expect(() => repository.insertInstance({
      ...repository.getInstance('owned')!,
      started_by: 'owner-b',
    })).toThrow(/ownership is immutable/);
    expect(() => db.update('workflow_steps', 'owned-step', { instance_id: 'other' }))
      .toThrow(/step parent is immutable/);
    expect(() => repository.insertStep({
      ...repository.getStep('owned-step')!,
      instance_id: 'other',
    })).toThrow(/step parent is immutable/);
    expect(() => db.update('workflow_events', 'owned-event', { instance_id: 'other' }))
      .toThrow(/event parent is immutable/);
    expect(() => repository.insertEvent({
      ...repository.getEvents('owned')[0]!,
      instance_id: 'other',
    })).toThrow(/event parent is immutable/);

    expect(repository.getInstance('owned')?.started_by).toBe('owner-a');
    expect(repository.getStep('owned-step')?.instance_id).toBe('owned');
    expect(repository.getEvents('owned')[0]?.instance_id).toBe('owned');
  });
});

function queryPlan(sql: string, ...params: Array<string | number>): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
    .map((row) => row.detail)
    .join('\n');
}

function seedInstance(instanceId: string, status: string, startedBy: string | null = null): void {
  repository.insertInstance({
    instance_id: instanceId,
    definition_id: `definition-${instanceId}`,
    name: 'repository-test',
    status,
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: startedBy,
    steps_json: '[]',
    created_at: NOW,
    updated_at: NOW,
    completed_at: null,
  });
}

function seedStep(
  stepId: string,
  instanceId: string,
  stepIndex: number,
  status: string,
  overrides: Record<string, unknown> = {},
): void {
  repository.insertStep({
    step_id: stepId,
    instance_id: instanceId,
    step_index: stepIndex,
    step_name: `Step ${stepIndex}`,
    status,
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: null,
    timeout_at: null,
    started_at: null,
    completed_at: status === 'completed' ? NOW : null,
    created_at: NOW,
    ...overrides,
  });
}
