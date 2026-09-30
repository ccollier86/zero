/**
 * guardian-references.ts
 *
 * Declarative identity-reference metadata shared by the schema DSL and the
 * server-owned identity projection boundary. The metadata describes storage
 * dependencies only; it is never an authorization source.
 */

import type { TableSchema } from '../sync/types';

/** Guardian identity anchor selected by a declarative field reference. */
export type GuardianReferenceKind = 'user' | 'membership';

/** Stable Guardian anchor target emitted by one field builder. */
export interface GuardianReferenceDefinition {
  readonly kind: GuardianReferenceKind;
  readonly table: 'users' | 'tenant_memberships';
  readonly column: 'user_id' | 'membership_id';
  readonly onDelete: 'restrict';
}

/** Named field reference attached to a server table schema. */
export interface GuardianFieldReference extends GuardianReferenceDefinition {
  readonly field: string;
}

/**
 * Non-enumerable metadata carried by server table definitions.
 *
 * `anchorRequirements` deliberately includes `user` for membership fields:
 * the canonical membership anchor itself references the canonical user
 * anchor. Consumers therefore do not need to duplicate that dependency rule.
 */
export interface GuardianTableReferenceMetadata {
  readonly fields: readonly GuardianFieldReference[];
  readonly anchorRequirements: readonly GuardianReferenceKind[];
}

/** Stable, private-data-free reason a Guardian reference declaration is unusable. */
export type GuardianReferenceSchemaIssueCode =
  | 'duplicate-reference'
  | 'missing-column'
  | 'invalid-column-definition'
  | 'missing-foreign-key'
  | 'invalid-foreign-key';

/** One exact declaration/storage mismatch safe to surface in config diagnostics. */
export interface GuardianReferenceSchemaIssue {
  readonly code: GuardianReferenceSchemaIssueCode;
  readonly field: string;
  readonly kind: GuardianReferenceKind;
}

/** Minimal SQLite/ReactiveDB shape needed for read-only FK inspection. */
export interface GuardianReferenceSchemaReader {
  prepare(sql: string): {
    all(...params: unknown[]): unknown;
    finalize?(): void;
  };
}

/** Optional installed-table boundary for the same exact admission pass. */
export interface GuardianReferenceStorageInspection {
  readonly database: GuardianReferenceSchemaReader;
  readonly tableName: string;
}

/** Stable cross-package symbol used by Fabric/runtime integration. */
export const GUARDIAN_TABLE_REFERENCES: unique symbol = Symbol.for(
  '@zero/schema/guardian-table-references',
) as typeof GUARDIAN_TABLE_REFERENCES;

const EMPTY_REFERENCES = Object.freeze([]) as readonly GuardianFieldReference[];
const EMPTY_REQUIREMENTS = Object.freeze([]) as readonly GuardianReferenceKind[];

export const GUARDIAN_USER_REFERENCE: GuardianReferenceDefinition = Object.freeze({
  kind: 'user',
  table: 'users',
  column: 'user_id',
  onDelete: 'restrict',
});

export const GUARDIAN_MEMBERSHIP_REFERENCE: GuardianReferenceDefinition = Object.freeze({
  kind: 'membership',
  table: 'tenant_memberships',
  column: 'membership_id',
  onDelete: 'restrict',
});

type GuardianAwareTableSchema = TableSchema & {
  readonly [GUARDIAN_TABLE_REFERENCES]?: GuardianTableReferenceMetadata;
};

/** Attach immutable, non-enumerable Guardian metadata to a server table. */
export function attachGuardianTableReferences(
  table: TableSchema,
  references: readonly GuardianFieldReference[],
): void {
  if (references.length === 0) return;

  const fields = Object.freeze(references.map((reference) => Object.freeze({ ...reference })));
  const needsMembership = fields.some((reference) => reference.kind === 'membership');
  const needsUser = needsMembership || fields.some((reference) => reference.kind === 'user');
  const anchorRequirements = Object.freeze([
    ...(needsUser ? ['user' as const] : []),
    ...(needsMembership ? ['membership' as const] : []),
  ]);
  const metadata: GuardianTableReferenceMetadata = Object.freeze({
    fields,
    anchorRequirements,
  });

  Object.defineProperty(table, GUARDIAN_TABLE_REFERENCES, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: metadata,
  });
}

/** Return declarative Guardian field references for a server table. */
export function getGuardianTableReferences(
  table: TableSchema,
): readonly GuardianFieldReference[] {
  return (table as GuardianAwareTableSchema)[GUARDIAN_TABLE_REFERENCES]?.fields
    ?? EMPTY_REFERENCES;
}

