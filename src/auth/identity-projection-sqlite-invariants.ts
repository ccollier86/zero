import { identityProjectionError } from './identity-projection-error';

/** Read-only SQLite surface used by managed identity-projection admission. */
export interface IdentityProjectionSchemaReader {
  prepare(sql: string): {
    all(): unknown;
    finalize?(): void;
  };
}

export interface ManagedProjectionColumn {
  readonly name: string;
  readonly type: string;
  readonly pk: number;
  readonly notnull: number;
  readonly dflt_value: string | null;
}

export function managedProjectionColumn(
  name: string,
  type: string,
  pk: number,
  required = false,
  defaultValue: string | null = null,
): ManagedProjectionColumn {
  return { name, type, pk, notnull: required ? 1 : 0, dflt_value: defaultValue };
}

export function assertExactManagedColumns(
  db: IdentityProjectionSchemaReader,
  table: string,
  expected: readonly ManagedProjectionColumn[],
): void {
  const rows = queryRows<ManagedProjectionColumn>(
    db,
    `PRAGMA table_info("${escapeIdentifier(table)}")`,
  );
  const matches = rows.length === expected.length && rows.every((row, index) => {
    const wanted = expected[index]!;
    return row.name === wanted.name
      && row.type.toUpperCase() === wanted.type
      && row.pk === wanted.pk
      && row.notnull === wanted.notnull
      && normalizedDefault(row.dflt_value) === normalizedDefault(wanted.dflt_value);
  });
  if (!matches) invalidSchema();
}

/** Require the complete CHECK-expression multiset, not merely a matching label. */
export function assertExactManagedChecks(
  db: IdentityProjectionSchemaReader,
  table: string,
  expected: readonly string[],
): void {
  const rows = queryRows<{ sql?: unknown }>(
    db,
    `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = '${escapeLiteral(table)}'`,
  );
  if (rows.length !== 1 || typeof rows[0]?.sql !== 'string') invalidSchema();
  const actualChecks = extractCheckExpressions(rows[0]!.sql as string)
    .map(canonicalizeExpression)
    .sort();
  const expectedChecks = expected.map(canonicalizeExpression).sort();
  if (actualChecks.length !== expectedChecks.length
    || actualChecks.some((value, index) => value !== expectedChecks[index])) {
    invalidSchema();
  }
}

export function assertExactManagedIndex(
  db: IdentityProjectionSchemaReader,
  table: string,
  name: string,
  expectedColumns: readonly string[],
): void {
  const indexes = queryRows<SQLiteIndexListRow>(
    db,
    `PRAGMA index_list("${escapeIdentifier(table)}")`,
  );
  const index = indexes.find((candidate) => candidate.name === name);
  if (!index
    || index.unique !== 0
    || index.origin !== 'c'
    || index.partial !== 0
    || !indexColumnsMatch(db, index.name, expectedColumns)) {
    invalidSchema();
  }
}

export function assertManagedUniqueColumns(
  db: IdentityProjectionSchemaReader,
  table: string,
  expected: readonly string[],
): void {
  const indexes = queryRows<SQLiteIndexListRow>(
    db,
    `PRAGMA index_list("${escapeIdentifier(table)}")`,
  );
  const present = indexes.some((index) => index.unique === 1
    && index.partial === 0
    && indexColumnsMatch(db, index.name, expected));
  if (!present) invalidSchema();
}

export function assertExactManagedForeignKey(
  db: IdentityProjectionSchemaReader,
  table: string,
  expected: Readonly<{
    table: string;
    from: string;
    to: string;
    onDelete: string;
  }>,
): void {
  const rows = queryRows<SQLiteForeignKeyRow>(
    db,
    `PRAGMA foreign_key_list("${escapeIdentifier(table)}")`,
  );
  const candidates = rows.filter((row) => row.from === expected.from);
  const present = rows.length === 1
    && candidates.length === 1
    && candidates.some((row) => (
      row.table === expected.table
      && row.to === expected.to
      && row.seq === 0
      && rows.filter((candidate) => candidate.id === row.id).length === 1
      && row.on_update.toUpperCase() === 'NO ACTION'
      && row.on_delete.toUpperCase() === expected.onDelete
      && row.match.toUpperCase() === 'NONE'
    ));
  if (!present) invalidSchema();
}

