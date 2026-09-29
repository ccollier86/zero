/** Shared canonical row identity and declared-affinity contracts. */

/** Maximum UTF-8 size of one canonical ReactiveDB row identity. */
export const REACTIVE_DB_ROW_ID_MAX_BYTES = 1_024;

/** SQLite affinity resolved from a declared column type. */
export type DatabaseDeclaredColumnAffinity =
  | 'INTEGER'
  | 'TEXT'
  | 'REAL'
  | 'BLOB'
  | 'NUMERIC'
  | 'TYPELESS';

const COLUMN_CONSTRAINT_STARTERS = new Set([
  'AS',
  'CHECK',
  'COLLATE',
  'CONSTRAINT',
  'DEFAULT',
  'GENERATED',
  'NOT',
  'NULL',
  'PRIMARY',
  'REFERENCES',
  'UNIQUE',
]);
const textEncoder = new TextEncoder();

/**
 * Canonicalize the primary-key values supported by ReactiveDB and its actor
 * protocols. SQLite INTEGER keys become strings at the managed boundary so
 * every consumer uses one stable row-id representation.
 */
export function canonicalDatabaseRowId(value: unknown): string | null {
  if (typeof value !== 'string'
    && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    return null;
  }
  const canonical = String(value);
  if (canonical.length === 0
    || canonical.length > REACTIVE_DB_ROW_ID_MAX_BYTES
    || !isWellFormedUnicode(canonical)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(canonical)
    || textEncoder.encode(canonical).byteLength > REACTIVE_DB_ROW_ID_MAX_BYTES) {
    return null;
  }
  return canonical;
}

