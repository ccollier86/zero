/**
 * sync-mode-resolver.ts
 *
 * Resolves table sync modes for platform apps after ReactiveDB tables exist.
 * Schema/config declarations stay lightweight, while startup can inspect row
 * counts, persist auto decisions, and update all runtime consumers from one
 * decision point.
 */

import type { ReactiveDB } from '../../sync/reactive-db';
import type { DeclaredSyncMode, SyncMode } from '../../sync/types';
import type { ResolvedConfig, ResolvedSyncDefaults, ResolvedTableSyncDefault } from './types';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import type { PlatformCodeDefinition } from '../../observability/types';

const TABLE_SYNC_MODES_TABLE = '_zero_sync_table_modes';

/** Minimal logger contract used by the resolver. */
export interface SyncModeResolverLogger {
  warn(message: string): void;
  log(message: string): void;
}

/** One table's resolved sync mode and the reason behind it. */
export interface TableSyncModeDecision {
  table: string;
  declaredMode: DeclaredSyncMode;
  resolvedMode: SyncMode;
  source: 'explicit' | 'auto' | 'persisted';
  rowCount: number;
  rowLimit: number;
  persisted: boolean;
  reason: string;
}

/** Complete startup sync-mode resolution result. */
export interface SyncModeResolution {
  decisions: TableSyncModeDecision[];
  lazyTables: Set<string>;
  snapshotTables: Set<string>;
  resolvedSyncModes: Record<string, SyncMode>;
}

interface PersistedSyncModeRow {
  table_name: string;
  mode: SyncMode;
  source: string;
  row_count_at_decision: number;
  row_limit: number;
  updated_at: number;
}

interface ResolveTableOptions {
  table: string;
  declaredMode: DeclaredSyncMode;
  rowCount: number;
  tableDefault: ResolvedTableSyncDefault;
  persistedRow: PersistedSyncModeRow | null;
}

/**
 * Resolve all table sync modes and persist auto decisions when configured.
 */
export function resolveTableSyncModes(
  config: ResolvedConfig,
  db: ReactiveDB,
  logger?: SyncModeResolverLogger
): SyncModeResolution {
  ensureSyncModeTable(db);

  const decisions: TableSyncModeDecision[] = [];
  const lazyTables = new Set<string>();
  const snapshotTables = new Set<string>();
  const resolvedSyncModes: Record<string, SyncMode> = {};

  for (const table of Object.keys(config.tables)) {
    const declaredMode = config.declaredSyncModes.get(table) ?? config.syncDefaults.defaultMode;
    const tableDefault = getTableDefault(config.syncDefaults, table);
    const rowCount = countRows(db, table);
    const persistedRow = tableDefault.persist ? readPersistedMode(db, table) : null;
    const decision = resolveTableMode({
      table,
      declaredMode,
      rowCount,
      tableDefault,
      persistedRow,
    });

    decisions.push(decision);
    resolvedSyncModes[table] = decision.resolvedMode;

    if (decision.resolvedMode === 'lazy') {
      lazyTables.add(table);
    } else {
      snapshotTables.add(table);
    }

    if (decision.source === 'auto' && tableDefault.persist) {
      persistModeDecision(db, decision);
      decision.persisted = true;
    }

    logDecision(decision, logger);
  }

  return { decisions, lazyTables, snapshotTables, resolvedSyncModes };
}

/**
 * Apply a resolution result to the mutable sets/record shared with plugins.
 */
export function applyTableSyncResolution(
  config: ResolvedConfig,
  resolution: SyncModeResolution
): void {
  config.lazyTables.clear();
  config.snapshotTables.clear();

  for (const key of Object.keys(config.resolvedSyncModes)) {
    delete config.resolvedSyncModes[key];
  }

  for (const table of resolution.lazyTables) config.lazyTables.add(table);
  for (const table of resolution.snapshotTables) config.snapshotTables.add(table);
  for (const [table, mode] of Object.entries(resolution.resolvedSyncModes)) {
    config.resolvedSyncModes[table] = mode;
  }
}

/** Resolve one table from explicit, persisted, or auto row-count policy. */
function resolveTableMode(options: ResolveTableOptions): TableSyncModeDecision {
  const { table, declaredMode, rowCount, tableDefault, persistedRow } = options;
  const { rowLimit, action } = tableDefault;

  if (declaredMode === 'lazy') {
    return {
      table,
      declaredMode,
      resolvedMode: 'lazy',
      source: 'explicit',
      rowCount,
      rowLimit,
      persisted: false,
      reason: 'explicit lazy sync',
    };
  }

  if (declaredMode === 'full') {
    return {
      table,
      declaredMode,
      resolvedMode: 'full',
      source: 'explicit',
      rowCount,
      rowLimit,
      persisted: false,
      reason: rowCount > rowLimit
        ? 'explicit full sync exceeds auto-lazy row limit'
        : 'explicit full sync',
    };
  }

  if (action === 'reject' && rowCount > rowLimit) {
    throw new Error(
      `[sync] Table "${table}" has ${rowCount} rows, exceeding auto-lazy rowLimit ${rowLimit}. ` +
      `Set sync: 'lazy', increase syncDefaults, or use action: 'lazy'.`
    );
  }

  if (action === 'lazy' && persistedRow?.mode === 'lazy') {
    return {
      table,
      declaredMode,
      resolvedMode: 'lazy',
      source: 'persisted',
      rowCount,
      rowLimit,
      persisted: true,
      reason: 'persisted auto-lazy decision',
    };
  }

  if (rowCount > rowLimit) {
    return {
      table,
      declaredMode,
      resolvedMode: action === 'lazy' ? 'lazy' : 'full',
      source: 'auto',
      rowCount,
      rowLimit,
      persisted: false,
      reason: action === 'lazy'
        ? 'row count exceeds auto-lazy limit'
        : 'row count exceeds auto-lazy limit but action is warn',
    };
  }

  return {
    table,
    declaredMode,
    resolvedMode: 'full',
    source: 'auto',
    rowCount,
    rowLimit,
    persisted: false,
    reason: 'row count within full snapshot limit',
  };
}

