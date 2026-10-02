/** Immutable workflow-version publication and draft persistence contracts. */

import { describe, expect, test } from 'bun:test';
import { t } from 'elysia';
import { createReactiveDB } from '../sync/reactive-db';
import {
  canonicalWorkflowJson,
  canonicalizeWorkflowDefinition,
  MAX_WORKFLOW_DEFINITION_BYTES,
} from './workflow-definition-canonical';
import { compileWorkflowDefinition } from './workflow-compiler';
import type { WorkflowGraphIR } from './workflow-ir';
import { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import { defineWorkflowTables } from './workflow-schema';
import { validateWorkflowSchemaValue } from './workflow-schema-snapshot';

const GRAPH_ONE: WorkflowGraphIR = {
  schemaVersion: 1,
  entry: 'start',
  nodes: [{ id: 'start', kind: 'activity', activity: { name: 'one' } }],
  edges: [],
};

describe('workflow definition canonical content', () => {
  test('sorts nested keys and fingerprints the full immutable envelope', () => {
    expect(canonicalWorkflowJson({ z: 1, a: { y: 2, x: 3 } }))
      .toBe('{"a":{"x":3,"y":2},"z":1}');
    const left = canonicalizeWorkflowDefinition({
      graph: { b: 2, a: 1 }, graphFormat: 'graph', schemaVersion: 1,
      inputSchema: { type: 'object' }, accessPolicy: { start: 'admin' },
    });
    const right = canonicalizeWorkflowDefinition({
      graph: { a: 1, b: 2 }, graphFormat: 'graph', schemaVersion: 1,
      accessPolicy: { start: 'admin' }, inputSchema: { type: 'object' },
    });
    expect(left.fingerprint).toBe(right.fingerprint);
    expect(() => canonicalWorkflowJson({ invalid: undefined })).toThrow(/undefined/);
    expect(() => canonicalWorkflowJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalWorkflowJson(circular)).toThrow(/circular/);
    expect(() => canonicalWorkflowJson(new Array(2))).toThrow(/sparse/);
  });
});

describe('WorkflowDefinitionVersionStore', () => {
  test('accepts the compiler fingerprint without persistence drift', () => {
    const fixture = createStore();
    try {
      const compiled = compileWorkflowDefinition({
        name: 'compiled-intake',
        graph: GRAPH_ONE,
        inputSchema: t.Object({ patientId: t.String() }),
      });
      const published = fixture.store.publish({
        name: compiled.name,
        source: compiled.authoringSource,
        graphFormat: compiled.format,
        schemaVersion: compiled.graph.schemaVersion,
        graph: compiled.graph,
        inputSchema: compiled.inputSchema,
        accessPolicy: compiled.access,
        expectedFingerprint: compiled.fingerprint,
      });
      expect(published.version.fingerprint).toBe(compiled.fingerprint);
      expect(published.inputSchema).toEqual(compiled.inputSchema);
      expect(validateWorkflowSchemaValue(published.inputSchema, { patientId: 'patient-1' }))
        .toBe(true);
      expect(validateWorkflowSchemaValue(published.inputSchema, { patientId: 1 })).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  test('publishes automatic immutable versions and deduplicates identical content', () => {
    const fixture = createStore();
    try {
      const first = fixture.store.publish(publishInput(GRAPH_ONE));
      expect(first.created).toBe(true);
      expect(first.activated).toBe(true);
      expect(first.version.version_number).toBe(1);
      expect(first.catalog.active_version_id).toBe(first.version.version_id);

      const repeated = fixture.store.publish(publishInput({
        edges: [], nodes: GRAPH_ONE.nodes, entry: 'start', schemaVersion: 1,
      }));
      expect(repeated.created).toBe(false);
      expect(repeated.version.version_id).toBe(first.version.version_id);
      expect(fixture.store.listVersions(first.catalog.definition_id)).toHaveLength(1);

      const second = fixture.store.publish(publishInput({
        ...GRAPH_ONE,
        nodes: [{ id: 'start', kind: 'activity', activity: { name: 'two' } }],
      }));
      expect(second.version.version_number).toBe(2);
      expect(second.catalog.version).toBe(2);
      expect(second.catalog.steps_json).toContain('"two"');
      expect(fixture.store.listVersions(first.catalog.definition_id)).toHaveLength(2);
    } finally {
      fixture.dispose();
    }
  });

  test('makes explicit versions idempotent but rejects changed or stale content', () => {
    const fixture = createStore();
    try {
      const first = fixture.store.publish({ ...publishInput(GRAPH_ONE), version: 10 });
      expect(first.version.version_number).toBe(10);
      expect(fixture.store.publish({ ...publishInput(GRAPH_ONE), version: 10 }).created)
        .toBe(false);
      expect(captureError(() => fixture.store.publish({
        ...publishInput(GRAPH_ONE),
        version: 11,
      }))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_VERSION_CONFLICT',
        status: 409,
      });
      expect(() => fixture.store.publish({
        ...publishInput({ ...GRAPH_ONE, entry: 'other' }),
        version: 10,
      })).toThrow(/different content/);
      expect(() => fixture.store.publish({
        ...publishInput({ ...GRAPH_ONE, entry: 'other' }),
        version: 9,
      })).toThrow(/monotonically/);
    } finally {
      fixture.dispose();
    }
  });

  test('enforces source ownership, active-version fences, retirement, and resolution', () => {
    const fixture = createStore();
    try {
      const first = fixture.store.publish(publishInput(GRAPH_ONE));
      expect(captureError(() => fixture.store.publish({
        ...publishInput(GRAPH_ONE), source: 'database',
      }))).toMatchObject({ code: 'WORKFLOW_DEFINITION_SOURCE_CONFLICT', status: 409 });
      expect(captureError(() => fixture.store.publish({
        ...publishInput({ ...GRAPH_ONE, entry: 'changed' }),
        expectedActiveVersionId: 'stale',
      }))).toMatchObject({ code: 'WORKFLOW_DEFINITION_VERSION_CONFLICT' });

      const retired = fixture.store.retire(
        first.catalog.definition_id,
        first.version.version_id,
        'admin',
      );
      expect(retired.version.status).toBe('retired');
      expect(retired.catalog.active_version_id).toBeNull();
      expect(captureError(() => fixture.store.resolve({ name: 'patient-intake' })))
        .toMatchObject({ code: 'WORKFLOW_DEFINITION_VERSION_NOT_FOUND' });
      expect(fixture.store.resolve({
        versionId: first.version.version_id,
        includeRetired: true,
      }).version.status).toBe('retired');
      expect(() => fixture.store.activate(
        first.catalog.definition_id,
        first.version.version_id,
      )).toThrow(/retired/);
    } finally {
      fixture.dispose();
    }
  });

  test('keeps drafts mutable and revision-fenced outside published history', () => {
    const fixture = createStore();
    try {
      const published = fixture.store.publish(publishInput(GRAPH_ONE));
      const first = fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        baseVersionId: published.version.version_id,
        source: 'code', graphFormat: 'graph', schemaVersion: 1,
        graph: GRAPH_ONE, editorMetadata: { position: { y: 2, x: 1 } },
      });
      expect(first.draft.revision).toBe(1);
      expect(first.editorMetadata).toEqual({ position: { x: 1, y: 2 } });

      const updated = fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        draftId: first.draft.draft_id,
        baseVersionId: published.version.version_id,
        source: 'code', graphFormat: 'graph', schemaVersion: 1,
        graph: { ...GRAPH_ONE, entry: 'updated' }, expectedRevision: 1,
      });
      expect(updated.draft.revision).toBe(2);
      expect(captureError(() => fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        draftId: first.draft.draft_id,
        source: 'code', graphFormat: 'graph', schemaVersion: 1,
        graph: GRAPH_ONE,
      } as never))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_DRAFT_INVALID',
        status: 422,
      });
      expect(captureError(() => fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        draftId: first.draft.draft_id,
        source: 'code', graphFormat: 'graph', schemaVersion: 1,
        graph: GRAPH_ONE, expectedRevision: 1,
      }))).toMatchObject({ code: 'WORKFLOW_DEFINITION_DRAFT_CONFLICT' });
      expect(captureError(() => fixture.store.drafts.delete(
        first.draft.draft_id,
        1,
      ))).toMatchObject({ code: 'WORKFLOW_DEFINITION_DRAFT_CONFLICT' });
      expect(captureError(() => fixture.store.drafts.delete(
        first.draft.draft_id,
        0,
      ))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_DRAFT_INVALID',
        status: 422,
      });
      expect(captureError(() => fixture.store.publishDraft({
        draftId: first.draft.draft_id,
        definitionId: published.catalog.definition_id,
        expectedDraftFingerprint: updated.draft.fingerprint,
        publication: {
          ...publishInput({ ...GRAPH_ONE, entry: 'updated' }),
          expectedFingerprint: updated.draft.fingerprint,
        },
      } as never))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_DRAFT_INVALID',
        status: 422,
      });
      expect(fixture.store.drafts.delete(first.draft.draft_id, 2)).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  test('publishes only the exact reviewed draft revision in one writer transaction', () => {
    const fixture = createStore();
    try {
      const published = fixture.store.publish(publishInput(GRAPH_ONE));
      const draft = fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        source: 'code', graphFormat: 'graph', schemaVersion: 1,
        graph: { ...GRAPH_ONE, entry: 'reviewed' },
      });
      const reviewed = fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        draftId: draft.draft.draft_id,
        source: 'code', graphFormat: 'graph', schemaVersion: 1,
        graph: { ...GRAPH_ONE, entry: 'reviewed' },
        expectedRevision: 1,
      });
      fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        draftId: draft.draft.draft_id,
        source: 'code', graphFormat: 'graph', schemaVersion: 1,
        graph: { ...GRAPH_ONE, entry: 'changed-after-review' },
        expectedRevision: 2,
      });

      expect(captureError(() => fixture.store.publishDraft({
        draftId: reviewed.draft.draft_id,
        definitionId: published.catalog.definition_id,
        expectedRevision: reviewed.draft.revision,
        expectedDraftFingerprint: reviewed.draft.fingerprint,
        publication: {
          ...publishInput(reviewed.graph),
          expectedFingerprint: reviewed.draft.fingerprint,
        },
      }))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_DRAFT_CONFLICT',
        status: 409,
      });
      expect(fixture.store.listVersions(published.catalog.definition_id)).toHaveLength(1);
    } finally {
      fixture.dispose();
    }
  });

  test('fails closed when stored immutable content no longer matches its fingerprint', () => {
    const fixture = createStore();
    try {
      const published = fixture.store.publish(publishInput(GRAPH_ONE));
      fixture.db.exec('DROP TRIGGER trg_workflow_version_content_immutable');
      fixture.db.prepare(`UPDATE workflow_definition_versions
        SET graph_json = '{"tampered":true}' WHERE version_id = ?`)
        .run(published.version.version_id);
      expect(captureError(() => fixture.store.resolve({ versionId: published.version.version_id })))
        .toMatchObject({ code: 'WORKFLOW_DEFINITION_HISTORY_INVALID', status: 500 });
    } finally {
      fixture.dispose();
    }
  });

  test('rejects oversized publish and draft envelopes with a stable 422 code', () => {
    const fixture = createStore();
    try {
      const oversized = { payload: 'x'.repeat(MAX_WORKFLOW_DEFINITION_BYTES) };
      expect(captureError(() => fixture.store.publish({
        ...publishInput(oversized),
        name: 'oversized',
      }))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_GRAPH_INVALID',
        status: 422,
      });

      const published = fixture.store.publish(publishInput(GRAPH_ONE));
      expect(captureError(() => fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        source: 'code',
        graphFormat: 'graph',
        schemaVersion: 1,
        graph: GRAPH_ONE,
        editorMetadata: oversized,
      }))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_GRAPH_INVALID',
        status: 422,
      });

      expect(captureError(() => fixture.store.drafts.save({
        definitionId: published.catalog.definition_id,
        source: 'code',
        graphFormat: 'graph',
        schemaVersion: 1,
        graph: oversized,
      }))).toMatchObject({
        code: 'WORKFLOW_DEFINITION_GRAPH_INVALID',
        status: 422,
      });
    } finally {
      fixture.dispose();
    }
  });
});

function publishInput(graph: unknown) {
  return {
    name: 'patient-intake',
    graph,
    source: 'code' as const,
    graphFormat: 'graph',
    schemaVersion: 1,
    inputSchema: { type: 'object', properties: { patientId: { type: 'string' } } },
    accessPolicy: { start: ['clinician'] },
  };
}

function createStore() {
  const db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
  let tick = 0;
  const store = new WorkflowDefinitionVersionStore(
    db,
    () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  );
  return { db, store, dispose: () => db.dispose() };
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
    throw new Error('Expected operation to throw');
  } catch (error) {
    return error;
  }
}
