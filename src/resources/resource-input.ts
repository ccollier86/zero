/**
 * resource-input.ts
 *
 * Owns JSON body normalization for generated resource CRUD routes. This file
 * validates table-column boundaries and SQL value shapes only; it does not
 * evaluate authorization policy, write ReactiveDB, or mount HTTP routes.
 */

export type ResourceInputValue = string | number | boolean | null;

/** Structured input validation failure returned by body sanitizers. */
export interface ResourceInputError {
  status: number;
  error: string;
}

/** Return true when a sanitizer result is an input error. */
export function isResourceInputError(value: unknown): value is ResourceInputError {
  return Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as ResourceInputError).status === 'number' &&
    typeof (value as ResourceInputError).error === 'string';
}

/**
 * Sanitize a create body to known table columns and SQLite scalar values.
 *
 * The primary key is allowed because apps may use natural IDs, UUIDs, or
 * explicit IDs. ReactiveDB still enforces its own primary key requirements.
 */
export function sanitizeResourceCreateInput(
  input: unknown,
  columns: readonly string[],
  table: string
): Record<string, ResourceInputValue> | ResourceInputError {
  const body = normalizeObjectInput(input);
  if (isResourceInputError(body)) return body;

  const columnSet = new Set(columns);
  const sanitized = sanitizeEntries(body, columnSet, table);
  if (isResourceInputError(sanitized)) return sanitized;

  if (Object.keys(sanitized).length === 0) {
    return { status: 400, error: 'Create body must include at least one field' };
  }

  return sanitized;
}

/**
 * Sanitize an update body to known non-primary-key table columns.
 *
 * Primary key fields are intentionally ignored so clients cannot move a row to
 * a new identity through generated update routes.
 */
export function sanitizeResourceUpdateInput(
  input: unknown,
  columns: readonly string[],
  table: string,
  primaryKey: string
): Record<string, ResourceInputValue> | ResourceInputError {
  const body = normalizeObjectInput(input);
  if (isResourceInputError(body)) return body;

  const columnSet = new Set(columns);
  const withoutPrimaryKey = { ...body };
  delete withoutPrimaryKey[primaryKey];

  const sanitized = sanitizeEntries(withoutPrimaryKey, columnSet, table);
  if (isResourceInputError(sanitized)) return sanitized;

  if (Object.keys(sanitized).length === 0) {
    return { status: 400, error: 'Update body must include at least one mutable field' };
  }

  return sanitized;
}

function normalizeObjectInput(input: unknown): Record<string, unknown> | ResourceInputError {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 400, error: 'Request body must be a JSON object' };
  }

  return input as Record<string, unknown>;
}

function sanitizeEntries(
  input: Record<string, unknown>,
  columns: Set<string>,
  table: string
): Record<string, ResourceInputValue> | ResourceInputError {
  const sanitized: Record<string, ResourceInputValue> = {};

  for (const [field, value] of Object.entries(input)) {
    if (!columns.has(field)) {
      return { status: 400, error: `Unknown column '${field}' for table '${table}'` };
    }

    if (!isResourceInputValue(value)) {
      return {
        status: 400,
        error: `Column '${field}' must be a string, number, boolean, or null`,
      };
    }

    sanitized[field] = value;
  }

  return sanitized;
}

function isResourceInputValue(value: unknown): value is ResourceInputValue {
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean';
}