/** Return table-specific sync defaults layered over global defaults. */
function getTableDefault(
  defaults: ResolvedSyncDefaults,
  table: string
): ResolvedTableSyncDefault {
  return defaults.tables.get(table) ?? {
    rowLimit: defaults.rowLimit,
    action: defaults.action,
    persist: defaults.persist,
  };
}

/** Create the internal persistence table used for stable auto decisions. */
function ensureSyncModeTable(db: ReactiveDB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE_SYNC_MODES_TABLE} (` +
    'table_name text primary key, ' +
    'mode text not null, ' +
    'source text not null, ' +
    'reason text not null, ' +
    'row_count_at_decision integer not null, ' +
    'row_limit integer not null, ' +
    'created_at integer not null, ' +
    'updated_at integer not null' +
    ')'
  );
}

/** Load a previous auto decision for a table. */
function readPersistedMode(db: ReactiveDB, table: string): PersistedSyncModeRow | null {
  const row = db
    .prepare(
      `SELECT table_name, mode, source, row_count_at_decision, row_limit, updated_at ` +
      `FROM ${TABLE_SYNC_MODES_TABLE} WHERE table_name = ?`
    )
    .get(table) as PersistedSyncModeRow | null;

  if (!row || (row.mode !== 'full' && row.mode !== 'lazy')) return null;
  return row;
}

/** Save an auto decision so tables do not flip between startup modes. */
function persistModeDecision(db: ReactiveDB, decision: TableSyncModeDecision): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ${TABLE_SYNC_MODES_TABLE} ` +
    '(table_name, mode, source, reason, row_count_at_decision, row_limit, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(table_name) DO UPDATE SET ' +
    'mode = excluded.mode, ' +
    'source = excluded.source, ' +
    'reason = excluded.reason, ' +
    'row_count_at_decision = excluded.row_count_at_decision, ' +
    'row_limit = excluded.row_limit, ' +
    'updated_at = excluded.updated_at'
  ).run(
    decision.table,
    decision.resolvedMode,
    decision.source,
    decision.reason,
    decision.rowCount,
    decision.rowLimit,
    now,
    now
  );
}

/** Count rows in a user table using an identifier-safe query. */
function countRows(db: ReactiveDB, table: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
    .get() as { count: number | bigint } | null;
  return Number(row?.count ?? 0);
}

/** Quote a SQLite identifier after validating the platform table-name shape. */
function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`[sync] Invalid table identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Emit useful startup warnings without making normal auto decisions noisy. */
function logDecision(decision: TableSyncModeDecision, logger?: SyncModeResolverLogger): void {
  if (decision.source === 'explicit' && decision.resolvedMode === 'full' && decision.rowCount > decision.rowLimit) {
    emitSyncModeWarning(
      OBS_CODES.SYNC_MODE_FULL_OVER_LIMIT,
      decision,
      `[sync] Table "${decision.table}" uses explicit full sync with ${decision.rowCount} rows ` +
      `(auto-lazy limit ${decision.rowLimit}). Keeping full sync because explicit config wins.`,
      logger
    );
    return;
  }

  if (decision.source === 'auto' && decision.reason.includes('action is warn')) {
    emitSyncModeWarning(
      OBS_CODES.SYNC_MODE_WARN_OVER_LIMIT,
      decision,
      `[sync] Table "${decision.table}" has ${decision.rowCount} rows over auto-lazy limit ` +
      `${decision.rowLimit}, but syncDefaults action is warn; keeping full sync.`,
      logger
    );
    return;
  }

  if (decision.source === 'auto' && decision.resolvedMode === 'lazy') {
    emitSyncModeWarning(
      OBS_CODES.SYNC_MODE_AUTO_LAZY,
      decision,
      `[sync] Table "${decision.table}" auto-resolved to lazy sync ` +
      `(${decision.rowCount} rows > limit ${decision.rowLimit}).`,
      logger
    );
  }
}

function emitSyncModeWarning(
  code: PlatformCodeDefinition,
  decision: TableSyncModeDecision,
  message: string,
  logger?: SyncModeResolverLogger
): void {
  emitPlatformCode(code, {
    message,
    metadata: {
      table: decision.table,
      declaredMode: decision.declaredMode,
      resolvedMode: decision.resolvedMode,
      source: decision.source,
      rowCount: decision.rowCount,
      rowLimit: decision.rowLimit,
      persisted: decision.persisted,
    },
  });
  logger?.warn(message);
}
