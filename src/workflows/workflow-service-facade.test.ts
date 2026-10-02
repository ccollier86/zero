/** Stable facade and extracted command-boundary regression coverage. */

import { describe, expect, test } from 'bun:test';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import { createReactiveDB } from '../sync/reactive-db';
import { flow, step, waitFor } from './workflow-dsl';
import * as workflowApi from './index';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

describe('WorkflowService public facade', () => {
  test('keeps the raw graph coordinator off the public service and package barrel', () => {
    expect('getGraphRuntime' in WorkflowService.prototype).toBe(false);
    expect(Object.hasOwn(workflowApi, 'getWorkflowGraphRuntime')).toBe(false);
  });

  test('preserves constructor forms, aliases, queries, and public topology', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'facade.noop', handler: async () => 'done' });
    registry.create({ name: 'facade-complete', flow: flow(step('done', 'facade.noop')) });
    registry.create({ name: 'facade-wait', flow: flow(waitFor('wait', 'continue')) });
    const service = new WorkflowService(db, registry, 'single', {});
    const system = {
      principal: 'workflow-facade-test',
      reason: 'Verify the stable WorkflowService privileged aliases',
      scope: applicationServiceDataScope(),
    };

    try {
      const started = await service.start('facade-complete');
      const run = await service.run('facade-complete');
      const startedAsSystem = await service.startAsSystem('facade-complete', {}, system);
      const runAsSystem = await service.runAsSystem('facade-complete', {}, system);
      for (const instanceId of [started, run, startedAsSystem, runAsSystem]) {
        expect(service.get(instanceId)).toEqual(service.getInstance(instanceId));
        expect(service.get(instanceId)?.status).toBe('completed');
        expect(service.getSteps(instanceId)).not.toHaveLength(0);
        expect(service.getPublicTopology(instanceId)).not.toBeNull();
      }
      expect(service.list()).toEqual(service.listInstances());
      const stopped = await service.start('facade-wait');
      service.stop(stopped);
      expect(service.get(stopped)?.status).toBe('cancelled');
    } finally {
      await service.dispose();
      db.dispose();
    }
  });

  test('rolls back both event rows when the final authority fence rejects', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.create({ name: 'event-fence', flow: flow(waitFor('wait', 'continue')) });
    const service = new WorkflowService(db, registry);

    try {
      const instanceId = await service.start('event-fence');
      let assertions = 0;
      await expect(service.sendEvent(
        instanceId,
        'continue',
        { accepted: false },
        'actor-1',
        { actorId: 'actor-1' },
        undefined,
        {
          assertCurrentAuthority: () => {
            assertions += 1;
            throw new AuthError('Actor authority changed', 'AUTH_STATE_CHANGED', 409);
          },
        },
      )).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED', status: 409 });

      expect(assertions).toBe(1);
      expect(countRows(db, 'workflow_events', instanceId)).toBe(0);
      expect(countRows(db, '_workflow_event_delivery', instanceId)).toBe(0);
      expect(service.get(instanceId)?.status).toBe('running');
      expect(service.getSteps(instanceId)[0]?.status).toBe('waiting');
    } finally {
      await service.dispose();
      db.dispose();
    }
  });
});

function countRows(
  db: ReturnType<typeof createReactiveDB>,
  table: string,
  instanceId: string,
): number {
  return Number((db.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE instance_id = ?`,
  ).get(instanceId) as { count: number }).count);
}
