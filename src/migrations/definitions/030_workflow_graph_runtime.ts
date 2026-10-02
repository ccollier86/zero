/**
 * 030_workflow_graph_runtime.ts
 *
 * Adds immutable workflow versions, graph runtime coordination, durable
 * scratch memory, and privacy-safe human interactions. Legacy rows are only
 * pinned when their stored definition snapshot can be proven to match.
 */

import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import {
  canonicalWorkflowJson,
  canonicalizeWorkflowDefinition,
  fingerprintStoredWorkflowDefinition,
  type CanonicalWorkflowDefinitionContent,
} from './030_workflow_definition_canonical';
import { ensureWorkflowGraphSchema } from './030_workflow_graph_schema';
import { ensureWorkflowRuntimeSchema } from './030_workflow_runtime_schema';
import type { Migration } from '../migrator';

interface LegacyDefinitionRow {
  definition_id: string;
  version: number;
  steps_json: string;
  input_schema: string | null;
  access_policy_json: string | null;
  created_at: string;
  created_by: string | null;
}

interface BackfilledVersion {
  definitionId: string;
  versionId: string;
  versionNumber: number;
  graphJson: string;
  fingerprint: string;
}

interface ExistingVersionRow {
  version_id: string;
  source: string;
  graph_format: string;
  schema_version: number;
  graph_json: string;
  input_schema_json: string | null;
  access_policy_json: string | null;
  fingerprint: string;
  status: string;
}

export const migration: Migration = {
  version: '030',
  description: 'Versioned workflow graph runtime and durable interaction state',
  safety: 'safe',

  up(db: Database) {
    ensureWorkflowGraphSchema(db);
    ensureWorkflowRuntimeSchema(db);
    db.transaction(() => {
      const versions = backfillDefinitionVersions(db);
      backfillInstancePins(db, versions);
      backfillLegacyStepNodes(db);
    })();
  },
};

