import { describe, expect, test } from 'bun:test';

import { createReactiveDB } from '../sync/reactive-db';
import { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import { WorkflowGraphDefinitionResolver } from './workflow-graph-definition-resolver';
import type { WorkflowGraphIR } from './workflow-ir';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';

const INVALID_GRAPH: WorkflowGraphIR = {
  schemaVersion: 1,
  entry: 'missing',
  nodes: [{ id: 'only', kind: 'activity', activity: { name: 'noop' } }],
  edges: [],
};

describe('workflow graph error contracts', () => {
  test('reports a coherent but semantically invalid stored graph as server state', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineWorkflowTables(db);
      const registry = new WorkflowRegistry();
      registry.registerActivity({
        name: 'noop',
        databaseCallable: true,
        handler: async () => null,
      });
      const versions = new WorkflowDefinitionVersionStore(db);
      const resolver = new WorkflowGraphDefinitionResolver(versions, registry);
      versions.publish({
        name: 'invalid-stored-graph',
        graph: INVALID_GRAPH,
        source: 'database',
        graphFormat: 'graph',
        schemaVersion: 1,
      });

      expect(() => resolver.resolvePersisted(
        'invalid-stored-graph',
        null,
        {},
      )).toThrow(expect.objectContaining({
        code: 'WORKFLOW_DEFINITION_GRAPH_INVALID',
        status: 500,
        message: 'Stored workflow definition graph failed validation',
      }));
    } finally {
      db.dispose();
    }
  });
});
