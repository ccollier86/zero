import { describe, expect, test } from 'bun:test';

import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB } from '../sync/reactive-db';
import { flow, step } from './workflow-dsl';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

const system = Object.freeze({
  principal: 'workflow-private-start-test',
  reason: 'Verify atomic private workflow memory seeding',
  scope: applicationServiceDataScope(),
});

describe('workflow private start memory', () => {
  test('seeds graph memory atomically without projecting values into public rows', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'private-start.inspect',
      handler: async ({ memory }) => ({
        seeded: memory?.get('private-secret') === 'not-for-sync',
      }),
    });
    registry.create({
      name: 'private-start-memory',
      flow: flow(step('inspect', 'private-start.inspect')),
    });
    const service = new WorkflowService(db, registry);

    try {
      const runId = await service.startAsSystem(
        'private-start-memory',
        { public: true },
        system,
        {
          initialMemory: { 'private-secret': 'not-for-sync' },
          memoryLimits: {
            maxEntries: 512,
            maxTotalBytes: 2 * 1024 * 1024,
          },
        },
      );

      expect(service.get(runId)).toMatchObject({ status: 'completed' });
      expect(JSON.stringify({
        instance: db.prepare(`SELECT input, output, error FROM workflow_instances
          WHERE instance_id = ?`).get(runId),
        steps: db.prepare(`SELECT input, output, error FROM workflow_steps
          WHERE instance_id = ?`).all(runId),
      })).not.toContain('not-for-sync');
      expect(db.prepare(`SELECT value_json FROM _workflow_memory
        WHERE instance_id = ? AND key = ?`).get(runId, 'private-secret')).toEqual({
        value_json: '"not-for-sync"',
      });
      expect(db.prepare(`SELECT max_entries, max_total_bytes
        FROM _workflow_memory_policies WHERE instance_id = ?`).get(runId)).toEqual({
        max_entries: 512,
        max_total_bytes: 2 * 1024 * 1024,
      });

      const before = rowCounts(db);
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      await expect(service.startAsSystem(
        'private-start-memory',
        { public: true },
        system,
        {
          initialMemory: { invalid: cycle },
          memoryLimits: {
            maxEntries: 512,
            maxTotalBytes: 2 * 1024 * 1024,
          },
        },
      )).rejects.toMatchObject({
        code: 'WORKFLOW_MEMORY_VALUE_INVALID',
        status: 400,
      });
      expect(rowCounts(db)).toEqual(before);
    } finally {
      await service.dispose();
      db.dispose();
    }
  });
});

function rowCounts(db: ReturnType<typeof createReactiveDB>) {
  return {
    instances: count(db, 'workflow_instances'),
    steps: count(db, 'workflow_steps'),
    authorities: count(db, '_workflow_execution_authorities'),
    memory: count(db, '_workflow_memory'),
    memoryPolicies: count(db, '_workflow_memory_policies'),
  };
}

function count(db: ReturnType<typeof createReactiveDB>, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count);
}
