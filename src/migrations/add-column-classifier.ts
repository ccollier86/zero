import {
  databaseColumnDefinitionDeclaresNotNull,
  databaseColumnDefinitionDeclaresPrimaryKey,
  isIsolatedDatabaseColumnDefinition,
} from '../sync/row-identity';
import {
  inspectDeclaredColumnDefault,
  type DeclaredColumnDefaultKind,
} from './column-default-parser';
import type { MigrationSafety } from './types';

type AddColumnSafety = Extract<MigrationSafety, 'safe' | 'guarded'>;

export type AddColumnDefaultKind = DeclaredColumnDefaultKind;

export interface AddColumnClassification {
  /** Whether the planner may emit this definition as a direct ADD COLUMN. */
  readonly emit: boolean;
  readonly safety: AddColumnSafety;
  readonly defaultKind: AddColumnDefaultKind;
}

interface TopLevelSqlScan {
  readonly words: readonly string[];
  readonly hasLineComment: boolean;
}

const OMITTED_ADD_COLUMN = Object.freeze({
  emit: false,
  safety: 'guarded',
} as const);

/**
 * Classify a column definition for SQLite's direct ALTER TABLE ... ADD COLUMN
 * path. Definitions that SQLite rejects, or which Fabric cannot represent as a
 * normal realm column, are deliberately omitted for a future rebuild workflow.
 */
export function classifyAddColumnDefinition(definition: string): AddColumnClassification {
  if (!isIsolatedDatabaseColumnDefinition(definition)) {
    return withDefaultKind(OMITTED_ADD_COLUMN, 'invalid');
  }

  const scan = scanTopLevelSql(definition);
  const defaultKind = inspectDeclaredColumnDefault(definition).kind;
  const wordValues = new Set(scan.words);
  // Every SQLite generated-column form has a top-level AS expression. The
  // non-reserved word GENERATED is also valid in ordinary type names,
  // constraint names, referenced table names, and bare literal defaults.
  const generated = wordValues.has('AS');
  const primaryKey = databaseColumnDefinitionDeclaresPrimaryKey(definition);
  const unique = wordValues.has('UNIQUE');
  const autoincrement = wordValues.has('AUTOINCREMENT');
  const notNull = databaseColumnDefinitionDeclaresNotNull(definition);
  const references = wordValues.has('REFERENCES');

  if (
    generated ||
    scan.hasLineComment ||
    primaryKey ||
    unique ||
    autoincrement ||
    defaultKind === 'invalid' ||
    defaultKind === 'parenthesized' ||
    defaultKind === 'current-time' ||
    defaultKind === 'current-date' ||
    defaultKind === 'current-timestamp' ||
    (notNull && (defaultKind === 'absent' || defaultKind === 'null')) ||
    (references && defaultKind !== 'absent' && defaultKind !== 'null')
  ) {
    return withDefaultKind(OMITTED_ADD_COLUMN, defaultKind);
  }

  const guarded = notNull || wordValues.has('CHECK') || wordValues.has('COLLATE');
  return Object.freeze({
    emit: true,
    safety: guarded ? 'guarded' : 'safe',
    defaultKind,
  });
}

function withDefaultKind(
  classification: typeof OMITTED_ADD_COLUMN,
  defaultKind: AddColumnDefaultKind,
): AddColumnClassification {
  return Object.freeze({ ...classification, defaultKind });
}

function scanTopLevelSql(sql: string): TopLevelSqlScan {
  const words: string[] = [];
  let hasLineComment = false;
  let depth = 0;
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      hasLineComment = true;
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

  return { words, hasLineComment };
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
  // SQLite ends -- comments at LF; a bare CR remains part of the comment.
  while (index < sql.length && sql[index] !== '\n') {
    index += 1;
  }
  return index;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf('*/', start);
  return end === -1 ? sql.length : end + 2;
}

function isQuoteOpener(character: string | undefined): character is "'" | '"' | '`' | '[' {
  return character === "'" || character === '"' || character === '`' || character === '[';
}

function isSqliteWhitespace(character: string | undefined): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\v' ||
    character === '\f' ||
    character === '\r'
  );
}

function isSqliteIdentifierStart(character: string | undefined): boolean {
  if (!character) return false;
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    character === '_' ||
    (codePoint >= 65 && codePoint <= 90) ||
    (codePoint >= 97 && codePoint <= 122) ||
    (codePoint >= 0x80 && codePoint !== 0xfeff)
  );
}

function isSqliteIdentifierContinue(character: string | undefined): boolean {
  if (!character) return false;
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    isSqliteIdentifierStart(character) ||
    character === '$' ||
    (codePoint >= 48 && codePoint <= 57)
  );
}

function foldAscii(value: string): string {
  let folded = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    folded += codePoint >= 97 && codePoint <= 122 ? String.fromCodePoint(codePoint - 32) : character;
  }
  return folded;
}
