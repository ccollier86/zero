/** Migration/backfill parity for the versioned workflow graph runtime. */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineWorkflowTables } from '../workflows/workflow-schema';
import { ensureWorkflowGraphSchema } from '../workflows/workflow-graph-schema';
import { ensureWorkflowRuntimeSchema } from '../workflows/workflow-runtime-schema';
import { canonicalizeWorkflowDefinition } from './definitions/030_workflow_definition_canonical';
import {
  ensureWorkflowGraphSchema as ensureReleased030WorkflowGraphSchema,
} from './definitions/030_workflow_graph_schema';
import { migration as initial } from './definitions/001_initial_schema';
import { migration as tenantScope } from './definitions/008_builtin_service_tenant_scope';
import { migration as graphRuntime } from './definitions/030_workflow_graph_runtime';
import { migration as graphTenantIntegrity } from './definitions/031_workflow_graph_tenant_integrity';
import { migration as runtimeOwnership } from './definitions/032_workflow_runtime_ownership';
import { normalizeSql } from './schema-snapshot';

const NEW_TABLES = [
  'workflow_definition_versions',
  '_workflow_definition_drafts',
  '_workflow_graph_edges',
  '_workflow_decisions',
  '_workflow_each_items',
  '_workflow_memory',
  'workflow_interactions',
  '_workflow_interaction_details',
  '_workflow_interaction_responses',
  '_workflow_event_delivery',
  '_workflow_event_authorities',
  '_workflow_event_usage',
  '_workflow_step_attempts',
  '_workflow_pauses',
  '_workflow_runtime_usage',
  '_workflow_runtime_owner_lease',
] as const;