/** Return the complete anchor set a server table requires. */
export function getGuardianAnchorRequirements(
  table: TableSchema,
): readonly GuardianReferenceKind[] {
  return (table as GuardianAwareTableSchema)[GUARDIAN_TABLE_REFERENCES]
    ?.anchorRequirements ?? EMPTY_REQUIREMENTS;
}

/** True when a server table declares at least one Guardian identity reference. */
export function hasGuardianTableReferences(table: TableSchema): boolean {
  return getGuardianTableReferences(table).length > 0;
}

/**
 * Verify that immutable Guardian metadata still describes the exact SQL column
 * emitted by the schema DSL. Metadata and SQL deliberately travel together;
 * accepting one after the other is mutated would silently disable the promised
 * local referential-integrity boundary.
 */
export function inspectGuardianReferenceSchema(
  table: TableSchema,
  storage?: GuardianReferenceStorageInspection,
): readonly GuardianReferenceSchemaIssue[] {
  const issues: GuardianReferenceSchemaIssue[] = [];
  const seen = new Set<string>();
  for (const reference of getGuardianTableReferences(table)) {
    const key = `${reference.field}\0${reference.kind}`;
    if (seen.has(key)) {
      issues.push(issue(reference, 'duplicate-reference'));
      continue;
    }
    seen.add(key);

    const definition = table[reference.field];
    if (definition === undefined) {
      issues.push(issue(reference, 'missing-column'));
      continue;
    }
    if (typeof definition !== 'string'
      || !guardianColumnDeclarationMatches(reference, definition)) {
      issues.push(issue(reference, 'invalid-column-definition'));
    }
  }
  if (storage) {
    issues.push(...inspectGuardianReferenceSQLiteForeignKeys(
      storage.database,
      storage.tableName,
      table,
    ));
  }
  return Object.freeze(issues);
}

/**
 * Verify the installed SQLite foreign key for every Guardian metadata entry.
 * This catches `CREATE TABLE IF NOT EXISTS` drift that declaration validation
 * alone cannot see on an existing application or actor database.
 */
function inspectGuardianReferenceSQLiteForeignKeys(
  database: GuardianReferenceSchemaReader,
  tableName: string,
  table: TableSchema,
): readonly GuardianReferenceSchemaIssue[] {
  const references = getGuardianTableReferences(table);
  if (references.length === 0) return EMPTY_SCHEMA_ISSUES;

  const statement = database.prepare(
    `PRAGMA foreign_key_list("${escapeSQLiteIdentifier(tableName)}")`,
  );
  let rows: SQLiteForeignKeyRow[];
  try {
    rows = statement.all() as SQLiteForeignKeyRow[];
  } finally {
    statement.finalize?.();
  }

  const issues: GuardianReferenceSchemaIssue[] = [];
  for (const reference of references) {
    const fieldRows = rows.filter((row) => row.from === reference.field);
    if (fieldRows.length === 0) {
      issues.push(issue(reference, 'missing-foreign-key'));
      continue;
    }
    if (fieldRows.length !== 1
      || !sqliteForeignKeyMatches(reference, fieldRows[0]!, rows)) {
      issues.push(issue(reference, 'invalid-foreign-key'));
    }
  }
  return Object.freeze(issues);
}

const EMPTY_SCHEMA_ISSUES = Object.freeze([]) as readonly GuardianReferenceSchemaIssue[];

interface SQLiteForeignKeyRow {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string;
  readonly on_update: string;
  readonly on_delete: string;
  readonly match: string;
}

function guardianColumnDeclarationMatches(
  reference: GuardianFieldReference,
  definition: string,
): boolean {
  const normalized = definition.trim().replace(/\s+/gu, ' ').toLowerCase();
  const expected = `text references ${reference.table}(${reference.column}) on delete ${reference.onDelete}`;
  return normalized === expected || normalized === `${expected} not null`;
}

function sqliteForeignKeyMatches(
  reference: GuardianFieldReference,
  row: SQLiteForeignKeyRow,
  rows: readonly SQLiteForeignKeyRow[],
): boolean {
  return row.table === reference.table
    && row.from === reference.field
    && row.to === reference.column
    && row.seq === 0
    && rows.filter((candidate) => candidate.id === row.id).length === 1
    && row.on_update.toLowerCase() === 'no action'
    && row.on_delete.toLowerCase() === reference.onDelete
    && row.match.toLowerCase() === 'none';
}

function issue(
  reference: GuardianFieldReference,
  code: GuardianReferenceSchemaIssueCode,
): GuardianReferenceSchemaIssue {
  return Object.freeze({ code, field: reference.field, kind: reference.kind });
}

function escapeSQLiteIdentifier(value: string): string {
  return value.replaceAll('"', '""');
}