/** Resolve SQLite affinity from the declared type returned by table metadata. */
export function databaseDeclaredTypeAffinity(
  declaredType: unknown,
): DatabaseDeclaredColumnAffinity {
  if (typeof declaredType !== 'string') return 'TYPELESS';
  const normalized = asciiUpper(declaredType.trim());
  if (normalized.length === 0) return 'TYPELESS';

  // Preserve SQLite's documented affinity precedence. For example,
  // "FLOATING POINT" has INTEGER affinity because POINT contains "INT".
  if (normalized.includes('INT')) return 'INTEGER';
  if (normalized.includes('CHAR')
    || normalized.includes('CLOB')
    || normalized.includes('TEXT')) return 'TEXT';
  if (normalized.includes('BLOB')) return 'BLOB';
  if (normalized.includes('REAL')
    || normalized.includes('FLOA')
    || normalized.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

/** Resolve affinity from one complete TableSchema column definition. */
export function databaseColumnDefinitionAffinity(
  definition: unknown,
): DatabaseDeclaredColumnAffinity {
  if (typeof definition !== 'string') return 'TYPELESS';
  const words = inspectDatabaseColumnDefinition(definition).affinityWords;
  return databaseDeclaredTypeAffinity(words.join(' '));
}

/** Return true for affinities with a lossless managed row-id mapping. */
export function isSupportedDatabaseRowIdentityAffinity(
  affinity: DatabaseDeclaredColumnAffinity,
): affinity is 'TEXT' | 'INTEGER' {
  return affinity === 'TEXT' || affinity === 'INTEGER';
}

/**
 * Return true only when one schema value remains inside its generated quoted
 * column slot. Top-level commas/table constraints, statement separators,
 * unbalanced grouping, and an unterminated line comment could otherwise alter
 * the surrounding CREATE TABLE statement.
 */
export function isIsolatedDatabaseColumnDefinition(
  definition: unknown,
): definition is string {
  return typeof definition === 'string'
    && inspectDatabaseColumnDefinition(definition).isolated;
}

/** Recognize an actual top-level PRIMARY KEY column constraint. */
export function databaseColumnDefinitionDeclaresPrimaryKey(
  definition: unknown,
): boolean {
  if (typeof definition !== 'string') return false;
  const inspection = inspectDatabaseColumnDefinition(definition);
  return inspection.isolated && inspection.constraintTokens.some((token, index) =>
    token === 'PRIMARY' && inspection.constraintTokens[index + 1] === 'KEY');
}

/** Recognize an actual top-level NOT NULL column constraint. */
export function databaseColumnDefinitionDeclaresNotNull(
  definition: unknown,
): boolean {
  if (typeof definition !== 'string') return false;
  const inspection = inspectDatabaseColumnDefinition(definition);
  return inspection.isolated && inspection.constraintTokens.some((token, index) =>
    token === 'NOT' && inspection.constraintTokens[index + 1] === 'NULL');
}

/** Recognize an actual top-level DEFAULT column constraint. */
export function databaseColumnDefinitionDeclaresDefault(
  definition: unknown,
): boolean {
  if (typeof definition !== 'string') return false;
  const inspection = inspectDatabaseColumnDefinition(definition);
  return inspection.isolated
    && inspection.constraintTokens.some((token, index) =>
      token === 'DEFAULT' && inspection.constraintTokens[index - 1] !== 'SET');
}

interface DatabaseColumnDefinitionInspection {
  readonly affinityWords: string[];
  readonly constraintTokens: string[];
  readonly isolated: boolean;
}

function inspectDatabaseColumnDefinition(
  sql: string,
): DatabaseColumnDefinitionInspection {
  const affinityWords: string[] = [];
  const constraintTokens: string[] = [];
  let word = '';
  let depth = 0;
  let isolated = sql.length > 0 && !sql.includes('\0');
  let constraintStarted = false;
  let typeTokenCount = 0;
  let sawQuotedType = false;

  const flush = () => {
    if (word.length === 0) return;
    const normalized = asciiUpper(word);
    constraintTokens.push(normalized);
    if (!constraintStarted && COLUMN_CONSTRAINT_STARTERS.has(normalized)) {
      constraintStarted = true;
    } else if (!constraintStarted) {
      typeTokenCount += 1;
      if (sawQuotedType) {
        // SQLite may treat a leading quoted token as the complete declared
        // type while accepting later bare words. Reject that ambiguous form.
        isolated = false;
      } else {
        affinityWords.push(normalized);
      }
    }
    word = '';
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      flush();
      index += 2;
      // SQLite's tokenizer ends a line comment at LF, not at a bare CR.
      // Treating CR as a terminator would recognize constraints which SQLite
      // still considers commented out.
      while (index < sql.length && sql[index] !== '\n') index += 1;
      if (index >= sql.length) isolated = false;
      continue;
    }
    if (char === '/' && next === '*') {
      flush();
      index += 2;
      while (index < sql.length
        && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1;
      if (index >= sql.length) {
        isolated = false;
        break;
      }
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      flush();
      const closing = char === '[' ? ']' : char;
      const quoted = readQuotedSqlToken(sql, index, closing);
      if (depth === 0 && !constraintStarted) {
        typeTokenCount += 1;
        if (quoted.value.length === 0 || typeTokenCount > 1) isolated = false;
        sawQuotedType = true;
        // One quoted declared-type token is supported. Quoted content can
        // never introduce a PRIMARY KEY / NOT NULL constraint token.
        affinityWords.push(asciiUpper(quoted.value));
      }
      index = quoted.end;
      if (!quoted.closed) isolated = false;
      continue;
    }
    if (char === '(') {
      flush();
      depth += 1;
      continue;
    }
    if (char === ')') {
      flush();
      if (depth === 0) isolated = false;
      else depth -= 1;
      continue;
    }
    if (depth === 0 && (char === ',' || char === ';')) {
      flush();
      isolated = false;
      continue;
    }
    if (depth === 0 && char === '\ufeff' && word.length === 0) {
      // SQLite treats a BOM at a token boundary as whitespace, but retains it
      // when it appears inside an identifier.
      continue;
    }
    if (depth === 0
      && (/[A-Za-z0-9_$]/u.test(char) || char.charCodeAt(0) >= 0x80)) {
      // SQLite's tokenizer includes every U+0080+ code point in identifiers.
      // Splitting there could invent a constraint boundary SQLite does not see.
      word += char;
      continue;
    }
    flush();
  }
  flush();
  if (depth !== 0) isolated = false;
  return { affinityWords, constraintTokens, isolated };
}

function readQuotedSqlToken(
  sql: string,
  start: number,
  closing: "'" | '"' | '`' | ']',
): { value: string; end: number; closed: boolean } {
  let value = '';
  for (let index = start + 1; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (char !== closing) {
      value += char;
      continue;
    }
    if (sql[index + 1] === closing) {
      value += closing;
      index += 1;
      continue;
    }
    return { value, end: index, closed: true };
  }
  return { value, end: sql.length - 1, closed: false };
}

function isWellFormedUnicode(value: string): boolean {
  const candidate = value as string & { isWellFormed?: () => boolean };
  if (typeof candidate.isWellFormed === 'function') return candidate.isWellFormed();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Match SQLite's ASCII-only keyword and declared-type case folding. */
function asciiUpper(value: string): string {
  return value.replace(/[a-z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x20));
}
