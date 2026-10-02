import { describe, expect, test } from 'bun:test';

import { createReactiveDB } from '../sync/reactive-db';
import { WorkflowDefinitionManager } from './workflow-definition-manager';
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

const VALID_GRAPH: WorkflowGraphIR = {
  schemaVersion: 1,
  entry: 'only',
  nodes: [{ id: 'only', kind: 'activity', activity: { name: 'noop' } }],
  edges: [],
};

const UPDATED_GRAPH: WorkflowGraphIR = {
  schemaVersion: 1,
  entry: 'updated',
  nodes: [{ id: 'updated', kind: 'activity', activity: { name: 'noop' } }],
  edges: [],
};

describe('workflow graph error contracts', () => {
  test('reports authored graph defects as a 422 authoring error', () => {
    const fixture = createFixture();
    try {
      expect(() => fixture.manager.publish({
        name: 'invalid-authored-graph',
        graph: INVALID_GRAPH,
      }, 'admin')).toThrow(expect.objectContaining({
        code: 'WORKFLOW_GRAPH_INVALID',
        status: 422,
      }));
      expect((fixture.db.prepare(
        'SELECT COUNT(*) AS count FROM workflow_definition_versions',
      ).get() as { count: number }).count).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  test('reports a coherent but semantically invalid stored graph as server state', () => {
    const fixture = createFixture();
    try {
      // The low-level version store canonicalizes bytes and fingerprints but
      // deliberately does not compile executable semantics. Execution must
      // therefore preserve a separate fail-closed stored-definition boundary.
      fixture.versions.publish({
        name: 'invalid-stored-graph',
        graph: INVALID_GRAPH,
        source: 'database',
        graphFormat: 'graph',
        schemaVersion: 1,
      });

      expect(() => fixture.resolver.resolvePersisted(
        'invalid-stored-graph',
        null,
        {},
        { type: 'application' },
      )).toThrow(expect.objectContaining({
        code: 'WORKFLOW_DEFINITION_GRAPH_INVALID',
        status: 500,
        message: 'Stored workflow definition graph failed validation',
      }));
    } finally {
      fixture.dispose();
    }
  });

  test('rejects an editor save forced between draft compilation and publication', () => {
    const fixture = createFixture();
    try {
      const published = fixture.manager.publish({
        name: 'revision-fenced-draft',
        graph: VALID_GRAPH,
      }, 'admin');
      const draft = fixture.manager.saveDraft({
        definitionId: published.catalog.definition_id,
        name: 'revision-fenced-draft',
        graph: VALID_GRAPH,
      }, 'first-editor');

      const publishDraft = fixture.versions.publishDraft;
      let interposed = false;
      fixture.versions.publishDraft = ((input, assertCurrentAuthority) => {
        interposed = true;
        fixture.manager.saveDraft({
          definitionId: input.definitionId,
          draftId: input.draftId,
          name: 'revision-fenced-draft',
          graph: UPDATED_GRAPH,
          expectedRevision: 1,
        }, 'second-editor');
        return publishDraft.call(fixture.versions, input, assertCurrentAuthority);
      }) as typeof fixture.versions.publishDraft;

      expect(() => fixture.manager.publishDraft(
        draft.draft.draft_id,
        'first-editor',
        { expectedRevision: 1, activate: false },
      )).toThrow(expect.objectContaining({
        code: 'WORKFLOW_DRAFT_CONFLICT',
        status: 409,
      }));
      expect(interposed).toBe(true);
      expect(fixture.versions.listVersions(published.catalog.definition_id)).toHaveLength(1);
      expect(fixture.versions.drafts.require(draft.draft.draft_id).draft.revision).toBe(2);

      fixture.versions.publishDraft = publishDraft;
      const current = fixture.manager.publishDraft(
        draft.draft.draft_id,
        'second-editor',
        { expectedRevision: 2, activate: false },
      );
      expect(current).toMatchObject({ created: true, activated: false });
      expect(current.graph).toMatchObject({ entry: 'updated' });
    } finally {
      fixture.dispose();
    }
  });

  test('rejects structurally missing draft fences at the manager boundary', () => {
    const fixture = createFixture();
    try {
      const published = fixture.manager.publish({
        name: 'manager-draft-fences',
        graph: VALID_GRAPH,
      }, 'admin');
      const draft = fixture.manager.saveDraft({
        definitionId: published.catalog.definition_id,
        name: 'manager-draft-fences',
        graph: VALID_GRAPH,
      }, 'editor');

      expect(() => fixture.manager.saveDraft({
        definitionId: published.catalog.definition_id,
        name: 'manager-draft-fences',
        graph: VALID_GRAPH,
        expectedRevision: 1,
      } as never, 'editor')).toThrow(expect.objectContaining({
        code: 'WORKFLOW_REQUEST_INVALID',
        status: 422,
      }));
      expect(() => fixture.manager.publishDraft(
        draft.draft.draft_id,
        'editor',
        {} as never,
      )).toThrow(expect.objectContaining({
        code: 'WORKFLOW_REQUEST_INVALID',
        status: 422,
      }));
      expect((fixture.db.prepare(
        'SELECT COUNT(*) AS count FROM _workflow_definition_drafts',
      ).get() as { count: number }).count).toBe(1);
    } finally {
      fixture.dispose();
    }
  });
});

function createFixture() {
  const db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
  const registry = new WorkflowRegistry();
  registry.registerActivity({
    name: 'noop',
    databaseCallable: true,
    handler: async () => null,
  });
  const versions = new WorkflowDefinitionVersionStore(db);
  return {
    db,
    versions,
    manager: new WorkflowDefinitionManager(registry, versions),
    resolver: new WorkflowGraphDefinitionResolver(versions, registry),
    dispose: () => db.dispose(),
  };
}
