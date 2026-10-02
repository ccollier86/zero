/** Upgrade coverage for migration 031's tenant and referential-integrity boundary. */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migration as initial } from './definitions/001_initial_schema';
import { migration as tenantScope } from './definitions/008_builtin_service_tenant_scope';
import { migration as graphRuntime } from './definitions/030_workflow_graph_runtime';
import { migration as graphTenantIntegrity } from './definitions/031_workflow_graph_tenant_integrity';

const REBUILT_TABLES = [
  'workflow_definitions',
  'workflow_definition_versions',
  '_workflow_definition_drafts',
  '_workflow_graph_edges',
  '_workflow_decisions',
  '_workflow_each_items',
  '_workflow_memory',
  'workflow_interactions',
  '_workflow_interaction_details',
  '_workflow_interaction_responses',
] as const;

describe('workflow graph tenant-integrity migration 031', () => {
  test('preserves released 030 rows while removing every workflow cascade', () => {
    const db = released030Database();
    try {
      seedGraphRows(db);
      const before = Object.fromEntries(REBUILT_TABLES.map((table) => [
        table,
        rows(db, table),
      ]));

      graphTenantIntegrity.up(db);

      for (const table of REBUILT_TABLES) {
        if (table === 'workflow_interactions') continue;
        const expected = table === '_workflow_interaction_responses'
          ? before[table]!.map((row) => ({ ...row, origin: 'external', event_id: null }))
          : before[table];
        expect(rows(db, table)).toEqual(expected);
        expect(cascadeCount(db, table)).toBe(0);
      }
      expect(rows(db, 'workflow_interactions')).toEqual([{
        interaction_id: 'interaction-1',
        tenant_id: 'tenant-a',
        instance_id: 'instance-1',
        node_id: 'wait-node',
        step_id: 'step-1',
        safe_label: 'Approval',
        status: 'open',
        opened_at: '2026-01-01T00:00:00.000Z',
        expires_at: null,
        accepted_at: null,
        accepted_by: null,
        rejection_count: 0,
        max_rejections: 3,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }]);
      expect(cascadeCount(db, 'workflow_interactions')).toBe(0);
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);

      // Direct repair invocation preserves trusted post-upgrade origin data,
      // rather than re-inferring it from caller-controlled legacy strings.
      db.prepare(`INSERT INTO workflow_events (
        event_id, tenant_id, instance_id, event_name, created_at
      ) VALUES ('event-repair', 'tenant-a', 'instance-1', 'repair', ?)`).run(NOW);
      db.prepare(`INSERT INTO _workflow_interaction_responses (
        response_id, interaction_id, submission_id, actor_id, channel,
        origin, event_id, payload_hash, payload_json, status, created_at
      ) VALUES ('response-repair', 'interaction-1', 'event:event-repair', 'user-1',
        'event', 'event', 'event-repair', 'hash-repair', 'true', 'processing', ?)`).run(NOW);
      const upgradedResponses = rows(db, '_workflow_interaction_responses');
      expect(() => graphTenantIntegrity.up(db)).not.toThrow();
      expect(rows(db, '_workflow_interaction_responses'))
        .toEqual(upgradedResponses);
    } finally {
      db.close();
    }
  });

  test('enforces immutable and parent-matched tenant scope after upgrade', () => {
    const db = released030Database();
    try {
      seedGraphRows(db);
      graphTenantIntegrity.up(db);

      expect(() => db.prepare(`UPDATE workflow_instances SET tenant_id = 'tenant-b'
        WHERE instance_id = 'instance-1'`).run()).toThrow(/tenant is immutable/);
      expect(() => db.prepare(`UPDATE workflow_interactions SET tenant_id = 'tenant-b'
        WHERE interaction_id = 'interaction-1'`).run())
        .toThrow(/tenant must match its parent|identity is immutable/);
      expect(() => db.prepare(`INSERT INTO workflow_events (
        event_id, tenant_id, instance_id, event_name, created_at
      ) VALUES ('event-wrong', 'tenant-b', 'instance-1', 'wrong', ?)`).run(NOW))
        .toThrow(/tenant must match its parent/);
      expect(() => db.prepare(`INSERT INTO workflow_events (
        event_id, tenant_id, instance_id, event_name, created_at
      ) VALUES ('event-orphan', NULL, 'missing-instance', 'orphan', ?)`).run(NOW))
        .toThrow(/tenant must match its parent/);
      expect(() => db.prepare(`UPDATE workflow_steps SET tenant_id = 'tenant-b'
        WHERE step_id = 'step-1'`).run())
        .toThrow(/tenant must match its parent|tenant is immutable/);
      expect(() => db.prepare(`INSERT INTO _workflow_event_authorities (
        event_id, authority_json, authority_mac, created_at
      ) VALUES ('missing-event', '{}', 'mac', ?)`).run(NOW))
        .toThrow(/authority parent is invalid/);
      db.prepare(`INSERT INTO workflow_events (
        event_id, tenant_id, instance_id, event_name, created_at
      ) VALUES ('event-1', 'tenant-a', 'instance-1', 'approved', ?)`).run(NOW);
      db.prepare(`INSERT INTO _workflow_event_delivery (
        event_id, instance_id, event_name, authority_kind, created_at
      ) VALUES ('event-1', 'instance-1', 'approved', 'actor', ?)`).run(NOW);
      db.prepare(`INSERT INTO _workflow_event_authorities (
        event_id, authority_json, authority_mac, created_at
      ) VALUES ('event-1', '{}', 'mac', ?)`).run(NOW);
      expect(() => db.prepare(`INSERT INTO _workflow_interaction_responses (
        response_id, interaction_id, submission_id, actor_id, channel,
        origin, payload_hash, payload_json, status, created_at
      ) VALUES ('spoof-channel', 'interaction-1', 'external-1', 'user-1', 'event',
        'external', 'hash', 'true', 'processing', ?)`).run(NOW))
        .toThrow(/response origin is invalid/);
      expect(() => db.prepare(`INSERT INTO _workflow_interaction_responses (
        response_id, interaction_id, submission_id, actor_id, channel,
        origin, payload_hash, payload_json, status, created_at
      ) VALUES ('spoof-id', 'interaction-1', 'event:event-1', 'user-1', 'web',
        'external', 'hash', 'true', 'processing', ?)`).run(NOW))
        .toThrow(/response origin is invalid/);
      db.prepare(`INSERT INTO _workflow_interaction_responses (
        response_id, interaction_id, submission_id, actor_id, channel,
        origin, event_id, payload_hash, payload_json, status, created_at
      ) VALUES ('trusted-event', 'interaction-1', 'event:event-1', 'user-1', 'event',
        'event', 'event-1', 'hash', 'true', 'processing', ?)`).run(NOW);
      expect(() => db.prepare(`UPDATE _workflow_interaction_responses
        SET origin = 'external' WHERE response_id = 'trusted-event'`).run())
        .toThrow(/response is immutable/);
      for (const statement of [
        `UPDATE workflow_events SET event_name = 'tampered' WHERE event_id = 'event-1'`,
        `UPDATE workflow_events SET payload = '{"tampered":true}' WHERE event_id = 'event-1'`,
        `UPDATE workflow_events SET sent_by = 'attacker' WHERE event_id = 'event-1'`,
        `UPDATE workflow_events SET created_at = '2026-01-02T00:00:00.000Z'
          WHERE event_id = 'event-1'`,
      ]) {
        expect(() => db.prepare(statement).run()).toThrow(/event command is immutable/);
      }
      for (const statement of [
        `UPDATE _workflow_event_delivery SET actor_json = '{"id":"attacker"}'
          WHERE event_id = 'event-1'`,
        `UPDATE _workflow_event_delivery SET payload_bytes = 99 WHERE event_id = 'event-1'`,
        `UPDATE _workflow_event_delivery SET actor_bytes = 99 WHERE event_id = 'event-1'`,
        `UPDATE _workflow_event_delivery SET created_at = '2026-01-02T00:00:00.000Z'
          WHERE event_id = 'event-1'`,
      ]) {
        expect(() => db.prepare(statement).run()).toThrow(/delivery envelope is immutable/);
      }
      expect(() => db.prepare(`UPDATE _workflow_event_authorities
        SET authority_mac = 'tampered' WHERE event_id = 'event-1'`).run())
        .toThrow(/authority is immutable/);
      expect(() => db.prepare(`DELETE FROM _workflow_event_authorities
        WHERE event_id = 'event-1'`).run()).toThrow(/authority is immutable/);
      expect(() => db.prepare(`UPDATE _workflow_event_delivery
        SET authority_kind = 'system' WHERE event_id = 'event-1'`).run())
        .toThrow(/delivery (?:claim mismatch|envelope is immutable)/);
      expect(() => db.prepare(`UPDATE _workflow_event_delivery
        SET claimed_by_step_id = 'discarded:wrong'
        WHERE event_id = 'legacy-event'`).run()).toThrow(/delivery claim mismatch/);
      expect(() => db.prepare(`UPDATE _workflow_event_delivery
        SET claimed_by_step_id = 'discarded:event-1'
        WHERE event_id = 'event-1'`).run()).not.toThrow();
      expect(() => db.prepare(`INSERT INTO _workflow_event_authorities (
        event_id, authority_json, authority_mac, created_at
      ) VALUES ('legacy-event', '{}', 'mac', ?)`).run(NOW))
        .toThrow(/authority parent is invalid/);
      expect(db.query(`SELECT authority_kind FROM _workflow_event_delivery
        WHERE event_id = 'legacy-event'`).get()).toEqual({
        authority_kind: 'legacy-untrusted',
      });
      expect(() => db.prepare(`DELETE FROM workflow_instances
        WHERE instance_id = 'instance-1'`).run()).toThrow(/FOREIGN KEY constraint failed/);
      expect(rows(db, '_workflow_memory')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('replaces global definition names with one unique namespace per scope', () => {
    const db = released030Database();
    try {
      seedGraphRows(db);
      graphTenantIntegrity.up(db);

      expect(() => insertDefinition(db, 'definition-tenant-a', 'tenant', 'tenant-a'))
        .not.toThrow();
      expect(() => insertDefinition(db, 'definition-tenant-b', 'tenant', 'tenant-b'))
        .not.toThrow();
      expect(() => insertDefinition(db, 'definition-tenant-a-duplicate', 'tenant', 'tenant-a'))
        .toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        source, scope_type, scope_id
      ) VALUES ('definition-invalid-code', 'Invalid code tenant', 1, '[]', ?, ?,
        'code', 'tenant', 'tenant-a')`).run(NOW, NOW))
        .toThrow(/code workflow definitions require application scope/);
      expect(() => db.prepare(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        source, scope_type, scope_id, status
      ) VALUES ('definition-invalid-values', ' Invalid ', 1.5, '[]', ?, ?,
        'database', 'application', '', 'unknown')`).run(NOW, NOW))
        .toThrow(/workflow definition values are invalid|CHECK constraint failed/);
      expect(() => db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, status, created_at
      ) VALUES ('version-wrong-source', 'definition-1', 2, 'database', 'graph',
        1, '{}', 'fingerprint-wrong-source', 'published', ?)`).run(NOW))
        .toThrow(/version source must match its definition/);
      expect(() => db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, status, created_at, retired_at
      ) VALUES ('version-invalid-published', 'definition-1', 2, 'code', 'graph',
        1, '{}', 'fingerprint-invalid-published', 'published', ?, ?)`).run(NOW, NOW))
        .toThrow(/retirement state is invalid/);
      expect(() => db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, status, created_at
      ) VALUES ('version-invalid-retired', 'definition-1', 2, 'code', 'graph',
        1, '{}', 'fingerprint-invalid-retired', 'retired', ?)`).run(NOW))
        .toThrow(/retirement state is invalid/);
      expect(() => db.prepare(`INSERT INTO _workflow_definition_drafts (
        draft_id, definition_id, source, graph_format, schema_version,
        graph_json, fingerprint, created_at, updated_at
      ) VALUES ('draft-wrong-source', 'definition-1', 'database', 'graph', 1,
        '{}', 'draft-wrong-source', ?, ?)`).run(NOW, NOW))
        .toThrow(/draft source must match its definition/);
      expect(() => db.prepare(`INSERT INTO _workflow_definition_drafts (
        draft_id, definition_id, base_version_id, source, graph_format,
        schema_version, graph_json, fingerprint, created_at, updated_at
      ) VALUES ('draft-wrong-base', 'definition-tenant-a', 'version-1',
        'database', 'graph', 1, '{}', 'draft-wrong-base', ?, ?)`).run(NOW, NOW))
        .toThrow(/draft base version is invalid/);
      expect(() => db.prepare(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        active_version_id, source, scope_type, scope_id
      ) VALUES ('definition-invalid-active', 'Invalid active', 1, '[]', ?, ?,
        'version-1', 'code', 'application', '')`).run(NOW, NOW))
        .toThrow(/active version is invalid/);
      db.prepare(`UPDATE workflow_definitions SET active_version_id = 'version-1'
        WHERE definition_id = 'definition-1'`).run();
      expect(() => db.prepare(`UPDATE workflow_definition_versions
        SET status = 'retired', retired_at = ? WHERE version_id = 'version-1'`).run(NOW))
        .toThrow(/retirement transition is invalid/);
      db.prepare(`UPDATE workflow_definitions SET active_version_id = NULL
        WHERE definition_id = 'definition-1'`).run();
      db.prepare(`UPDATE workflow_definition_versions
        SET status = 'retired', retired_at = ? WHERE version_id = 'version-1'`).run(NOW);
      expect(() => db.prepare(`UPDATE workflow_definition_versions
        SET retired_at = '2026-01-02T00:00:00.000Z' WHERE version_id = 'version-1'`).run())
        .toThrow(/retirement transition is invalid/);
      expect(() => db.prepare(`UPDATE workflow_definition_versions
        SET status = 'published', retired_at = NULL WHERE version_id = 'version-1'`).run())
        .toThrow(/retirement transition is invalid/);
      expect(rows(db, 'workflow_definition_versions')).toHaveLength(1);
      expect(rows(db, '_workflow_definition_drafts')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('rejects malformed released catalogs transactionally before rebuilding tables', () => {
    for (const corrupt of [
      (db: Database) => db.prepare(
        "UPDATE workflow_definitions SET status = 'unknown' WHERE definition_id = 'definition-1'",
      ).run(),
      (db: Database) => db.prepare(
        "UPDATE _workflow_definition_drafts SET source = 'database' WHERE draft_id = 'draft-1'",
      ).run(),
      (db: Database) => {
        db.exec('DROP TRIGGER IF EXISTS trg_workflow_definition_active_version_valid');
        db.prepare(
          "UPDATE workflow_definitions SET active_version_id = 'missing' WHERE definition_id = 'definition-1'",
        ).run();
      },
      (db: Database) => {
        db.prepare(`INSERT INTO workflow_definitions (
          definition_id, name, version, steps_json, created_at, updated_at
        ) VALUES ('definition-2', 'Definition 2', 1, '[]', ?, ?)`).run(NOW, NOW);
        db.prepare(`INSERT INTO workflow_definition_versions (
          version_id, definition_id, version_number, source, graph_format,
          schema_version, graph_json, fingerprint, status, created_at
        ) VALUES ('version-2', 'definition-2', 1, 'code', 'graph', 1, '{}',
          'fingerprint-2', 'published', ?)`).run(NOW);
        db.prepare(`UPDATE _workflow_definition_drafts SET base_version_id = 'version-2'
          WHERE draft_id = 'draft-1'`).run();
      },
      (db: Database) => db.prepare(`UPDATE workflow_definition_versions
        SET retired_at = ? WHERE version_id = 'version-1'`).run(NOW),
    ]) {
      const db = released030Database();
      try {
        seedGraphRows(db);
        corrupt(db);
        const definitionSql = tableSql(db, 'workflow_definitions');
        const definitionCount = rows(db, 'workflow_definitions').length;
        const versionCount = rows(db, 'workflow_definition_versions').length;

        expect(() => graphTenantIntegrity.up(db)).toThrow(/\[migration 031\]/);
        expect(tableSql(db, 'workflow_definitions')).toBe(definitionSql);
        expect(rows(db, 'workflow_definitions')).toHaveLength(definitionCount);
        expect(rows(db, 'workflow_definition_versions')).toHaveLength(versionCount);
        expect(db.query(`SELECT name FROM sqlite_master
          WHERE name LIKE '_zero031_backup_%'`).all()).toEqual([]);
      } finally {
        db.close();
      }
    }
  });
});