describe('workflow graph runtime migration 030', () => {
  test('retains the released schema contract before the appended 031 upgrade', () => {
    const db = new Database(':memory:');
    try {
      initial.up(db);
      tenantScope.up(db);
      graphRuntime.up(db);

      expect(columnNames(db, 'workflow_interactions')).not.toContain('tenant_id');
      expect(cascadeTables(db)).toEqual([
        '_workflow_decisions',
        '_workflow_definition_drafts',
        '_workflow_each_items',
        '_workflow_graph_edges',
        '_workflow_interaction_details',
        '_workflow_interaction_responses',
        '_workflow_memory',
        'workflow_interactions',
      ]);
      expect(released030SchemaHash(db))
        .toBe('318c1ed66528218d264964cf01569be74b7b5fb70a6d2860f5d8eb9bc98e1608');
    } finally {
      db.close();
    }
  });

  test('backfills only provable legacy versions and instance pins', () => {
    const db = new Database(':memory:');
    try {
      initial.up(db);
      seedLegacyRows(db);
      graphRuntime.up(db);

      const version = db.query(`SELECT * FROM workflow_definition_versions
        WHERE definition_id = 'valid-definition'`).get() as Record<string, unknown>;
      expect(version).toMatchObject({
        version_id: 'valid-definition:legacy:v3',
        version_number: 3,
        graph_format: 'legacy',
        schema_version: 0,
        status: 'published',
      });
      expect(db.query(`SELECT active_version_id FROM workflow_definitions
        WHERE definition_id = 'valid-definition'`).get()).toEqual({
        active_version_id: 'valid-definition:legacy:v3',
      });
      expect(db.query(`SELECT active_version_id FROM workflow_definitions
        WHERE definition_id = 'invalid-definition'`).get()).toEqual({
        active_version_id: null,
      });

      expect(db.query(`SELECT definition_version_id, definition_version, graph_json
        FROM workflow_instances WHERE instance_id = 'matching-instance'`).get())
        .toMatchObject({
          definition_version_id: 'valid-definition:legacy:v3',
          definition_version: 3,
          graph_json: null,
        });
      expect(db.query(`SELECT definition_version_id, graph_json, graph_fingerprint
        FROM workflow_instances WHERE instance_id = 'older-instance'`).get())
        .toMatchObject({
          definition_version_id: null,
          graph_json: null,
        });
      expect(String((db.query(`SELECT graph_fingerprint FROM workflow_instances
        WHERE instance_id = 'older-instance'`).get() as { graph_fingerprint: string })
        .graph_fingerprint)).toStartWith('legacy-graph:');
      expect(db.query(`SELECT definition_version_id, graph_json FROM workflow_instances
        WHERE instance_id = 'malformed-instance'`).get()).toEqual({
        definition_version_id: null,
        graph_json: null,
      });
      expect(db.query(`SELECT node_id, node_kind, node_path, activation_key, updated_at
        FROM workflow_steps WHERE step_id = 'legacy-step'`).get()).toEqual({
        node_id: 'legacy:0',
        node_kind: 'task',
        node_path: '$.steps[0]',
        activation_key: '',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      expect(() => db.run(`UPDATE workflow_definition_versions
        SET graph_json = '[]' WHERE version_id = 'valid-definition:legacy:v3'`))
        .toThrow(/immutable/);
      expect(() => db.run(`DELETE FROM workflow_definition_versions
        WHERE version_id = 'valid-definition:legacy:v3'`)).toThrow(/append-only/);

      // The additive migration is repair-safe when invoked again directly.
      db.prepare(`UPDATE workflow_definitions SET active_version_id = NULL,
        status = 'draft' WHERE definition_id = 'valid-definition'`).run();
      expect(() => graphRuntime.up(db)).not.toThrow();
      const count = db.query('SELECT COUNT(*) AS count FROM workflow_definition_versions')
        .get() as { count: number };
      expect(count.count).toBe(1);
      expect(db.query(`SELECT active_version_id, source, status FROM workflow_definitions
        WHERE definition_id = 'valid-definition'`).get()).toEqual({
          active_version_id: 'valid-definition:legacy:v3',
          source: 'code',
          status: 'active',
        });
    } finally {
      db.close();
    }
  });

  test('032 upgrade matches current runtime repair for every graph table and column', () => {
    const migrated = new Database(':memory:');
    const runtimeRaw = new Database(':memory:');
    const schemaRaw = new Database(':memory:');
    initial.up(migrated);
    tenantScope.up(migrated);
    graphRuntime.up(migrated);
    graphTenantIntegrity.up(migrated);
    runtimeOwnership.up(migrated);
    const runtime = createReactiveDB({ database: runtimeRaw, clearChangesOnStart: false });
    try {
      defineWorkflowTables(runtime);
      ensureWorkflowGraphSchema(schemaRaw);
      ensureWorkflowRuntimeSchema(schemaRaw);
      for (const table of NEW_TABLES) {
        expect(tableShape(migrated, table)).toEqual(tableShape(runtimeRaw, table));
      }
      expect(tableShape(migrated, 'workflow_definitions'))
        .toEqual(tableShape(runtimeRaw, 'workflow_definitions'));
      for (const table of ['workflow_instances', 'workflow_steps']) {
        expect(columnNames(migrated, table).sort())
          .toEqual(columnNames(runtimeRaw, table).sort());
      }
      expect(columnNames(migrated, '_workflow_event_delivery')).toContain('actor_json');
      expect(workflowTriggerShape(migrated)).toEqual(workflowTriggerShape(schemaRaw));
    } finally {
      runtime.dispose();
      migrated.close();
      runtimeRaw.close();
      schemaRaw.close();
    }
  });

  test('backfills interaction response counters only when the columns are introduced', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE _workflow_interaction_details (
        interaction_id TEXT PRIMARY KEY,
        responder_policy_json TEXT,
        response_schema_json TEXT NOT NULL,
        request_json TEXT,
        validator_activity_id TEXT,
        accepted_response_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.exec(`CREATE TABLE _workflow_interaction_responses (
        response_id TEXT PRIMARY KEY,
        interaction_id TEXT NOT NULL,
        submission_id TEXT NOT NULL,
        actor_id TEXT,
        channel TEXT,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        accepted_value_json TEXT,
        status TEXT NOT NULL,
        rejection_code TEXT,
        public_message TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      )`);
      const now = '2026-01-01T00:00:00.000Z';
      db.prepare(`INSERT INTO _workflow_interaction_details VALUES
        ('wait', NULL, 'null', 'null', NULL, 'response-1', ?, ?)`).run(now, now);
      db.prepare(`INSERT INTO _workflow_interaction_responses VALUES
        ('response-1', 'wait', 'submission-1', 'owner', 'web', 'hash', ?, ?,
          'accepted', NULL, NULL, ?, ?),
        ('response-2', 'wait', 'submission-2', 'owner', 'web', 'hash', '{}', NULL,
          'superseded', NULL, NULL, ?, ?)`).run('"é"', '"ok"', now, now, now, now);

      ensureReleased030WorkflowGraphSchema(db);
      const expectedBytes = Buffer.byteLength('"é"') + Buffer.byteLength('"ok"')
        + Buffer.byteLength('{}');
      expect(db.query(`SELECT response_count, response_bytes
        FROM _workflow_interaction_details WHERE interaction_id = 'wait'`).get())
        .toEqual({ response_count: 2, response_bytes: expectedBytes });

      db.prepare(`UPDATE _workflow_interaction_details
        SET response_count = 99, response_bytes = 999 WHERE interaction_id = 'wait'`).run();
      ensureReleased030WorkflowGraphSchema(db);
      expect(db.query(`SELECT response_count, response_bytes
        FROM _workflow_interaction_details WHERE interaction_id = 'wait'`).get())
        .toEqual({ response_count: 99, response_bytes: 999 });
    } finally {
      db.close();
    }
  });

  test('never pins a legacy version number to a fingerprint collision at another version', () => {
    const db = new Database(':memory:');
    try {
      initial.up(db);
      const now = '2026-01-01T00:00:00.000Z';
      const stepsJson = '[{"name":"One","handler":"noop"}]';
      db.prepare(`INSERT INTO workflow_definitions
        (definition_id, name, version, steps_json, input_schema, created_at, updated_at)
        VALUES ('collision-definition', 'collision', 3, ?, NULL, ?, ?)`).run(
          stepsJson,
          now,
          now,
        );
      insertInstance(db, 'collision-instance', 'collision-definition', stepsJson, now);
      ensureReleased030WorkflowGraphSchema(db);
      const canonical = canonicalizeWorkflowDefinition({
        graph: JSON.parse(stepsJson),
        graphFormat: 'legacy',
        schemaVersion: 0,
        inputSchema: null,
        accessPolicy: null,
      });
      db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, input_schema_json, access_policy_json,
        fingerprint, status, created_by, created_at
      ) VALUES ('collision-v2', 'collision-definition', 2, 'code', 'legacy',
        0, ?, NULL, NULL, ?, 'published', NULL, ?)`).run(
          canonical.graphJson,
          canonical.fingerprint,
          now,
        );

      graphRuntime.up(db);

      expect(db.query(`SELECT active_version_id FROM workflow_definitions
        WHERE definition_id = 'collision-definition'`).get()).toEqual({
        active_version_id: null,
      });
      expect(db.query(`SELECT definition_version_id, definition_version, graph_fingerprint
        FROM workflow_instances WHERE instance_id = 'collision-instance'`).get())
        .toMatchObject({
          definition_version_id: null,
          definition_version: null,
        });
      const instance = db.query(`SELECT graph_fingerprint FROM workflow_instances
        WHERE instance_id = 'collision-instance'`).get() as { graph_fingerprint: string };
      expect(instance.graph_fingerprint).toStartWith('legacy-graph:');
      expect(db.query(`SELECT version_id, version_number FROM workflow_definition_versions
        WHERE definition_id = 'collision-definition'`).all()).toEqual([
        { version_id: 'collision-v2', version_number: 2 },
      ]);
    } finally {
      db.close();
    }
  });

  test('does not reuse database-authored or retired rows that merely share content', () => {
    const db = new Database(':memory:');
    try {
      initial.up(db);
      ensureReleased030WorkflowGraphSchema(db);
      const now = '2026-01-01T00:00:00.000Z';
      const stepsJson = '[{"name":"One","handler":"noop"}]';
      const canonical = canonicalizeWorkflowDefinition({
        graph: JSON.parse(stepsJson), graphFormat: 'legacy', schemaVersion: 0,
        inputSchema: null, accessPolicy: null,
      });
      for (const [suffix, source, status] of [
        ['database', 'database', 'published'],
        ['retired', 'code', 'retired'],
      ] as const) {
        const definitionId = `${suffix}-definition`;
        db.prepare(`INSERT INTO workflow_definitions
          (definition_id, name, version, steps_json, input_schema, created_at, updated_at)
          VALUES (?, ?, 4, ?, NULL, ?, ?)`).run(
            definitionId, suffix, stepsJson, now, now,
          );
        insertInstance(db, `${suffix}-instance`, definitionId, stepsJson, now);
        db.prepare(`INSERT INTO workflow_definition_versions (
          version_id, definition_id, version_number, source, graph_format,
          schema_version, graph_json, input_schema_json, access_policy_json,
          fingerprint, status, created_by, created_at
        ) VALUES (?, ?, 4, ?, 'legacy', 0, ?, NULL, NULL, ?, ?, NULL, ?)`).run(
          `${suffix}-v4`, definitionId, source, canonical.graphJson,
          canonical.fingerprint, status, now,
        );
      }

      graphRuntime.up(db);

      for (const suffix of ['database', 'retired']) {
        expect(db.query(`SELECT active_version_id FROM workflow_definitions
          WHERE definition_id = ?`).get(`${suffix}-definition`)).toEqual({
            active_version_id: null,
          });
        expect(db.query(`SELECT definition_version_id, definition_version
          FROM workflow_instances WHERE instance_id = ?`).get(`${suffix}-instance`))
          .toEqual({ definition_version_id: null, definition_version: null });
      }
    } finally {
      db.close();
    }
  });

  test('repairs compatible partial pins without overwriting conflicting immutable evidence', () => {
    const db = new Database(':memory:');
    try {
      initial.up(db);
      const now = '2026-01-01T00:00:00.000Z';
      const stepsJson = '[{"name":"One","handler":"noop"}]';
      db.prepare(`INSERT INTO workflow_definitions
        (definition_id, name, version, steps_json, input_schema, created_at, updated_at)
        VALUES ('partial-definition', 'partial', 3, ?, NULL, ?, ?)`).run(
          stepsJson,
          now,
          now,
        );
      insertInstance(db, 'compatible-partial', 'partial-definition', stepsJson, now);
      insertInstance(db, 'conflicting-partial', 'partial-definition', stepsJson, now);
      insertInstance(db, 'conflicting-version-id', 'partial-definition', stepsJson, now);
      insertInstance(db, 'conflicting-version-number', 'partial-definition', stepsJson, now);
      ensureReleased030WorkflowGraphSchema(db);
      const canonical = canonicalizeWorkflowDefinition({
        graph: JSON.parse(stepsJson), graphFormat: 'legacy', schemaVersion: 0,
        inputSchema: null, accessPolicy: null,
      });
      const versionId = 'partial-definition:legacy:v3';
      db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, input_schema_json, access_policy_json,
        fingerprint, status, created_by, created_at
      ) VALUES (?, 'partial-definition', 3, 'code', 'legacy', 0, ?, NULL, NULL,
        ?, 'published', NULL, ?)`).run(
          versionId,
          canonical.graphJson,
          canonical.fingerprint,
          now,
        );
      db.prepare(`UPDATE workflow_instances SET definition_version_id = ?
        WHERE instance_id = 'compatible-partial'`).run(versionId);
      db.prepare(`UPDATE workflow_instances SET graph_fingerprint = 'operator-evidence'
        WHERE instance_id = 'conflicting-partial'`).run();
      db.prepare(`UPDATE workflow_instances SET definition_version_id = 'other-version'
        WHERE instance_id = 'conflicting-version-id'`).run();
      db.prepare(`UPDATE workflow_instances SET definition_version = 99
        WHERE instance_id = 'conflicting-version-number'`).run();

      expect(() => graphRuntime.up(db)).not.toThrow();
      expect(db.query(`SELECT definition_version_id, definition_version, graph_fingerprint
        FROM workflow_instances WHERE instance_id = 'compatible-partial'`).get()).toEqual({
          definition_version_id: versionId,
          definition_version: 3,
          graph_fingerprint: canonical.fingerprint,
        });
      expect(db.query(`SELECT definition_version_id, definition_version, graph_fingerprint
        FROM workflow_instances WHERE instance_id = 'conflicting-partial'`).get()).toEqual({
        definition_version_id: null,
        definition_version: null,
        graph_fingerprint: 'operator-evidence',
      });
      expect(db.query(`SELECT definition_version_id, definition_version, graph_fingerprint
        FROM workflow_instances WHERE instance_id = 'conflicting-version-id'`).get()).toEqual({
          definition_version_id: 'other-version',
          definition_version: null,
          graph_fingerprint: null,
        });
      expect(db.query(`SELECT definition_version_id, definition_version, graph_fingerprint
        FROM workflow_instances WHERE instance_id = 'conflicting-version-number'`).get()).toEqual({
          definition_version_id: null,
          definition_version: 99,
          graph_fingerprint: null,
        });
    } finally {
      db.close();
    }
  });

  test('skips invalid legacy version numbers instead of inventing version one', () => {
    const db = new Database(':memory:');
    try {
      initial.up(db);
      const now = '2026-01-01T00:00:00.000Z';
      const stepsJson = '[{"name":"One","handler":"noop"}]';
      db.prepare(`INSERT INTO workflow_definitions
        (definition_id, name, version, steps_json, input_schema, created_at, updated_at)
        VALUES ('invalid-version-definition', 'invalid-version', 0, ?, NULL, ?, ?)`).run(
          stepsJson, now, now,
        );
      insertInstance(db, 'invalid-version-instance', 'invalid-version-definition', stepsJson, now);

      graphRuntime.up(db);

      expect(db.query(`SELECT active_version_id FROM workflow_definitions
        WHERE definition_id = 'invalid-version-definition'`).get()).toEqual({
          active_version_id: null,
        });
      expect(db.query(`SELECT COUNT(*) AS count FROM workflow_definition_versions
        WHERE definition_id = 'invalid-version-definition'`).get()).toEqual({ count: 0 });
      expect(db.query(`SELECT definition_version_id, definition_version
        FROM workflow_instances WHERE instance_id = 'invalid-version-instance'`).get())
        .toEqual({ definition_version_id: null, definition_version: null });
    } finally {
      db.close();
    }
  });
});

