/**
 * resource-field-access.ts
 *
 * Owns the immutable, declarative column boundary for managed resources.
 * Policies still receive complete server rows; projection happens only after
 * authorization, and client input is checked before realm/policy stamping.
 */

import type { Row } from '../sync/types';

/** App-authored allow-lists for one resource's managed client surface. */
export interface ResourceFieldAccessInput {
  /** Columns returned to managed clients. Required once `fields` is present. */
  read: readonly string[];
  /** Columns accepted from a client INSERT. Defaults to none. */
  create?: readonly string[];
  /** Columns accepted from a client UPDATE. Defaults to none. */
  update?: readonly string[];
  /** Readable columns accepted in client filters. Defaults to `read`. */
  filter?: readonly string[];
  /** Readable columns accepted in client sorts. Defaults to `read`. */
  sort?: readonly string[];
}

/** Fully normalized, deeply frozen managed-client field contract. */
export interface ResourceFieldAccess {
  readonly read: readonly string[];
  readonly create: readonly string[];
  readonly update: readonly string[];
  readonly filter: readonly string[];
  readonly sort: readonly string[];
}

/** Stable error returned when client input crosses a write allow-list. */
export interface ResourceFieldWriteError {
  readonly status: 400;
  readonly code: 'resource-field-not-writable';
  readonly error: string;
}

/**
 * Define a reusable client-safe field contract.
 *
 * The returned value contains field names only, so apps may share it between a
 * server resource declaration and generated client forms without publishing
 * executable policy, realms, or authorization metadata.
 */
export function defineResourceFields(
  input: ResourceFieldAccessInput,
): ResourceFieldAccess {
  return normalizeResourceFieldAccess(input)!;
}

/** Normalize the opt-in allow-list contract without consulting table schema. */
export function normalizeResourceFieldAccess(
  input: ResourceFieldAccessInput | undefined,
): ResourceFieldAccess | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('[resources] Resource fields must be an object of field allow-lists.');
  }

  const read = normalizeFieldList(input.read, 'read', true);
  const create = normalizeFieldList(input.create, 'create');
  const update = normalizeFieldList(input.update, 'update');
  const filter = input.filter === undefined
    ? Object.freeze([...read])
    : normalizeFieldList(input.filter, 'filter');
  const sort = input.sort === undefined
    ? Object.freeze([...read])
    : normalizeFieldList(input.sort, 'sort');

  assertSubset(filter, read, 'filter', 'read');
  assertSubset(sort, read, 'sort', 'read');

  return Object.freeze({ read, create, update, filter, sort });
}

/** Return a row containing only columns in the resource read allow-list. */
export function projectResourceRow(
  row: Row,
  fields: ResourceFieldAccess | undefined,
): Row {
  if (!fields) return row;
  const projected: Row = {};
  for (const field of fields.read) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      projected[field] = row[field];
    }
  }
  return projected;
}

/** Project a row array through the exact same read allow-list. */
export function projectResourceRows(
  rows: readonly Row[],
  fields: ResourceFieldAccess | undefined,
): Row[] {
  if (!fields) return [...rows];
  return rows.map((row) => projectResourceRow(row, fields));
}

/**
 * Reject browser/native input that names a non-writable field.
 *
 * Call this on the raw client body. Realm and policy stamping deliberately run
 * afterward so trusted server fields do not need client write permission.
 */
export function validateResourceClientWriteFields(
  input: Record<string, unknown>,
  fields: ResourceFieldAccess | undefined,
  action: 'create' | 'update',
  table: string,
  alwaysAllowed: readonly string[] = [],
): ResourceFieldWriteError | null {
  if (!fields) return null;
  const allowed = new Set([...fields[action], ...alwaysAllowed]);
  for (const field of Object.keys(input)) {
    if (allowed.has(field)) continue;
    return {
      status: 400,
      code: 'resource-field-not-writable',
      error: `Field '${field}' is not client-writable for ${action} on resource table '${table}'`,
    };
  }
  return null;
}

function normalizeFieldList(
  value: readonly string[] | undefined,
  capability: keyof ResourceFieldAccess,
  required = false,
): readonly string[] {
  if (value === undefined) {
    if (required) {
      throw new Error(
        `[resources] Resource fields.${capability} is required when a field contract is declared.`,
      );
    }
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new Error(`[resources] Resource fields.${capability} must be an array.`);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawField of value) {
    if (typeof rawField !== 'string' || !rawField.trim()) {
      throw new Error(
        `[resources] Resource fields.${capability} must contain only non-empty field names.`,
      );
    }
    const field = rawField.trim();
    if (seen.has(field)) {
      throw new Error(
        `[resources] Duplicate resource fields.${capability} field "${field}".`,
      );
    }
    seen.add(field);
    normalized.push(field);
  }
  return Object.freeze(normalized);
}

function assertSubset(
  candidate: readonly string[],
  parent: readonly string[],
  capability: 'filter' | 'sort',
  parentCapability: 'read',
): void {
  const parentSet = new Set(parent);
  const hidden = candidate.find((field) => !parentSet.has(field));
  if (!hidden) return;
  throw new Error(
    `[resources] Resource fields.${capability} field "${hidden}" must also be listed in fields.${parentCapability}.`,
  );
}