interface SQLiteIndexListRow {
  readonly name: string;
  readonly unique: number;
  readonly origin: string;
  readonly partial: number;
}

interface SQLiteIndexXInfoRow {
  readonly seqno: number;
  readonly name: string | null;
  readonly desc: number;
  readonly coll: string;
  readonly key: number;
}

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

function indexColumnsMatch(
  db: IdentityProjectionSchemaReader,
  index: string,
  expected: readonly string[],
): boolean {
  const keyRows = queryRows<SQLiteIndexXInfoRow>(
    db,
    `PRAGMA index_xinfo("${escapeIdentifier(index)}")`,
  )
    .filter((row) => row.key === 1)
    .sort((left, right) => left.seqno - right.seqno);
  return keyRows.length === expected.length
    && keyRows.every((row, offset) => row.name === expected[offset]
      && row.desc === 0
      && row.coll.toUpperCase() === 'BINARY');
}

function queryRows<TRow>(
  db: IdentityProjectionSchemaReader,
  sql: string,
): TRow[] {
  const statement = db.prepare(sql);
  try {
    return statement.all() as TRow[];
  } finally {
    statement.finalize?.();
  }
}

function normalizedDefault(value: string | null): string | null {
  if (value === null) return null;
  let normalized = value.trim();
  while (hasSingleOuterParentheses(normalized)) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function extractCheckExpressions(sql: string): string[] {
  const checks: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const skipped = skipQuotedOrComment(sql, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    if (!isWordStart(sql[index])) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (isWordPart(sql[index])) index += 1;
    if (sql.slice(start, index).toLowerCase() !== 'check') continue;
    while (/\s/u.test(sql[index] ?? '')) index += 1;
    if (sql[index] !== '(') invalidSchema();
    const expressionStart = index + 1;
    let depth = 1;
    index += 1;
    while (index < sql.length && depth > 0) {
      const nestedSkip = skipQuotedOrComment(sql, index);
      if (nestedSkip !== index) {
        index = nestedSkip;
        continue;
      }
      if (sql[index] === '(') depth += 1;
      if (sql[index] === ')') depth -= 1;
      index += 1;
    }
    if (depth !== 0) invalidSchema();
    checks.push(sql.slice(expressionStart, index - 1));
  }
  return checks;
}

function canonicalizeExpression(expression: string): string {
  let canonical = '';
  let index = 0;
  while (index < expression.length) {
    const character = expression[index]!;
    if (character === '\'' || character === '"' || character === '`') {
      const end = skipQuoted(expression, index, character);
      canonical += expression.slice(index, end);
      index = end;
      continue;
    }
    if (character === '[') {
      const end = skipBracketQuoted(expression, index);
      canonical += expression.slice(index, end);
      index = end;
      continue;
    }
    if (!/\s/u.test(character)) canonical += character.toLowerCase();
    index += 1;
  }
  return canonical;
}

function hasSingleOuterParentheses(value: string): boolean {
  if (value[0] !== '(' || value.at(-1) !== ')') return false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const skipped = skipQuotedOrComment(value, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function skipQuotedOrComment(value: string, index: number): number {
  const character = value[index];
  if (character === '\'' || character === '"' || character === '`') {
    return skipQuoted(value, index, character);
  }
  if (character === '[') return skipBracketQuoted(value, index);
  if (character === '-' && value[index + 1] === '-') {
    const newline = value.indexOf('\n', index + 2);
    return newline === -1 ? value.length : newline + 1;
  }
  if (character === '/' && value[index + 1] === '*') {
    const close = value.indexOf('*/', index + 2);
    return close === -1 ? value.length : close + 2;
  }
  return index;
}

function skipQuoted(value: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < value.length) {
    if (value[index] !== quote) {
      index += 1;
      continue;
    }
    if (value[index + 1] === quote) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return value.length;
}

function skipBracketQuoted(value: string, start: number): number {
  const close = value.indexOf(']', start + 1);
  return close === -1 ? value.length : close + 1;
}

function isWordStart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z_]/u.test(value);
}

function isWordPart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/u.test(value);
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""');
}

function escapeLiteral(value: string): string {
  return value.replaceAll('\'', '\'\'');
}

function invalidSchema(): never {
  throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
}
