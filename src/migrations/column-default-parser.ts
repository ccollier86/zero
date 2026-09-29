export type DeclaredColumnDefaultKind =
  | 'absent'
  | 'invalid'
  | 'literal'
  | 'null'
  | 'parenthesized'
  | 'current-time'
  | 'current-date'
  | 'current-timestamp';

export interface DeclaredColumnDefault {
  readonly kind: DeclaredColumnDefaultKind;
  /** SQLite-compatible PRAGMA table_info dflt_value text, or null when absent/invalid. */
  readonly value: string | null;
}

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

// SQLite historically accepts many keywords as bare literal defaults, but the
// following words are parsed as grammar in this exact position and reject the
// definition. Quoting any of them remains an admitted literal.
const INVALID_BARE_DEFAULT_KEYWORDS = new Set(`
  ADD ALL ALTER AND AS AUTOINCREMENT BETWEEN CASE CHECK COLLATE COMMIT
  CONSTRAINT CREATE CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DEFAULT
  DEFERRABLE DELETE DISTINCT DROP ELSE ESCAPE EXCEPT EXISTS FOREIGN FROM FULL
  GROUP HAVING IN INDEX INNER INSERT INTERSECT INTO IS ISNULL JOIN LEFT LIMIT
  NATURAL NOT NOTHING NOTNULL ON OR ORDER OUTER PRIMARY REFERENCES RETURNING
  RIGHT SELECT SET TABLE THEN TO TRANSACTION UNION UNIQUE UPDATE USING VALUES
  WHEN WHERE
`.trim().split(/\s+/u));

/**
 * Inspect the actual DEFAULT column constraint while excluding a foreign-key
 * `ON DELETE/UPDATE SET DEFAULT` action. This is the one default grammar used
 * by both declared schema metadata and direct ADD COLUMN admission.
 */
export function inspectDeclaredColumnDefault(
  definition: string,
): DeclaredColumnDefault {
  const defaultEnd = findTopLevelDefaultEnd(definition);
  if (defaultEnd === null) return result('absent', null);

  const start = skipSqlTrivia(definition, defaultEnd);
  if (start >= definition.length) return result('invalid', null);

  const opener = definition[start]!;
  if (opener === '(') {
    const end = findBalancedExpressionEnd(definition, start);
    if (end === null || !hasValidDefaultBoundary(definition, end)) {
      return result('invalid', null);
    }
    return result(
      'parenthesized',
      trimSqliteWhitespace(definition.slice(start + 1, end - 1)),
    );
  }
  if (isSqlQuoteOpener(opener)) {
    const end = findQuotedTokenEnd(definition, start, opener);
    return end === null || !hasValidDefaultBoundary(definition, end)
      ? result('invalid', null)
      : result('literal', definition.slice(start, end));
  }

  if (opener === '+' || opener === '-') {
    const numberStart = skipSqlTrivia(definition, start + 1);
    const numberEnd = findBareDefaultTokenEnd(definition, numberStart);
    if (numberEnd === null
      || !isSqliteNumericLiteral(definition.slice(numberStart, numberEnd))
      || !hasValidDefaultBoundary(definition, numberEnd)) {
      return result('invalid', null);
    }
    return result('literal', definition.slice(start, numberEnd));
  }

  if ((opener === 'x' || opener === 'X') && definition[start + 1] === "'") {
    const end = findQuotedTokenEnd(definition, start + 1, "'");
    if (end === null
      || !isSqliteBlobLiteral(definition.slice(start, end))
      || !hasValidDefaultBoundary(definition, end)) {
      return result('invalid', null);
    }
    return result('literal', definition.slice(start, end));
  }

  const firstEnd = findBareDefaultTokenEnd(definition, start);
  if (firstEnd === null) return result('invalid', null);
  const first = definition.slice(start, firstEnd);
  if (!hasValidDefaultBoundary(definition, firstEnd)) {
    return result('invalid', null);
  }

  switch (asciiUpper(first)) {
    case 'NULL':
      return result('null', first);
    case 'CURRENT_TIME':
      return result('current-time', first);
    case 'CURRENT_DATE':
      return result('current-date', first);
    case 'CURRENT_TIMESTAMP':
      return result('current-timestamp', first);
    default:
      return isSqliteNumericLiteral(first)
        || (isSqliteBareIdentifier(first)
          && !INVALID_BARE_DEFAULT_KEYWORDS.has(asciiUpper(first)))
        ? result('literal', first)
        : result('invalid', null);
  }
}

function result(
  kind: DeclaredColumnDefaultKind,
  value: string | null,
): DeclaredColumnDefault {
  return Object.freeze({ kind, value });
}

function findTopLevelDefaultEnd(definition: string): number | null {
  let depth = 0;
  let previousTopLevelWord: string | null = null;
  for (let index = 0; index < definition.length;) {
    const char = definition[index]!;
    const next = definition[index + 1];
    if (char === '-' && next === '-') {
      index = skipLineComment(definition, index + 2);
      continue;
    }
    if (char === '/' && next === '*') {
      const end = definition.indexOf('*/', index + 2);
      if (end === -1) return null;
      index = end + 2;
      continue;
    }
    if (char === '\ufeff') {
      index += 1;
      continue;
    }
    if (isSqlQuoteOpener(char)) {
      const end = findQuotedTokenEnd(definition, index, char);
      if (end === null) return null;
      index = end;
      continue;
    }
    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      if (depth === 0) return null;
      depth -= 1;
      index += 1;
      continue;
    }
    if (depth === 0 && isSqlIdentifierStart(char)) {
      let end = index + 1;
      while (end < definition.length
        && isSqlIdentifierContinue(definition[end]!)) end += 1;
      const word = asciiUpper(definition.slice(index, end));
      if (word === 'DEFAULT' && previousTopLevelWord !== 'SET') return end;
      previousTopLevelWord = word;
      index = end;
      continue;
    }
    index += 1;
  }
  return null;
}

