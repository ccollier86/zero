/**
 * types.ts
 *
 * Shared migration subsystem contracts. Runtime behavior lives in focused
 * modules such as migrator, ledger, schema inspection, and planning.
 */

import type { Database } from 'bun:sqlite';
import type { TableSchema } from '../sync/types';

/** Safety classification used by migrate, doctor, and plan tooling. */
export type MigrationSafety = 'safe' | 'guarded' | 'destructive' | 'manual';

/** Direction recorded for each migration ledger event. */
export type MigrationDirection = 'up' | 'down';

/** Append-only status recorded for migration events. */
export type MigrationEventStatus = 'applied' | 'rolled_back' | 'failed';

export interface Migration {
  /** Unique version identifier, e.g. "001", "2026_06_28_001_add_rooms". */
  version: string;
  /** Human-readable description. */
  description: string;
  /** Safety of the forward migration. Defaults to safe. */
  safety?: MigrationSafety;
  /** Safety of the rollback migration. Defaults to destructive unless set. */
  downSafety?: MigrationSafety;
  /** Require a backup before applying this migration. */
  backupRequired?: boolean;
  /** Forward migration; receives the raw Database handle. */
  up: (db: Database) => void;
  /** Optional rollback. Required for migrate:down over this migration. */
  down?: (db: Database) => void;
}

export interface MigrationLedgerRecord {
  id: number;
  version: string;
  description: string;
  checksum: string;
  safety: MigrationSafety;
  direction: MigrationDirection;
  batch: number;
  status: MigrationEventStatus;
  applied_at: string;
  duration_ms: number;
  error: string | null;
  schema_hash: string | null;
}

export interface MigrationStatus {
  version: string;
  description: string;
  applied: boolean;
  appliedAt: string | null;
  durationMs: number | null;
  safety: MigrationSafety;
  checksum: string;
  storedChecksum: string | null;
  checksumMatches: boolean | null;
  hasDown: boolean;
  lastStatus: MigrationEventStatus | null;
}

export interface MigratorConfig {
  /** Path to the SQLite database file. */
  dbPath: string;
  /** Ordered list of migrations to apply. */
  migrations: Migration[];
  /** Apply WAL pragmas before running. Default: true. */
  applyPragmas?: boolean;
  /** Allow forward destructive migrations. Default: false. */
  allowDestructive?: boolean;
  /** Allow destructive rollback migrations. Default: false. */
  allowDestructiveDown?: boolean;
  /** Directory for backup artifacts. */
  backupDir?: string;
  /** Create backups for migrations that require them. Default: true for file DBs. */
  createBackups?: boolean;
  /** Log output. Default: platform observability sink. */
  log?: (...args: unknown[]) => void;
}

export interface SchemaColumnSnapshot {
  name: string;
  definition: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
}

export interface SchemaIndexSnapshot {
  name: string;
  columns: string[];
  unique: boolean;
  origin?: string;
  partial?: boolean;
}

export interface SchemaTableSnapshot {
  name: string;
  columns: Record<string, SchemaColumnSnapshot>;
  columnOrder: string[];
  primaryKey: string | null;
  compositePrimaryKey: string[];
  identity: string[];
  indexes: Record<string, SchemaIndexSnapshot>;
  createSql?: string;
}

export interface SchemaSnapshot {
  tables: Record<string, SchemaTableSnapshot>;
}

export type SchemaDiffSeverity = 'info' | 'warning' | 'error';

export type SchemaDiffKind =
  | 'missing-table'
  | 'extra-table'
  | 'missing-column'
  | 'extra-column'
  | 'changed-column'
  | 'primary-key-mismatch'
  | 'composite-primary-key'
  | 'missing-identity-index'
  | 'identity-mismatch';

export interface SchemaDiffIssue {
  kind: SchemaDiffKind;
  severity: SchemaDiffSeverity;
  message: string;
  table?: string;
  column?: string;
  index?: string;
  expected?: unknown;
  actual?: unknown;
  safety: MigrationSafety;
}

export interface MigrationPlanStatement {
  sql: string;
  safety: MigrationSafety;
  reason: string;
}

export interface MigrationPlan {
  issues: SchemaDiffIssue[];
  statements: MigrationPlanStatement[];
  safety: MigrationSafety;
  needsManualReview: boolean;
}

export type DeclaredTables = Record<string, TableSchema>;