function backfillDefinitionVersions(db: Database): BackfilledVersion[] {
  const rows = db.query(`SELECT definition_id, version, steps_json, input_schema,
    access_policy_json, created_at, created_by FROM workflow_definitions`)
    .all() as LegacyDefinitionRow[];
  const backfilled: BackfilledVersion[] = [];

  for (const row of rows) {
    const parsed = parseLegacyDefinition(row);
    if (!parsed) continue;
    const versionNumber = positiveVersion(row.version);
    if (versionNumber === null) continue;
    const deterministicId = `${row.definition_id}:legacy:v${versionNumber}`;
    const existing = db.query(`SELECT version_id, source, graph_format, schema_version,
      graph_json, input_schema_json, access_policy_json, fingerprint, status
      FROM workflow_definition_versions
      WHERE definition_id = ? AND version_number = ?`).get(
        row.definition_id,
        versionNumber,
      ) as ExistingVersionRow | null;

    if (existing && !isReusableLegacyVersion(existing, parsed)) {
      // A partially upgraded history disagrees with the legacy head. Leaving
      // the head unpinned fails closed without breaking legacy execution.
      continue;
    }
    const versionId = existing?.version_id ?? deterministicId;
    if (!existing) {
      const fingerprintCollision = db.query(`SELECT version_id, version_number
        FROM workflow_definition_versions
        WHERE definition_id = ? AND fingerprint = ?`).get(
          row.definition_id,
          parsed.fingerprint,
        ) as { version_id: string; version_number: number } | null;
      if (fingerprintCollision) {
        // The same immutable content at another number does not prove that a
        // legacy vN instance ran that stored version. Do not synthesize a pin
        // whose id and number disagree; leave the legacy head and instances
        // unpinned for an operator-controlled reconciliation.
        continue;
      }
      db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, input_schema_json, access_policy_json,
        fingerprint, status, created_by, created_at
      ) VALUES (?, ?, ?, 'code', 'legacy', 0, ?, ?, ?, ?, 'published', ?, ?)`)
        .run(
        versionId,
        row.definition_id,
        versionNumber,
        parsed.graphJson,
        parsed.inputSchemaJson,
        parsed.accessPolicyJson,
        parsed.fingerprint,
        row.created_by,
        row.created_at,
        );
    }
    db.prepare(`UPDATE workflow_definitions SET active_version_id = ?, source = 'code',
      status = 'active', access_policy_json = ? WHERE definition_id = ?`)
      .run(versionId, parsed.accessPolicyJson, row.definition_id);
    backfilled.push({
      definitionId: row.definition_id,
      versionId,
      versionNumber,
      graphJson: parsed.graphJson,
      fingerprint: parsed.fingerprint,
    });
  }
  return backfilled;
}

function backfillInstancePins(db: Database, versions: BackfilledVersion[]): void {
  const byDefinition = new Map(versions.map((version) => [version.definitionId, version]));
  const instances = db.query(`SELECT instance_id, definition_id, steps_json, graph_json,
    definition_version_id, definition_version, graph_fingerprint
    FROM workflow_instances`).all() as Array<{
      instance_id: string;
      definition_id: string;
      steps_json: string | null;
      graph_json: string | null;
      definition_version_id: string | null;
      definition_version: number | null;
      graph_fingerprint: string | null;
    }>;

  for (const instance of instances) {
    if (instance.graph_json !== null || instance.steps_json === null) continue;
    const graphJson = tryCanonicalJson(instance.steps_json);
    if (!graphJson) continue;
    const matching = byDefinition.get(instance.definition_id);
    const matchesVersion = matching?.graphJson === graphJson
      && (instance.definition_version_id === null
        || instance.definition_version_id === matching.versionId)
      && (instance.definition_version === null
        || instance.definition_version === matching.versionNumber)
      && (instance.graph_fingerprint === null
        || instance.graph_fingerprint === matching.fingerprint);
    if (matching && matchesVersion) {
      db.prepare(`UPDATE workflow_instances SET definition_version_id = ?,
        definition_version = ?, graph_fingerprint = ?
        WHERE instance_id = ?`).run(
        matching.versionId,
        matching.versionNumber,
        matching.fingerprint,
        instance.instance_id,
      );
      continue;
    }
    // Any non-null pin component is operator evidence from a partial upgrade.
    // If the complete tuple could not be proven above, preserve it unchanged
    // instead of making a conflicting partial pin look coherent.
    if (instance.definition_version_id !== null
      || instance.definition_version !== null
      || instance.graph_fingerprint !== null) continue;
    db.prepare(`UPDATE workflow_instances SET graph_fingerprint = ?
      WHERE instance_id = ?`).run(
      `legacy-graph:${createHash('sha256').update(graphJson).digest('hex')}`,
      instance.instance_id,
    );
  }
}

function backfillLegacyStepNodes(db: Database): void {
  db.run(`UPDATE workflow_steps SET
    node_id = COALESCE(node_id, 'legacy:' || step_index),
    node_kind = COALESCE(node_kind, 'task'),
    node_path = COALESCE(node_path, '$.steps[' || step_index || ']'),
    activation_key = COALESCE(activation_key, ''),
    updated_at = COALESCE(updated_at, completed_at, started_at, created_at)
    WHERE node_id IS NULL OR node_kind IS NULL OR activation_key IS NULL`);
}

function parseLegacyDefinition(row: LegacyDefinitionRow) {
  try {
    return canonicalizeWorkflowDefinition({
      graph: JSON.parse(row.steps_json),
      graphFormat: 'legacy',
      schemaVersion: 0,
      inputSchema: row.input_schema === null ? null : JSON.parse(row.input_schema),
      accessPolicy: row.access_policy_json === null
        ? null
        : JSON.parse(row.access_policy_json),
    });
  } catch {
    return null;
  }
}

function tryCanonicalJson(value: string): string | null {
  try {
    return canonicalWorkflowJson(JSON.parse(value));
  } catch {
    return null;
  }
}

function isReusableLegacyVersion(
  existing: ExistingVersionRow,
  expected: CanonicalWorkflowDefinitionContent,
): boolean {
  if (existing.source !== 'code'
    || existing.graph_format !== 'legacy'
    || existing.schema_version !== 0
    || existing.status !== 'published') return false;
  try {
    const verified = fingerprintStoredWorkflowDefinition({
      graphJson: existing.graph_json,
      graphFormat: existing.graph_format,
      schemaVersion: existing.schema_version,
      inputSchemaJson: existing.input_schema_json,
      accessPolicyJson: existing.access_policy_json,
    });
    return verified.fingerprint === existing.fingerprint
      && verified.fingerprint === expected.fingerprint
      && verified.graphJson === expected.graphJson
      && verified.inputSchemaJson === expected.inputSchemaJson
      && verified.accessPolicyJson === expected.accessPolicyJson;
  } catch {
    return false;
  }
}

function positiveVersion(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
