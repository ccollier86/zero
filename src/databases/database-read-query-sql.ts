/** SQL admission grammar for registered read-query capabilities. */

import { DatabaseError } from './database-error';

const DATABASE_READ_QUERY_MAX_SQL_BYTES = 65_536;
const DANGEROUS_READ_FUNCTIONS = new Set([
  'eval',
  'load_extension',
  'readfile',
  'writefile',
]);
const TOP_LEVEL_STATEMENT_WORDS = new Set([
  'alter',
  'analyze',
  'attach',
  'begin',
  'commit',
  'create',
  'delete',
  'detach',
  'drop',
  'insert',
  'pragma',
  'reindex',
  'release',
  'replace',
  'rollback',
  'savepoint',
  'select',
  'update',
  'vacuum',
]);
const textEncoder = new TextEncoder();

interface SqlWord {
  readonly value: string;
  readonly depth: number;
}

/** Reject every SQL shape outside the registered read-only contract. */
export function assertDatabaseReadQuerySql(sql: unknown): asserts sql is string {
  if (typeof sql !== 'string'
    || sql.length === 0
    || textEncoder.encode(sql).byteLength > DATABASE_READ_QUERY_MAX_SQL_BYTES
    || sql.includes('\0')) {
    throw invalidReadQuerySql();
  }
  const words = scanSqlWords(sql);
  if (words.length === 0) throw invalidReadQuerySql();
  const first = words[0]!;
  if (first.depth !== 0 || (first.value !== 'select' && first.value !== 'with')) {
    throw invalidReadQuerySql();
  }
  if (first.value === 'with') {
    const mainStatement = words.find((word, index) =>
      index > 0
      && word.depth === 0
      && TOP_LEVEL_STATEMENT_WORDS.has(word.value));
    if (mainStatement?.value !== 'select') throw invalidReadQuerySql();
  }
}

function scanSqlWords(sql: string): readonly SqlWord[] {
  const words: SqlWord[] = [];
  let depth = 0;
  for (let index = 0; index < sql.length;) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (char === ';' || (char === '-' && next === '-')
      || (char === '/' && next === '*') || (char === '*' && next === '/')) {
      throw invalidReadQuerySql();
    }
    // SQLite treats a BOM at a token boundary as whitespace, while the same
    // code point inside an identifier remains part of that identifier.
    if (char === '\ufeff') {
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const end = skipQuotedSql(sql, index, char);
      const token = decodeQuotedSqlToken(sql, index, end, char);
      // SQLite may reinterpret single-quoted text as an identifier in table
      // positions. Reserve the whole pragma_* spelling across quote styles.
      if (token.startsWith('pragma_')
        || (DANGEROUS_READ_FUNCTIONS.has(token)
          && nextNonWhitespaceCharacter(sql, end) === '(')) {
        throw invalidReadQuerySql();
      }
      index = end;
      continue;
    }
    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth < 0) throw invalidReadQuerySql();
      index += 1;
      continue;
    }
    if (isSqlIdentifierStart(char)) {
      let end = index + 1;
      while (end < sql.length && isSqlIdentifierContinue(sql[end]!)) end += 1;
      const value = asciiLower(sql.slice(index, end));
      if (value.startsWith('pragma_')
        || (DANGEROUS_READ_FUNCTIONS.has(value)
          && nextNonWhitespaceCharacter(sql, end) === '(')) {
        throw invalidReadQuerySql();
      }
      words.push({ value, depth });
      index = end;
      continue;
    }
    index += 1;
  }
  if (depth !== 0) throw invalidReadQuerySql();
  return words;
}

function skipQuotedSql(
  sql: string,
  start: number,
  opener: "'" | '"' | '`' | '[',
): number {
  const closer = opener === '[' ? ']' : opener;
  for (let index = start + 1; index < sql.length; index += 1) {
    if (sql[index] !== closer) continue;
    if (sql[index + 1] === closer) {
      index += 1;
      continue;
    }
    return index + 1;
  }
  throw invalidReadQuerySql();
}

function decodeQuotedSqlToken(
  sql: string,
  start: number,
  end: number,
  opener: "'" | '"' | '`' | '[',
): string {
  const closer = opener === '[' ? ']' : opener;
  const escapedCloser = `${closer}${closer}`;
  return asciiLower(sql.slice(start + 1, end - 1)
    .split(escapedCloser)
    .join(closer));
}

function nextNonWhitespaceCharacter(sql: string, start: number): string | null {
  for (let index = start; index < sql.length; index += 1) {
    if (!/\s/u.test(sql[index]!)) return sql[index]!;
  }
  return null;
}

function isSqlIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/u.test(char) || char.charCodeAt(0) >= 0x80;
}

function isSqlIdentifierContinue(char: string): boolean {
  return /[A-Za-z0-9_$]/u.test(char) || char.charCodeAt(0) >= 0x80;
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0x20));
}

function invalidReadQuerySql(): DatabaseError {
  return new DatabaseError(
    'DATABASE_OPERATION_UNSUPPORTED',
    'Database registered queries accept one read-only SELECT statement.',
    { retryable: false, outcome: null },
  );
}
