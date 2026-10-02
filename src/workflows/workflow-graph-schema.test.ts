import { describe, expect, test } from 'bun:test';

import { createReactiveDB } from '../sync/reactive-db';
import { ensureWorkflowGraphSchema } from './workflow-graph-schema';

describe('workflow graph schema compatibility', () => {
  test('requires migration 031 instead of silently retaining the released global name key', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.exec(`CREATE TABLE workflow_definitions (
        definition_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 1,
        steps_json TEXT NOT NULL,
        input_schema TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      expect(() => ensureWorkflowGraphSchema(db)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_CONFIG_INVALID',
        status: 500,
        message: expect.stringContaining('apply migration 031'),
      }));
    } finally {
      db.dispose();
    }
  });

  test('enforces code-authored definition ownership at the database boundary', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      ensureWorkflowGraphSchema(db);
      expect(() => db.exec(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        source, scope_type, scope_id
      ) VALUES (
        'tenant-code', 'tenant-code', 0, '[]', '2030-01-01', '2030-01-01',
        'code', 'tenant', 'tenant-alpha'
      )`)).toThrow(/code workflow definitions require application scope/);
      expect(db.prepare(`SELECT definition_id FROM workflow_definitions
        WHERE definition_id = ?`).get('tenant-code')).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('rejects a direct catalog insert with a cross-definition active version', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      ensureWorkflowGraphSchema(db);
      db.exec(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        source, scope_type, scope_id
      ) VALUES (
        'definition-one', 'definition-one', 1, '[]', '2030-01-01', '2030-01-01',
        'database', 'application', ''
      )`);
      db.exec(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, created_at
      ) VALUES (
        'version-one', 'definition-one', 1, 'database', 'graph', 1, '{}',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2030-01-01'
      )`);
      expect(() => db.exec(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        active_version_id, source, scope_type, scope_id
      ) VALUES (
        'definition-two', 'definition-two', 1, '[]', '2030-01-01', '2030-01-01',
        'version-one', 'database', 'application', ''
      )`)).toThrow(/workflow active version is invalid/);
      expect(db.prepare(`SELECT definition_id FROM workflow_definitions
        WHERE definition_id = ?`).get('definition-two')).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('enforces append-only retirement audit transitions', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      ensureWorkflowGraphSchema(db);
      db.exec(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        source, scope_type, scope_id
      ) VALUES (
        'definition-one', 'definition-one', 1, '[]', '2030-01-01', '2030-01-01',
        'database', 'application', ''
      )`);
      expect(() => db.exec(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, status, retired_at, created_at
      ) VALUES (
        'invalid-published', 'definition-one', 1, 'database', 'graph', 1, '{}',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'published', '2030-01-02', '2030-01-01'
      )`)).toThrow(/retirement state is invalid/);
      db.exec(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, created_at
      ) VALUES (
        'version-one', 'definition-one', 1, 'database', 'graph', 1, '{}',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '2030-01-01'
      )`);
      db.exec(`UPDATE workflow_definitions SET active_version_id = 'version-one'
        WHERE definition_id = 'definition-one'`);
      expect(() => db.exec(`UPDATE workflow_definition_versions
        SET status = 'retired' WHERE version_id = 'version-one'`))
        .toThrow(/retirement transition is invalid/);
      expect(() => db.exec(`UPDATE workflow_definition_versions
        SET status = 'retired', retired_at = '2030-01-02'
        WHERE version_id = 'version-one'`))
        .toThrow(/retirement transition is invalid/);
      db.exec(`UPDATE workflow_definitions SET active_version_id = NULL
        WHERE definition_id = 'definition-one'`);
      db.exec(`UPDATE workflow_definition_versions
        SET status = 'retired', retired_by = 'operator', retired_at = '2030-01-02'
        WHERE version_id = 'version-one'`);
      expect(() => db.exec(`UPDATE workflow_definition_versions
        SET status = 'published', retired_by = NULL, retired_at = NULL
        WHERE version_id = 'version-one'`))
        .toThrow(/retirement transition is invalid/);
      expect(() => db.exec(`UPDATE workflow_definition_versions
        SET retired_by = 'other' WHERE version_id = 'version-one'`))
        .toThrow(/retirement transition is invalid/);
    } finally {
      db.dispose();
    }
  });

  test('requires a draft base version to share its definition and source', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      ensureWorkflowGraphSchema(db);
      for (const suffix of ['one', 'two']) {
        db.prepare(`INSERT INTO workflow_definitions (
          definition_id, name, version, steps_json, created_at, updated_at,
          source, scope_type, scope_id
        ) VALUES (?, ?, 1, '[]', '2030-01-01', '2030-01-01',
          'database', 'application', '')`).run(`definition-${suffix}`, `definition-${suffix}`);
      }
      db.exec(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, created_at
      ) VALUES (
        'version-one', 'definition-one', 1, 'database', 'graph', 1, '{}',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        '2030-01-01'
      )`);
      expect(() => db.exec(`INSERT INTO _workflow_definition_drafts (
        draft_id, definition_id, base_version_id, source, graph_format,
        schema_version, graph_json, fingerprint, created_at, updated_at
      ) VALUES (
        'draft-two', 'definition-two', 'version-one', 'database', 'graph', 1, '{}',
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        '2030-01-01', '2030-01-01'
      )`)).toThrow(/draft base version is invalid/);
    } finally {
      db.dispose();
    }
  });
});
