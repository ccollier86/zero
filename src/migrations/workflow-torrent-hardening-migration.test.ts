/** Regression coverage for the release-line-neutral Torrent hardening migrations. */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { migration as initial } from './definitions/001_initial_schema';
import { migration as graphRuntime } from './definitions/030_workflow_graph_runtime';
import { migration as runtimeOwnership } from './definitions/032_workflow_runtime_ownership';
import { migration as torrentIntegrity } from './definitions/033_torrent_integrity_hardening';
import { hashMigration } from './schema-snapshot';

const NOW = '2026-10-02T00:00:00.000Z';
const EXPECTED_LEDGER_HASHES = {
  '032': '90ed56c1d09a758ebbf21761ae8e611acb590bdece591509c96bd4a65bc2c2b1',
  '033': '68bec9bc3be1af28a38aa10c15a88344f914ad8f01790ab71c196b524bd3e91a',
} as const;
const EXPECTED_FILE_HASHES = {
  '032_workflow_runtime_ownership.ts':
    'dba700eb05587afab3ebfce6ba9119e7af764e3f079edecbfd23e6607ba1cf94',
  '033_torrent_integrity_hardening.ts':
    'f88a844bbc276b41138670fd3e6d1f7c40b9faef1cfa173a15100e58f57e7b56',
} as const;

