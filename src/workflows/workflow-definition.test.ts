import { describe, expect, test } from 'bun:test';
import { Type } from '@sinclair/typebox';

import { createReactiveDB } from '../sync/reactive-db';
import { WorkflowRegistry } from './workflow-registry';
import type { WorkflowDefinitionInput } from './workflow-compiler';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

describe('workflow definition contracts', () => {
  test('rejects duplicate and malformed definitions before runtime', () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('noop', async () => null);

    expect(() => registry.create({
      name: 'invalid-condition',
      steps: [{ name: 'Invalid', handler: 'noop', condition: 'input.(' }],
    })).toThrow(/condition is not valid/);
    expect(() => registry.create({
      name: 'invalid-timeout-range',
      steps: [{ name: 'Invalid', handler: 'noop', timeoutMs: Number.MAX_VALUE }],
    })).toThrow(/timeoutMs/);
    expect(() => registry.create({
      name: 'legacy-publication-options',
      version: 2,
      steps: [{ name: 'Invalid', handler: 'noop' }],
    } as unknown as WorkflowDefinitionInput)).toThrow(/use flow or graph/);

    registry.create({
      name: 'registered-once',
      steps: [{ name: 'Valid', handler: 'noop' }],
    });
    expect(() => registry.create({
      name: 'registered-once',
      steps: [{ name: 'Replacement', handler: 'noop' }],
    })).toThrow(/already registered/);
  });

  test('fails closed when a valid condition expression throws for runtime input', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    let handlerCalls = 0;
    registry.registerHandler('guarded', async () => {
      handlerCalls += 1;
      return null;
    });
    registry.create({
      name: 'runtime-condition-error',
      steps: [{
        name: 'Guarded',
        handler: 'guarded',
        condition: 'input.missing.value === true',
      }],
    });
    const service = new WorkflowService(db, registry);

    try {
      const instanceId = await service.start('runtime-condition-error', {});
      expect(handlerCalls).toBe(0);
      expect(service.get(instanceId)).toMatchObject({
        status: 'failed',
        current_step: 0,
      });
      expect(service.getSteps(instanceId)[0]).toMatchObject({
        status: 'failed',
        retry_at: null,
      });
      expect(service.getSteps(instanceId)[0]?.error).toContain('Workflow condition failed');
    } finally {
      await service.dispose();
      db.dispose();
    }
  });

  test('versions the persisted definition when deployed configuration changes', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const firstRegistry = new WorkflowRegistry();
    firstRegistry.registerHandler('noop', async () => null);
    firstRegistry.create({
      name: 'versioned-definition',
      steps: [{ name: 'First revision', handler: 'noop' }],
    });
    const firstService = new WorkflowService(db, firstRegistry);

    try {
      await firstService.start('versioned-definition');
      await firstService.dispose();

      const secondRegistry = new WorkflowRegistry();
      secondRegistry.registerHandler('noop', async () => null);
      secondRegistry.create({
        name: 'versioned-definition',
        steps: [{ name: 'Second revision', handler: 'noop' }],
      });
      const secondService = new WorkflowService(db, secondRegistry);
      try {
        await secondService.start('versioned-definition');
        const stored = db.query('workflow_definitions')[0];
        expect(stored?.version).toBe(2);
        expect(stored?.steps_json).toContain('Second revision');
      } finally {
        await secondService.dispose();
      }
    } finally {
      await firstService.dispose();
      db.dispose();
    }
  });

  test('fails a step whose handler returns a non-serializable value', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('invalid-output', async () => {
      calls += 1;
      return () => undefined;
    });
    registry.create({
      name: 'invalid-handler-output',
      steps: [{ name: 'Invalid output', handler: 'invalid-output' }],
    });
    const service = new WorkflowService(db, registry);

    try {
      const instanceId = await service.start('invalid-handler-output');
      expect(calls).toBe(1);
      expect(service.get(instanceId)?.status).toBe('failed');
      expect(service.getSteps(instanceId)[0]?.error).toBe(
        'Workflow handler output is not JSON-serializable',
      );
    } finally {
      await service.dispose();
      db.dispose();
    }
  });

  test('maps an unserializable input schema to a stable definition error before persistence', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerHandler('noop', async () => null);
    const schema = Type.Any();
    (schema as unknown as Record<string, unknown>).circular = schema;
    registry.create({
      name: 'circular-schema',
      steps: [{ name: 'Noop', handler: 'noop' }],
      inputSchema: schema,
    });
    const service = new WorkflowService(db, registry);

    try {
      await expect(service.start('circular-schema', null)).rejects.toMatchObject({
        code: 'WORKFLOW_DEFINITION_INVALID',
        status: 500,
      });
      expect(db.query('workflow_definitions')).toHaveLength(0);
      expect(db.query('workflow_instances')).toHaveLength(0);
      expect(db.query('workflow_steps')).toHaveLength(0);
    } finally {
      await service.dispose();
      db.dispose();
    }
  });

  test('executes a zero-backoff retry without waiting for the scheduler', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('retry-now', async () => {
      calls += 1;
      if (calls === 1) throw new Error('try again');
      return 'complete';
    });
    registry.create({
      name: 'zero-backoff',
      steps: [{
        name: 'Retry immediately',
        handler: 'retry-now',
        retries: 2,
        backoffMs: 0,
      }],
    });
    const service = new WorkflowService(db, registry);

    try {
      const instanceId = await service.start('zero-backoff');
      expect(calls).toBe(2);
      expect(service.get(instanceId)?.status).toBe('completed');
    } finally {
      await service.dispose();
      db.dispose();
    }
  });
});