function findBalancedExpressionEnd(
  definition: string,
  start: number,
): number | null {
  let depth = 0;
  for (let index = start; index < definition.length;) {
    const char = definition[index]!;
    const next = definition[index + 1];
    if (char === '-' && next === '-') {
      index = skipLineComment(definition, index + 2);
      continue;
    }
    if (char === '/' && next === '*') {
      const end = definition.indexOf('*/', index + 2);
      if (end === -1) return null;
      index = end + 2;
      continue;
    }
    if (isSqlQuoteOpener(char)) {
      const end = findQuotedTokenEnd(definition, index, char);
      if (end === null) return null;
      index = end;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return null;
    }
    index += 1;
  }
  return null;
}

function findQuotedTokenEnd(
  definition: string,
  start: number,
  opener: string,
): number | null {
  const closer = opener === '[' ? ']' : opener;
  for (let index = start + 1; index < definition.length; index += 1) {
    if (definition[index] !== closer) continue;
    if (opener !== '[' && definition[index + 1] === closer) {
      index += 1;
      continue;
    }
    return index + 1;
  }
  return null;
}

function skipSqlTrivia(definition: string, start: number): number {
  let index = start;
  while (index < definition.length) {
    if (isSqliteWhitespace(definition[index]!)
      || definition[index] === '\ufeff') {
      index += 1;
      continue;
    }
    if (definition[index] === '/' && definition[index + 1] === '*') {
      const end = definition.indexOf('*/', index + 2);
      if (end === -1) return definition.length;
      index = end + 2;
      continue;
    }
    if (definition[index] === '-' && definition[index + 1] === '-') {
      const end = skipLineComment(definition, index + 2);
      if (end >= definition.length) return definition.length;
      index = end + 1;
      continue;
    }
    return index;
  }
  return index;
}

function findBareDefaultTokenEnd(
  definition: string,
  start: number,
): number | null {
  let end = start;
  while (end < definition.length) {
    const char = definition[end]!;
    const next = definition[end + 1];
    if (isSqliteWhitespace(char) || char === ',' || char === ';' || char === ')'
      || (char === '/' && next === '*')
      || (char === '-' && next === '-')) break;
    if (isSqlQuoteOpener(char)) {
      const quotedEnd = findQuotedTokenEnd(definition, end, char);
      if (quotedEnd === null) return null;
      end = quotedEnd;
      continue;
    }
    end += 1;
  }
  return end === start ? null : end;
}

function hasValidDefaultBoundary(definition: string, start: number): boolean {
  const boundary = skipSqlTrivia(definition, start);
  if (boundary >= definition.length) return true;
  if (!isSqlIdentifierStart(definition[boundary]!)) return false;

  let end = boundary + 1;
  while (end < definition.length
    && isSqlIdentifierContinue(definition[end]!)) end += 1;
  return COLUMN_CONSTRAINT_STARTERS.has(
    asciiUpper(definition.slice(boundary, end)),
  );
}

function skipLineComment(sql: string, start: number): number {
  let index = start;
  // SQLite ends -- comments at LF; a bare CR remains part of the comment.
  while (index < sql.length && sql[index] !== '\n') index += 1;
  return index;
}

function isSqlQuoteOpener(char: string): boolean {
  return char === "'" || char === '"' || char === '`' || char === '[';
}

function isSqlIdentifierStart(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  return char === '_'
    || (codePoint >= 65 && codePoint <= 90)
    || (codePoint >= 97 && codePoint <= 122)
    || (codePoint >= 0x80 && codePoint !== 0xfeff);
}

function isSqlIdentifierContinue(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  return isSqlIdentifierStart(char)
    || char === '$'
    || (codePoint >= 48 && codePoint <= 57)
    || codePoint === 0xfeff;
}

function isSqliteWhitespace(char: string): boolean {
  return char === ' '
    || char === '\t'
    || char === '\n'
    || char === '\v'
    || char === '\f'
    || char === '\r';
}

function trimSqliteWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isSqliteWhitespace(value[start]!)) start += 1;
  while (end > start && isSqliteWhitespace(value[end - 1]!)) end -= 1;
  return value.slice(start, end);
}

function isSqliteNumericLiteral(value: string): boolean {
  const digit = '[0-9](?:_?[0-9])*';
  const hexadecimal = '0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*';
  const decimal = `(?:${digit}(?:\\.(?:${digit})?)?|\\.${digit})`;
  const exponent = `(?:[eE][+-]?${digit})?`;
  return new RegExp(`^(?:${hexadecimal}|${decimal}${exponent})$`).test(value);
}

function isSqliteBareIdentifier(value: string): boolean {
  if (value.length === 0 || !isSqlIdentifierStart(value[0]!)) return false;
  for (let index = 1; index < value.length; index += 1) {
    if (!isSqlIdentifierContinue(value[index]!)) return false;
  }
  return true;
}

function isSqliteBlobLiteral(value: string): boolean {
  return /^[xX]'(?:[0-9A-Fa-f]{2})*'$/u.test(value);
}

function asciiUpper(value: string): string {
  return value.replace(/[a-z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x20));
}