function seedLegacyRows(db: Database): void {
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare(`INSERT INTO workflow_definitions
    (definition_id, name, version, steps_json, input_schema, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'valid-definition', 'valid', 3,
      '[{"name":"One","handler":"noop"}]', '{"type":"object"}', now, now,
    );
  db.prepare(`INSERT INTO workflow_definitions
    (definition_id, name, version, steps_json, input_schema, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)`).run(
      'invalid-definition', 'invalid', 1, '{bad json', now, now,
    );
  insertInstance(db, 'matching-instance', 'valid-definition',
    '[{"name":"One","handler":"noop"}]', now);
  insertInstance(db, 'older-instance', 'valid-definition',
    '[{"name":"Older","handler":"noop"}]', now);
  insertInstance(db, 'malformed-instance', 'invalid-definition', '{bad json', now);
  db.prepare(`INSERT INTO workflow_steps (
    step_id, instance_id, step_index, step_name, status, retries, max_retries,
    created_at
  ) VALUES ('legacy-step', 'matching-instance', 0, 'noop', 'pending', 0, 3, ?)`)
    .run(now);
}

function insertInstance(
  db: Database,
  instanceId: string,
  definitionId: string,
  stepsJson: string,
  now: string,
): void {
  db.prepare(`INSERT INTO workflow_instances (
    instance_id, definition_id, name, status, current_step, steps_json,
    created_at, updated_at
  ) VALUES (?, ?, 'legacy', 'pending', 0, ?, ?, ?)`).run(
    instanceId,
    definitionId,
    stepsJson,
    now,
    now,
  );
}

function tableShape(db: Database, table: string) {
  const indexes = db.query(`PRAGMA index_list(${table})`).all() as Array<{
    name: string;
  }>;
  return {
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    indexes: indexes.map((index) => ({
      ...index,
      columns: db.query(`PRAGMA index_xinfo(${index.name})`).all(),
      sql: normalizeSql((db.query(`SELECT sql FROM sqlite_master
        WHERE type = 'index' AND name = ?`).get(index.name) as { sql: string | null }).sql ?? ''),
    })),
    foreignKeys: db.query(`PRAGMA foreign_key_list(${table})`).all(),
  };
}

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function workflowTriggerShape(db: Database): Array<{ name: string; sql: string }> {
  return (db.query(`SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_workflow_%'
    ORDER BY name`).all() as Array<{ name: string; sql: string }>)
    .map((trigger) => ({ ...trigger, sql: normalizeSql(trigger.sql) }));
}

function cascadeTables(db: Database): string[] {
  return db.query(`SELECT DISTINCT sqlite_master.name
    FROM sqlite_master, pragma_foreign_key_list(sqlite_master.name) AS foreign_key
    WHERE sqlite_master.type = 'table' AND foreign_key.on_delete = 'CASCADE'
      AND (sqlite_master.name LIKE 'workflow_%'
        OR sqlite_master.name LIKE '_workflow_%')
    ORDER BY sqlite_master.name`).all()
    .map((row) => (row as { name: string }).name);
}

function released030SchemaHash(db: Database): string {
  const tables = [
    'workflow_definitions',
    'workflow_instances',
    'workflow_steps',
    ...NEW_TABLES,
  ];
  const placeholders = tables.map(() => '?').join(', ');
  const schema = db.query(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name IN (${placeholders}) ORDER BY type, name`).all(...tables);
  return new Bun.CryptoHasher('sha256')
    .update(JSON.stringify(schema))
    .digest('hex');
}
