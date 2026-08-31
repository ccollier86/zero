/**
 * workflow-service.test.ts
 *
 * Verifies workflow registry and service aliases against an in-memory
 * ReactiveDB. This file owns service-contract tests only; Elysia route
 * behavior remains in the workflow plugin.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { WorkflowRegistry } from './workflow-registry';
import { WorkflowService } from './workflow-service';

let db: ReactiveDB;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
});

afterEach(() => {
  db.dispose();
});

describe('Workflow aliases', () => {
  test('registry create/get/list and service run/get/list/stop preserve lifecycle behavior', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('noop', async () => ({ ok: true }));
    registry.create({
      name: 'alias-flow',
      steps: [{ name: 'Noop', handler: 'noop' }],
    });

    expect(registry.get('alias-flow')?.steps).toHaveLength(1);
    expect(registry.list().map((workflow) => workflow.name)).toEqual(['alias-flow']);

    const service = new WorkflowService(db, registry);
    const instanceId = await service.run('alias-flow', { requested: true }, 'user-1');

    expect(service.get(instanceId)?.status).toBe('completed');
    expect(service.list({ name: 'alias-flow' })).toHaveLength(1);

    service.stop(instanceId);
    expect(service.get(instanceId)?.status).toBe('cancelled');
  });

  test('keeps scheduled retries running and completes after a successful retry', async () => {
    const registry = new WorkflowRegistry();
    let attempts = 0;
    registry.registerHandler('retry-once', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary failure');
      return { ok: true };
    });
    registry.create({
      name: 'retry-flow',
      steps: [{ name: 'Retry once', handler: 'retry-once', retries: 2 }],
    });
    const service = new WorkflowService(db, registry);

    const instanceId = await service.run('retry-flow');
    expect(service.get(instanceId)?.status).toBe('running');
    const step = service.getSteps(instanceId)[0]!;
    expect(step.status).toBe('failed');
    expect(step.retry_at).toBeString();
    db.update('workflow_steps', step.step_id, {
      retry_at: new Date(0).toISOString(),
    });

    expect(await service.pollRetries()).toBe(1);
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(service.getSteps(instanceId)[0]?.status).toBe('completed');
  });

  test('marks a workflow failed as soon as its attempts are exhausted', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('always-fail', async () => {
      throw new Error('permanent failure');
    });
    registry.create({
      name: 'failed-flow',
      steps: [{ name: 'Fail', handler: 'always-fail', retries: 1 }],
    });
    const service = new WorkflowService(db, registry);

    const instanceId = await service.run('failed-flow');

    expect(service.get(instanceId)).toMatchObject({
      status: 'failed',
      error: 'permanent failure',
    });
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: null,
    });
  });

  test('never completes a recovered workflow with a terminal failed step', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('always-fail', async () => {
      throw new Error('terminal failure');
    });
    registry.create({
      name: 'recovered-failure-flow',
      steps: [{ name: 'Fail', handler: 'always-fail', retries: 1 }],
    });
    const service = new WorkflowService(db, registry);
    const instanceId = await service.run('recovered-failure-flow');
    db.update('workflow_instances', instanceId, { status: 'running' });

    await service.recoverInFlight();

    expect(service.get(instanceId)?.status).toBe('failed');
  });
});

function defineWorkflowTables(db: ReactiveDB): void {
  db.defineTable('workflow_definitions', {
    definition_id: 'text primary key',
    name: 'text unique not null',
    version: 'integer not null default 1',
    steps_json: 'text not null',
    input_schema: 'text',
    created_at: 'text not null',
    updated_at: 'text not null',
  });

  db.defineTable('workflow_instances', {
    instance_id: 'text primary key',
    definition_id: 'text not null',
    name: 'text not null',
    status: "text not null default 'pending'",
    current_step: 'integer not null default 0',
    input: 'text',
    output: 'text',
    error: 'text',
    started_by: 'text',
    steps_json: 'text',
    created_at: 'text not null',
    updated_at: 'text not null',
    completed_at: 'text',
  });

  db.defineTable('workflow_steps', {
    step_id: 'text primary key',
    instance_id: 'text not null',
    step_index: 'integer not null',
    step_name: 'text not null',
    status: "text not null default 'pending'",
    input: 'text',
    output: 'text',
    error: 'text',
    retries: 'integer not null default 0',
    max_retries: 'integer not null default 3',
    retry_at: 'text',
    wait_event: 'text',
    timeout_at: 'text',
    started_at: 'text',
    completed_at: 'text',
    created_at: 'text not null',
  });

  db.defineTable('workflow_events', {
    event_id: 'text primary key',
    instance_id: 'text not null',
    event_name: 'text not null',
    payload: 'text',
    sent_by: 'text',
    created_at: 'text not null',
  });
}
