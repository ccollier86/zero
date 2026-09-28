/**
 * resource-schema.ts
 *
 * Owns table-schema inspection helpers used by resource registration. This
 * file reads in-memory schema metadata only; it does not query SQLite, mutate
 * resources, or evaluate authorization policy.
 */

import type { TableSchema } from '../sync/types';

/** Return the first SQL column declared as a primary key in a Zero table schema. */
export function inferTablePrimaryKey(schema: TableSchema | undefined): string | null {
  if (!schema) return null;

  for (const [column] of Object.entries(schema)) {
    if (column === '_identity') continue;
    if (tableColumnDeclaresPrimaryKey(schema, column)) return column;
  }

  return null;
}

/**
 * Return true only when a top-level `PRIMARY KEY` column constraint exists.
 *
 * Quoted default values, comments, and nested CHECK expressions must not make
 * a plain column look like the unique row identity used by CRUD and Sync.
 */
export function tableColumnDeclaresPrimaryKey(
  schema: TableSchema | undefined,
  column: string,
): boolean {
  const definition = schema?.[column];
  if (typeof definition !== 'string') return false;
  const tokens = topLevelSqlTokens(definition);
  return tokens.some((token, index) =>
    token === 'PRIMARY' && tokens[index + 1] === 'KEY');
}

/** Return true when a table schema has the named SQL column. */
export function tableHasColumn(schema: TableSchema | undefined, column: string): boolean {
  if (!schema) return false;
  return typeof schema[column] === 'string';
}

/**
 * Return true only for a top-level SQL `NOT NULL` column constraint.
 *
 * A plain regular expression is unsafe here: `DEFAULT 'not null'`, comments,
 * and `CHECK (... NOT NULL ...)` would otherwise make a nullable discriminator
 * look protected. Runtime startup separately verifies SQLite's actual
 * `PRAGMA table_info` result so old on-disk schemas cannot rely on config text.
 */
export function tableColumnIsDeclaredNotNull(
  schema: TableSchema | undefined,
  column: string,
): boolean {
  const definition = schema?.[column];
  if (typeof definition !== 'string') return false;
  const tokens = topLevelSqlTokens(definition);
  return tokens.some((token, index) =>
    token === 'NOT' && tokens[index + 1] === 'NULL');
}

/** Return real SQL column names from a table schema, excluding Zero metadata. */
export function getResourceTableColumns(schema: TableSchema | undefined): string[] {
  if (!schema) return [];

  return Object.entries(schema)
    .filter(([key, value]) => key !== '_identity' && typeof value === 'string')
    .map(([key]) => key);
}

function topLevelSqlTokens(sql: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let depth = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;

  const flush = () => {
    if (!token) return;
    tokens.push(token.toUpperCase());
    token = '';
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (quote) {
      if (quote === ']' ? char === ']' : char === quote) {
        // SQL escapes matching quote characters by doubling them.
        if (quote !== ']' && next === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      flush();
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      flush();
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      flush();
      quote = char === '[' ? ']' : char;
      continue;
    }
    if (char === '(') {
      flush();
      depth += 1;
      continue;
    }
    if (char === ')') {
      flush();
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && (token
      ? /[A-Za-z0-9_$]/.test(char)
      : /[A-Za-z_]/.test(char))) {
      token += char;
      continue;
    }
    flush();
  }
  flush();
  return tokens;
}