test('freezes the shared 032 and 033 migration contracts', () => {
  expect(hashMigration(runtimeOwnership)).toBe(EXPECTED_LEDGER_HASHES['032']);
  expect(hashMigration(torrentIntegrity)).toBe(EXPECTED_LEDGER_HASHES['033']);
  for (const [file, expected] of Object.entries(EXPECTED_FILE_HASHES)) {
    const bytes = readFileSync(new URL(`./definitions/${file}`, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
  }
});

describe('Torrent migration 032 runtime ownership', () => {
  test('is repair-safe and enforces a coherent durable generation lease', () => {
    const db = new Database(':memory:');
    try {
      runtimeOwnership.up(db);
      expect(() => runtimeOwnership.up(db)).not.toThrow();
      db.prepare(`INSERT INTO _workflow_runtime_owner_lease (
        lease_key, owner_id, generation, acquired_at, heartbeat_at, expires_at, released_at
      ) VALUES ('workflow-runtime', 'runtime-a', 1, 10, 11, 12, NULL)`).run();

      expect(() => db.prepare(`INSERT INTO _workflow_runtime_owner_lease (
        lease_key, owner_id, generation, acquired_at, heartbeat_at, expires_at
      ) VALUES ('another-runtime', 'runtime-b', 1, 10, 11, 12)`).run())
        .toThrow(/CHECK constraint failed/);
      expect(() => db.prepare(`UPDATE _workflow_runtime_owner_lease
        SET generation = 0 WHERE lease_key = 'workflow-runtime'`).run())
        .toThrow(/CHECK constraint failed/);
      expect(() => db.prepare(`UPDATE _workflow_runtime_owner_lease
        SET expires_at = heartbeat_at WHERE lease_key = 'workflow-runtime'`).run())
        .toThrow(/CHECK constraint failed/);
      expect(() => db.prepare(`UPDATE _workflow_runtime_owner_lease
        SET released_at = acquired_at - 1 WHERE lease_key = 'workflow-runtime'`).run())
        .toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });
});

describe('Torrent migration 033 generic integrity', () => {
  test('is repair-safe and protects definitions, versions, and drafts', () => {
    const db = migratedDatabase();
    try {
      expect(() => torrentIntegrity.up(db)).not.toThrow();
      seedDefinition(db, 'code-definition', 'Code definition', 'code');
      seedDefinition(db, 'database-definition', 'Database definition', 'database');
      seedVersion(db, 'code-v1', 'code-definition', 'code', 1, 'code-fingerprint');
      seedVersion(db, 'database-v1', 'database-definition', 'database', 1, 'db-fingerprint');

      expect(() => db.prepare(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        source, scope_type, scope_id, status
      ) VALUES ('bad-name', ' bad ', 1, '[]', ?, ?, 'code', 'application', '', 'active')`)
        .run(NOW, NOW)).toThrow(/workflow definition values are invalid/);
      expect(() => db.prepare(`INSERT INTO workflow_definitions (
        definition_id, name, version, steps_json, created_at, updated_at,
        source, scope_type, scope_id, status
      ) VALUES ('bad-code-scope', 'Bad code scope', 1, '[]', ?, ?,
        'code', 'tenant', 'tenant-a', 'active')`).run(NOW, NOW))
        .toThrow(/code workflow definitions require application scope/);
      expect(() => db.prepare(`UPDATE workflow_definitions SET version = -1
        WHERE definition_id = 'code-definition'`).run())
        .toThrow(/workflow definition values are invalid/);
      expect(() => seedVersion(
        db, 'wrong-source-v2', 'code-definition', 'database', 2, 'wrong-source-fingerprint',
      )).toThrow(/workflow version source must match its definition/);
      expect(() => db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, fingerprint, status, created_at, retired_at
      ) VALUES ('bad-retirement', 'code-definition', 2, 'code', 'graph',
        1, '{}', 'bad-retirement-fingerprint', 'published', ?, ?)`)
        .run(NOW, NOW)).toThrow(/workflow version retirement state is invalid/);

      db.prepare(`UPDATE workflow_definitions SET active_version_id = 'code-v1'
        WHERE definition_id = 'code-definition'`).run();
      expect(() => db.prepare(`UPDATE workflow_definition_versions
        SET status = 'retired', retired_at = ? WHERE version_id = 'code-v1'`).run(NOW))
        .toThrow(/workflow version retirement transition is invalid/);
      expect(() => db.prepare(`UPDATE workflow_definitions SET active_version_id = 'database-v1'
        WHERE definition_id = 'code-definition'`).run())
        .toThrow(/workflow active version is invalid/);

      seedDraft(db, 'valid-draft', 'database-definition', 'database', 'database-v1');
      expect(() => seedDraft(
        db, 'wrong-source-draft', 'database-definition', 'code', null,
      )).toThrow(/workflow draft source must match its definition/);
      expect(() => seedDraft(
        db, 'wrong-base-draft', 'database-definition', 'database', 'code-v1',
      )).toThrow(/workflow draft base version is invalid/);
      expect(() => db.prepare(`UPDATE _workflow_definition_drafts SET base_version_id = 'code-v1'
        WHERE draft_id = 'valid-draft'`).run())
        .toThrow(/workflow draft base version is invalid/);
    } finally {
      db.close();
    }
  });

  test('accepts only exact terminal event markers or a coherent claimed step', () => {
    const db = migratedDatabase();
    try {
      seedDefinition(db, 'events-definition', 'Events definition', 'code');
      seedRuntimeRows(db);

      expect(() => claim(db, 'delivery-invalid-consumed', 'consumed:another-event'))
        .toThrow(/workflow event delivery claim mismatch/);
      expect(() => claim(db, 'delivery-invalid-discarded', 'discarded:another-event'))
        .toThrow(/workflow event delivery claim mismatch/);
      expect(() => claim(db, 'delivery-invalid-step', 'missing-step'))
        .toThrow(/workflow event delivery claim mismatch/);

      expect(() => claim(db, 'delivery-consumed', 'consumed:event-consumed')).not.toThrow();
      expect(() => claim(db, 'delivery-discarded', 'discarded:event-discarded')).not.toThrow();
      expect(() => claim(db, 'delivery-step', 'waiting-step')).not.toThrow();
    } finally {
      db.close();
    }
  });

  test('adapts the delivery fence when the authority column is present', () => {
    const db = new Database(':memory:');
    try {
      initial.up(db);
      graphRuntime.up(db);
      db.exec(`ALTER TABLE _workflow_event_delivery
        ADD COLUMN authority_kind TEXT NOT NULL DEFAULT 'identity'`);
      torrentIntegrity.up(db);
      expect(() => torrentIntegrity.up(db)).not.toThrow();

      seedDefinition(db, 'authority-definition', 'Authority definition', 'code');
      seedRuntimeRows(db);
      expect(() => db.prepare(`UPDATE _workflow_event_delivery SET authority_kind = 'service'
        WHERE event_id = 'event-consumed'`).run())
        .toThrow(/workflow event delivery claim mismatch/);
      expect(() => claim(db, 'delivery-consumed', 'consumed:event-consumed')).not.toThrow();
    } finally {
      db.close();
    }
  });
});

function migratedDatabase(): Database {
  const db = new Database(':memory:');
  initial.up(db);
  graphRuntime.up(db);
  torrentIntegrity.up(db);
  return db;
}

function seedDefinition(
  db: Database,
  definitionId: string,
  name: string,
  source: 'code' | 'database',
): void {
  db.prepare(`INSERT INTO workflow_definitions (
    definition_id, name, version, steps_json, created_at, updated_at,
    source, scope_type, scope_id, status
  ) VALUES (?, ?, 1, '[]', ?, ?, ?, 'application', '', 'active')`)
    .run(definitionId, name, NOW, NOW, source);
}

function seedVersion(
  db: Database,
  versionId: string,
  definitionId: string,
  source: 'code' | 'database',
  versionNumber: number,
  fingerprint: string,
): void {
  db.prepare(`INSERT INTO workflow_definition_versions (
    version_id, definition_id, version_number, source, graph_format,
    schema_version, graph_json, fingerprint, status, created_at
  ) VALUES (?, ?, ?, ?, 'graph', 1, '{}', ?, 'published', ?)`)
    .run(versionId, definitionId, versionNumber, source, fingerprint, NOW);
}

function seedDraft(
  db: Database,
  draftId: string,
  definitionId: string,
  source: 'code' | 'database',
  baseVersionId: string | null,
): void {
  db.prepare(`INSERT INTO _workflow_definition_drafts (
    draft_id, definition_id, base_version_id, source, graph_format,
    schema_version, graph_json, fingerprint, revision, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'graph', 1, '{}', ?, 1, ?, ?)`)
    .run(draftId, definitionId, baseVersionId, source, `${draftId}-fingerprint`, NOW, NOW);
}

function seedRuntimeRows(db: Database): void {
  db.prepare(`INSERT INTO workflow_instances (
    instance_id, definition_id, name, status, current_step, created_at, updated_at
  ) VALUES ('instance-1', 'events-definition', 'Events run', 'running', 0, ?, ?)`)
    .run(NOW, NOW);
  db.prepare(`INSERT INTO workflow_steps (
    step_id, instance_id, step_index, step_name, status, retries, max_retries,
    wait_event, created_at, node_id, node_kind, node_path, activation_key, updated_at
  ) VALUES ('waiting-step', 'instance-1', 0, 'Wait', 'waiting', 0, 3,
    'approval', ?, 'wait', 'wait', '$.wait', '', ?)`).run(NOW, NOW);

  for (const suffix of [
    'invalid-consumed',
    'invalid-discarded',
    'invalid-step',
    'consumed',
    'discarded',
    'step',
  ]) {
    const eventId = `event-${suffix}`;
    db.prepare(`INSERT INTO workflow_events (
      event_id, instance_id, event_name, payload, created_at
    ) VALUES (?, 'instance-1', 'approval', '{}', ?)`).run(eventId, NOW);
    db.prepare(`INSERT INTO _workflow_event_delivery (
      event_id, instance_id, event_name, claimed_by_step_id, claimed_at,
      actor_json, payload_bytes, actor_bytes, created_at
    ) VALUES (?, 'instance-1', 'approval', NULL, NULL, NULL, 2, 0, ?)`)
      .run(eventId, NOW);
  }
}

function claim(db: Database, deliveryId: string, claimValue: string): void {
  const eventId = deliveryId.replace('delivery-', 'event-');
  db.prepare(`UPDATE _workflow_event_delivery SET claimed_by_step_id = ?, claimed_at = ?
    WHERE event_id = ?`).run(claimValue, NOW, eventId);
}
