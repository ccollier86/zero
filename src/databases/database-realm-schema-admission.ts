/**
 * Pure schema admission rules specific to actor-backed database realms.
 *
 * ReactiveDB's general TableSchema surface is intentionally broader than the
 * Fabric actor protocol. A realm must additionally guarantee that every row
 * can cross the canonical JSON value boundary and that ReactiveDB can write
 * every declared column while producing one matching tracked change.
 */

import {
  databaseColumnDefinitionAffinity,
  type DatabaseDeclaredColumnAffinity,
} from '../sync/row-identity';
import type { TableSchema } from '../sync/types';

const ZERO_RESERVED_TABLE_NAMES = new Set([
  '_changes',
  '_change_sequence',
  '_migrations',
]);

interface RealmColumnAdmissionInput {
  readonly table: string;
  readonly column: string;
  readonly definition: string;
  readonly primaryKey: boolean;
}

/** Return a configuration error for a table name owned by SQLite or Zero. */
export function databaseRealmTableNameAdmissionIssue(
  table: string,
): string | null {
  const folded = foldAscii(table);
  if (folded.startsWith('SQLITE_')
    || folded.startsWith('_ZERO_')
    || folded.startsWith('IDX_ZERO_')
    || ZERO_RESERVED_TABLE_NAMES.has(folded.toLowerCase())) {
    return `Database realm table name "${table}" is reserved by SQLite or Zero.`;
  }
  return null;
}

/**
 * Return a configuration error for a column which a Fabric writer can never
 * admit. General SQLite syntax compilation remains a runtime responsibility.
 */
export function databaseRealmColumnAdmissionIssue(
  input: RealmColumnAdmissionInput,
): string | null {
  const words = scanTopLevelWords(input.definition);
  // Both the long `GENERATED ALWAYS AS (...)` and shorthand `AS (...)`
  // grammar require a top-level AS token. GENERATED alone can legally be a
  // declared-type word or an unquoted constraint name, so it is not enough.
  if (words.includes('AS')) {
    return `Database realm table "${input.table}" column "${input.column}" `
      + 'must be a normal writable column; generated columns are not supported.';
  }
  if (declaresMutatingForeignKeyAction(words)) {
    return `Database realm table "${input.table}" column "${input.column}" `
      + 'uses a mutating foreign-key action; use explicit tracked transaction writes.';
  }
  if (!input.primaryKey) {
    const affinity = databaseColumnDefinitionAffinity(input.definition);
    if (!isPortableDatabaseRealmValueAffinity(affinity)) {
      return `Database realm table "${input.table}" column "${input.column}" `
        + `has ${affinity} affinity; Fabric realm values require TEXT, INTEGER, `
        + 'REAL, or NUMERIC affinity.';
    }
  }
  return null;
}

/**
 * Detect deterministic collisions between generated natural-identity indexes,
 * realm tables, and platform-owned SQLite object namespaces.
 */
export function databaseRealmRegistryAdmissionIssue(
  tables: Readonly<Record<string, Readonly<TableSchema>>>,
): string | null {
  const tableNames = new Map(
    Object.keys(tables).map((table) => [foldAscii(table), table]),
  );
  for (const [table, schema] of Object.entries(tables)) {
    if (!Array.isArray(schema._identity) || schema._identity.length === 0) continue;
    const indexName = `idx_${table}_identity`;
    const collidingTable = tableNames.get(foldAscii(indexName));
    if (collidingTable) {
      return `Database realm table "${collidingTable}" collides with the generated `
        + `identity index for table "${table}".`;
    }
    if (databaseRealmTableNameAdmissionIssue(indexName)) {
      return `Database realm table "${table}" generates reserved SQLite object `
        + `name "${indexName}".`;
    }
  }
  return null;
}

/** Return true for SQLite affinities supported by Fabric's actor value plane. */
export function isPortableDatabaseRealmValueAffinity(
  affinity: DatabaseDeclaredColumnAffinity,
): boolean {
  // BLOB values and unconstrained typeless storage cannot cross durable JSON
  // receipts or the canonical DatabaseSerializableValue actor boundary.
  return affinity !== 'BLOB' && affinity !== 'TYPELESS';
}

function declaresMutatingForeignKeyAction(words: readonly string[]): boolean {
  let sawReferences = false;
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] === 'REFERENCES') {
      sawReferences = true;
      continue;
    }
    if (!sawReferences
      || words[index] !== 'ON'
      || (words[index + 1] !== 'DELETE' && words[index + 1] !== 'UPDATE')) {
      continue;
    }
    const action = words[index + 2];
    if (action === 'CASCADE') return true;
    if (action === 'SET'
      && (words[index + 3] === 'NULL' || words[index + 3] === 'DEFAULT')) {
      return true;
    }
  }
  return false;
}

/** Read only bare top-level SQLite tokens; quoted/nested content is data. */
function scanTopLevelWords(sql: string): readonly string[] {
  const words: string[] = [];
  let depth = 0;
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (sql.startsWith('/*', index)) {
      index = skipBlockComment(sql, index + 2);
      continue;
    }

    const character = sql[index];
    if (isQuoteOpener(character)) {
      index = skipQuotedValue(sql, index, character);
      continue;
    }
    if (character === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 && isSqliteIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && isSqliteIdentifierContinue(sql[index])) {
        index += 1;
      }
      words.push(foldAscii(sql.slice(start, index)));
      continue;
    }
    index += 1;
  }

  return words;
}

function skipQuotedValue(sql: string, start: number, opener: string): number {
  const closer = opener === '[' ? ']' : opener;
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== closer) {
      index += 1;
      continue;
    }
    if (opener !== '[' && sql[index + 1] === closer) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return sql.length;
}

function skipLineComment(sql: string, start: number): number {
  let index = start;
  // SQLite ends a -- comment at LF. A bare CR remains comment content.
  while (index < sql.length && sql[index] !== '\n') index += 1;
  return index;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf('*/', start);
  return end === -1 ? sql.length : end + 2;
}

function isQuoteOpener(
  character: string | undefined,
): character is "'" | '"' | '`' | '[' {
  return character === "'" || character === '"' || character === '`' || character === '[';
}

function isSqliteIdentifierStart(character: string | undefined): boolean {
  if (!character) return false;
  const codePoint = character.codePointAt(0) ?? 0;
  return character === '_'
    || (codePoint >= 65 && codePoint <= 90)
    || (codePoint >= 97 && codePoint <= 122)
    || (codePoint >= 0x80 && codePoint !== 0xfeff);
}

function isSqliteIdentifierContinue(character: string | undefined): boolean {
  if (!character) return false;
  const codePoint = character.codePointAt(0) ?? 0;
  return isSqliteIdentifierStart(character)
    || character === '$'
    || (codePoint >= 48 && codePoint <= 57);
}

/** Match SQLite's ASCII-only keyword/name folding. */
function foldAscii(value: string): string {
  let folded = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    folded += codePoint >= 97 && codePoint <= 122
      ? String.fromCodePoint(codePoint - 32)
      : character;
  }
  return folded;
}