const NOW = '2026-01-01T00:00:00.000Z';

function released030Database(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  initial.up(db);
  tenantScope.up(db);
  graphRuntime.up(db);
  return db;
}

function seedGraphRows(db: Database): void {
  db.prepare(`INSERT INTO workflow_definitions (
    definition_id, name, version, steps_json, created_at, updated_at
  ) VALUES ('definition-1', 'Definition', 1, '[]', ?, ?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO workflow_definition_versions (
    version_id, definition_id, version_number, source, graph_format,
    schema_version, graph_json, fingerprint, status, created_at
  ) VALUES ('version-1', 'definition-1', 1, 'code', 'graph', 1, '{}',
    'fingerprint-1', 'published', ?)`).run(NOW);
  db.prepare(`INSERT INTO _workflow_definition_drafts (
    draft_id, definition_id, base_version_id, source, graph_format,
    schema_version, graph_json, fingerprint, created_at, updated_at
  ) VALUES ('draft-1', 'definition-1', 'version-1', 'code', 'graph', 1,
    '{}', 'draft-fingerprint', ?, ?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO workflow_instances (
    instance_id, tenant_id, definition_id, name, status, current_step,
    created_at, updated_at
  ) VALUES ('instance-1', 'tenant-a', 'definition-1', 'Instance', 'running', 0, ?, ?)`)
    .run(NOW, NOW);
  db.prepare(`INSERT INTO workflow_steps (
    step_id, tenant_id, instance_id, step_index, step_name, status,
    retries, max_retries, created_at, node_id, node_kind, activation_key
  ) VALUES ('step-1', 'tenant-a', 'instance-1', 0, 'Wait', 'waiting',
    0, 3, ?, 'wait-node', 'wait', '')`).run(NOW);
  db.prepare(`INSERT INTO workflow_events (
    event_id, tenant_id, instance_id, event_name, created_at
  ) VALUES ('legacy-event', 'tenant-a', 'instance-1', 'legacy', ?)`).run(NOW);
  db.prepare(`INSERT INTO _workflow_event_delivery (
    event_id, instance_id, event_name, created_at
  ) VALUES ('legacy-event', 'instance-1', 'legacy', ?)`).run(NOW);
  db.prepare(`INSERT INTO _workflow_graph_edges (
    edge_id, instance_id, from_node_id, to_node_id, edge_kind, ordinal, created_at
  ) VALUES ('edge-1', 'instance-1', NULL, 'wait-node', 'next', 0, ?)`).run(NOW);
  db.prepare(`INSERT INTO _workflow_decisions (
    decision_id, instance_id, node_id, activation_key, selected_edge_id, created_at
  ) VALUES ('decision-1', 'instance-1', 'branch-node', '', 'edge-1', ?)`).run(NOW);
  db.prepare(`INSERT INTO _workflow_each_items (
    item_id, instance_id, parent_step_id, node_id, activation_key, item_key,
    item_index, status, input_json, attempts, max_attempts, created_at, updated_at
  ) VALUES ('item-1', 'instance-1', 'step-1', 'each-node', '', 'item-key',
    0, 'pending', '{}', 0, 1, ?, ?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO _workflow_memory (
    memory_id, instance_id, scope_kind, scope_id, key, value_json,
    version, created_at, updated_at
  ) VALUES ('memory-1', 'instance-1', 'instance', '', 'answer', '42', 1, ?, ?)`)
    .run(NOW, NOW);
  db.prepare(`INSERT INTO workflow_interactions (
    interaction_id, instance_id, node_id, step_id, safe_label, status,
    opened_at, rejection_count, max_rejections, created_at, updated_at
  ) VALUES ('interaction-1', 'instance-1', 'wait-node', 'step-1', 'Approval',
    'open', ?, 0, 3, ?, ?)`).run(NOW, NOW, NOW);
  db.prepare(`INSERT INTO _workflow_interaction_details (
    interaction_id, response_schema_json, request_json, response_count,
    response_bytes, created_at, updated_at
  ) VALUES ('interaction-1', '{}', '{"prompt":"Approve?"}', 1, 6, ?, ?)`)
    .run(NOW, NOW);
  db.prepare(`INSERT INTO _workflow_interaction_responses (
    response_id, interaction_id, submission_id, actor_id, channel,
    payload_hash, payload_json, accepted_value_json, status, created_at
  ) VALUES ('response-1', 'interaction-1', 'submission-1', 'user-1', 'web',
    'hash-1', 'true', 'true', 'accepted', ?)`).run(NOW);
}

function insertDefinition(
  db: Database,
  definitionId: string,
  scopeType: string,
  scopeId: string,
): void {
  db.prepare(`INSERT INTO workflow_definitions (
    definition_id, name, version, steps_json, created_at, updated_at,
    source, scope_type, scope_id
  ) VALUES (?, 'Definition', 1, '[]', ?, ?, 'database', ?, ?)`)
    .run(definitionId, NOW, NOW, scopeType, scopeId);
}

function rows(db: Database, table: string): Array<Record<string, unknown>> {
  // prepare() avoids reusing column metadata cached by an earlier SELECT made
  // before the table-rebuild migration added interaction tenant_id.
  return db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() as Array<Record<string, unknown>>;
}

function cascadeCount(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM pragma_foreign_key_list(?)
    WHERE on_delete = 'CASCADE'`).get(table) as { count: number }).count;
}

function tableSql(db: Database, table: string): string {
  return (db.query(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql: string }).sql;
}
