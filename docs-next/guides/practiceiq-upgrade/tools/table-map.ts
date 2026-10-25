/** Verify a complete source-bound table disposition, never execute a conversion. */
import { readSQLiteEvidence, tableNames, type SQLiteEvidence } from './offline-sqlite';
import { fail } from './safety';

const OWNERS = ['application', 'system', 'storage', 'workflow', 'audit', 'migration', 'ephemeral'];
const PLANES = ['application', 'system', 'logging-audit', 'logging-operational', 'storage', 'kv'];
const FIELDS = ['table', 'schemaSha256', 'rowsSha256', 'rows', 'owner', 'action', 'targetPlane', 'targetTable', 'rule'];

/**
 * A green result means every supplied source table has a current explicit
 * disposition. It does not validate target schemas, field transformations,
 * ownership correctness, canonical import support or permission to cut over.
 */
export function checkTableMap(evidence: unknown, plan: unknown): void {
  const source = readSQLiteEvidence(evidence);
  if ((evidence as SQLiteEvidence).inventory !== 'all') fail('UPGRADE_FULL_INVENTORY_REQUIRED');
  const input = record(plan);
  if (Object.keys(input).some(key => !['schema', 'kind', 'tables'].includes(key))
    || input.schema !== 1 || input.kind !== 'practiceiq-table-map'
    || !Array.isArray(input.tables) || !input.tables.length || input.tables.length > 1000
    || input.tables.length !== source.size) fail('UPGRADE_TABLE_MAP_INCOMPLETE');
  const seen = new Set<string>();
  for (const value of input.tables) {
    const entry = record(value);
    if (Object.keys(entry).some(key => !FIELDS.includes(key))
      || typeof entry.table !== 'string' || seen.has(entry.table)
      || typeof entry.owner !== 'string' || !OWNERS.includes(entry.owner)
      || !['preserve', 'convert', 'rebuild'].includes(entry.action as string)
      || typeof entry.rule !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._@-]{0,127}$/.test(entry.rule)) fail('UPGRADE_TABLE_MAP_INVALID');
    tableNames([entry.table]);
    const before = source.get(entry.table);
    if (!before) fail('UPGRADE_TABLE_MAP_UNKNOWN_SOURCE');
    if (entry.schemaSha256 !== before.schemaSha256 || entry.rowsSha256 !== before.rowsSha256
      || entry.rows !== before.rows) fail('UPGRADE_TABLE_MAP_STALE_SOURCE');
    if (entry.action === 'rebuild') {
      if (entry.owner !== 'ephemeral' || entry.targetPlane !== undefined || entry.targetTable !== undefined) fail('UPGRADE_TABLE_MAP_INVALID');
    } else {
      if (typeof entry.targetPlane !== 'string' || !PLANES.includes(entry.targetPlane)
        || typeof entry.targetTable !== 'string') fail('UPGRADE_TABLE_MAP_INVALID');
      tableNames([entry.targetTable]);
    }
    seen.add(entry.table);
  }
  if (seen.size !== source.size) fail('UPGRADE_TABLE_MAP_INCOMPLETE');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('UPGRADE_TABLE_MAP_INVALID');
  return value as Record<string, unknown>;
}
