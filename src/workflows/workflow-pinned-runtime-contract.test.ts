/** Regression coverage for public pinned-runtime topology and each-body errors. */

import { describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { flow, step } from './workflow-dsl';
import { requireEachBodyActivity } from './workflow-each-records';
import type { WorkflowEachNode } from './workflow-ir';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';

describe('workflow pinned-runtime contracts', () => {
  for (const scenario of [
    {
      name: 'missing graph pin',
      corrupt(db: ReactiveDB, instanceId: string) {
        db.exec('DROP TRIGGER trg_workflow_instance_graph_immutable');
        db.prepare(`UPDATE workflow_instances
          SET definition_version_id = NULL WHERE instance_id = ?`).run(instanceId);
      },
    },
    {
      name: 'missing immutable version',
      corrupt(db: ReactiveDB, instanceId: string) {
        db.exec('DROP TRIGGER trg_workflow_version_delete_forbidden');
        db.prepare(`DELETE FROM workflow_definition_versions
          WHERE version_id = (
            SELECT definition_version_id FROM workflow_instances WHERE instance_id = ?
          )`).run(instanceId);
      },
    },
    {
      name: 'mismatched immutable snapshot',
      corrupt(db: ReactiveDB, instanceId: string) {
        db.exec('DROP TRIGGER trg_workflow_instance_graph_immutable');
        db.prepare(`UPDATE workflow_instances
          SET graph_fingerprint = 'tampered-fingerprint' WHERE instance_id = ?`)
          .run(instanceId);
      },
    },
  ]) {
    test(`normalizes ${scenario.name} as invalid runtime state`, async () => {
      const db = createReactiveDB({ mode: 'memory' });
      defineWorkflowTables(db);
      const registry = new WorkflowRegistry();
      registry.registerActivity({
        name: 'pinned-runtime.noop',
        databaseCallable: true,
        handler: async () => 'done',
      });
      registry.create({
        name: `pinned-runtime-${scenario.name.replaceAll(' ', '-')}`,
        flow: flow(step('done', 'pinned-runtime.noop')),
      });
      const service = new WorkflowService(db, registry);

      try {
        const instanceId = await service.start(
          `pinned-runtime-${scenario.name.replaceAll(' ', '-')}`,
        );
        scenario.corrupt(db, instanceId);

        expect(() => service.getPublicTopology(instanceId)).toThrow(expect.objectContaining({
          code: 'WORKFLOW_STATE_INVALID',
          status: 500,
        }));
      } finally {
        await service.dispose();
        db.dispose();
      }
    });
  }

  test('normalizes a pinned definition scope mismatch as invalid runtime state', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'pinned-runtime.scope-noop',
      databaseCallable: true,
      handler: async () => 'done',
    });
    const service = new WorkflowService(db, registry);

    try {
      const graph = {
        schemaVersion: 1,
        entry: 'done',
        nodes: [{
          id: 'done',
          kind: 'activity',
          activity: { name: 'pinned-runtime.scope-noop' },
        }],
        edges: [],
      };
      const published = getWorkflowGraphRuntime(service).versions.publish({
        name: 'tenant-scoped-definition',
        source: 'database',
        scope: { type: 'tenant', id: 'tenant-a' },
        graphFormat: 'graph',
        schemaVersion: 1,
        graph,
      });
      const instanceId = 'scope-mismatched-run';
      const now = '2030-01-01T00:00:00.000Z';
      db.prepare(`INSERT INTO workflow_instances (
        instance_id, tenant_id, definition_id, name, status, current_step,
        input, output, error, started_by, steps_json, created_at, updated_at, completed_at,
        definition_version_id, definition_version, graph_json, graph_fingerprint
      ) VALUES (?, NULL, ?, ?, 'completed', 0,
        NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        instanceId,
        published.catalog.definition_id,
        published.catalog.name,
        now,
        now,
        now,
        published.version.version_id,
        published.version.version_number,
        published.version.graph_json,
        published.version.fingerprint,
      );

      expect(() => service.getPublicTopology(instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
        status: 500,
      }));
    } finally {
      await service.dispose();
      db.dispose();
    }
  });

  test('classifies an impossible persisted each body as invalid runtime state', () => {
    const invalid = {
      id: 'items',
      kind: 'each',
      source: { $expr: 'literal', value: [] },
      concurrency: 1,
      onInvalid: 'fail',
      onError: 'fail',
      body: { schemaVersion: 1, entry: 'missing', nodes: [], edges: [] },
    } as unknown as WorkflowEachNode;

    expect(() => requireEachBodyActivity(invalid)).toThrow(expect.objectContaining({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    }));
  });
});
