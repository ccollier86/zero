/**
 * vector-filter.ts
 *
 * Compiles Zero's structured vector filters into zvec's SQL-like scalar filter
 * expression. This file owns validation and expression safety only; it does
 * not execute queries or know any storage adapter details.
 */

import { VectorError } from './vector-error';
import type {
  StoredVectorRecord,
  VectorFilter,
  VectorFilterOperators,
  VectorFilterValue,
  VectorMetadata,
  VectorScalar,
} from './vector-types';

/** Compile a structured filter to zvec SQL-like filter syntax. */
export function buildZvecFilter(
  filter: VectorFilter | undefined,
  allowedFields?: ReadonlySet<string>,
  fieldAliases: Readonly<Record<string, string>> = {}
): string | undefined {
  if (!filter) return undefined;
  const expression = compileFilter(filter, allowedFields, fieldAliases);
  return expression || undefined;
}

/** Merge a scope filter with a caller filter using deny-by-default AND logic. */
export function mergeVectorFilters(
  scope: VectorFilter | undefined,
  filter: VectorFilter | undefined
): VectorFilter | undefined {
  if (!scope) return filter;
  if (!filter) return scope;
  return { $and: [scope, filter] };
}

/**
 * Extract simple equality metadata from a scope filter.
 *
 * Scope upserts use this to stamp records with required partition values. More
 * complex filters still work for query/delete but cannot safely auto-populate
 * metadata on writes.
 */
export function extractSimpleEqualityMetadata(filter: VectorFilter | undefined): VectorMetadata {
  if (!filter) return {};

  const metadata: VectorMetadata = {};
  for (const item of filter.$and ?? []) {
    for (const [field, value] of Object.entries(extractSimpleEqualityMetadata(item))) {
      if (metadata[field] !== undefined && metadata[field] !== value) {
        throw new VectorError('VECTOR_FILTER_INVALID', `Conflicting vector scope equality for "${field}".`, { field });
      }
      metadata[field] = value;
    }
  }

  for (const [field, value] of Object.entries(filter)) {
    if (field === '$and' || field === '$or' || value === undefined) continue;
    if (isVectorScalar(value) || value === null) {
      metadata[field] = value;
      continue;
    }
    if (isOperatorObject(value) && 'eq' in value && isVectorScalar(value.eq)) {
      metadata[field] = value.eq;
    }
  }
  return metadata;
}

/** Evaluate a structured filter against a returned record for scoped fetches. */
export function recordMatchesVectorFilter(record: StoredVectorRecord, filter: VectorFilter | undefined): boolean {
  if (!filter) return true;

  const andFilters = filter.$and;
  if (andFilters?.length && !andFilters.every((item) => recordMatchesVectorFilter(record, item))) return false;

  const orFilters = filter.$or;
  if (orFilters?.length && !orFilters.some((item) => recordMatchesVectorFilter(record, item))) return false;

  for (const [field, value] of Object.entries(filter)) {
    if (field === '$and' || field === '$or' || value === undefined) continue;
    if (!recordFieldMatches(record, field, value as VectorFilterValue)) return false;
  }

  return true;
}

/** Return field names referenced by a structured filter. */
export function getVectorFilterFields(filter: VectorFilter | undefined): string[] {
  if (!filter) return [];
  const fields = new Set<string>();
  collectFields(filter, fields);
  return [...fields].sort();
}

function compileFilter(
  filter: VectorFilter,
  allowedFields: ReadonlySet<string> | undefined,
  fieldAliases: Readonly<Record<string, string>>
): string {
  const parts: string[] = [];

  if (filter.$and?.length) {
    parts.push(group(filter.$and.map((item) => compileFilter(item, allowedFields, fieldAliases)).filter(Boolean), 'AND'));
  }

  if (filter.$or?.length) {
    parts.push(group(filter.$or.map((item) => compileFilter(item, allowedFields, fieldAliases)).filter(Boolean), 'OR'));
  }

  for (const [field, value] of Object.entries(filter)) {
    if (field === '$and' || field === '$or' || value === undefined) continue;
    ensureFilterField(field, allowedFields);
    parts.push(compileFieldFilter(zvecFieldName(field, fieldAliases), value as VectorFilterValue));
  }

  return parts.filter(Boolean).map((part) => `(${part})`).join(' AND ');
}

function compileFieldFilter(field: string, value: VectorFilterValue): string {
  if (value === null) return `${field} is null`;
  if (isVectorScalar(value)) return `${field} = ${literal(value)}`;
  if (Array.isArray(value)) return `${field} in (${literalList(value)})`;
  if (!isOperatorObject(value)) {
    throw new VectorError('VECTOR_FILTER_INVALID', `Invalid vector filter value for "${field}".`, { field });
  }

  const parts: string[] = [];
  if ('eq' in value) parts.push(value.eq === null ? `${field} is null` : `${field} = ${literal(requiredScalar(value.eq, field, 'eq'))}`);
  if ('ne' in value) parts.push(value.ne === null ? `${field} is not null` : `${field} != ${literal(requiredScalar(value.ne, field, 'ne'))}`);
  if (value.gt !== undefined) parts.push(`${field} > ${literal(requiredScalar(value.gt, field, 'gt'))}`);
  if (value.gte !== undefined) parts.push(`${field} >= ${literal(requiredScalar(value.gte, field, 'gte'))}`);
  if (value.lt !== undefined) parts.push(`${field} < ${literal(requiredScalar(value.lt, field, 'lt'))}`);
  if (value.lte !== undefined) parts.push(`${field} <= ${literal(requiredScalar(value.lte, field, 'lte'))}`);
  if (value.in !== undefined) parts.push(`${field} in (${literalList(value.in)})`);
  if (value.notIn !== undefined) parts.push(`${field} not in (${literalList(value.notIn)})`);
  if (value.exists !== undefined) parts.push(`${field} is ${value.exists ? 'not ' : ''}null`);
  if (value.like !== undefined) parts.push(`${field} like ${literal(value.like)}`);

  if (!parts.length) {
    throw new VectorError('VECTOR_FILTER_INVALID', `Empty vector filter operator for "${field}".`, { field });
  }

  return parts.join(' AND ');
}

function ensureFilterField(field: string, allowedFields?: ReadonlySet<string>): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    throw new VectorError('VECTOR_FILTER_INVALID', `Invalid vector filter field "${field}".`, { field });
  }
  if (allowedFields && !allowedFields.has(field)) {
    throw new VectorError('VECTOR_FILTER_INVALID', `Vector filter field "${field}" is not configured.`, { field });
  }
}

function zvecFieldName(field: string, aliases: Readonly<Record<string, string>>): string {
  const mapped = aliases[field] ?? field;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(mapped)) {
    throw new VectorError('VECTOR_FILTER_INVALID', `Invalid zvec filter field "${mapped}".`, { field: mapped });
  }
  return mapped;
}

function group(parts: string[], joiner: 'AND' | 'OR'): string {
  if (!parts.length) return '';
  return parts.map((part) => `(${part})`).join(` ${joiner} `);
}

function literal(value: VectorScalar): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (!Number.isFinite(value)) {
    throw new VectorError('VECTOR_FILTER_INVALID', 'Vector numeric filter values must be finite.', { value });
  }
  return String(value);
}

function literalList(values: readonly VectorScalar[]): string {
  if (!values.length) {
    throw new VectorError('VECTOR_FILTER_INVALID', 'Vector filter membership lists cannot be empty.');
  }
  return values.map(literal).join(', ');
}

function requiredScalar(
  value: VectorScalar | null | undefined,
  field: string,
  operator: keyof VectorFilterOperators
): VectorScalar {
  if (!isVectorScalar(value)) {
    throw new VectorError('VECTOR_FILTER_INVALID', `Vector filter ${String(operator)} for "${field}" requires a scalar.`, {
      field,
      operator,
    });
  }
  return value;
}

function isOperatorObject(value: unknown): value is VectorFilterOperators {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isVectorScalar(value: unknown): value is VectorScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function recordFieldMatches(record: StoredVectorRecord, field: string, filter: VectorFilterValue): boolean {
  const actual = recordFieldValue(record, field);
  if (filter === null) return actual == null;
  if (isVectorScalar(filter)) return actual === filter;
  if (Array.isArray(filter)) return filter.includes(actual as VectorScalar);
  if (!isOperatorObject(filter)) return false;

  if ('eq' in filter && actual !== filter.eq) return false;
  if ('ne' in filter && actual === filter.ne) return false;
  if (filter.exists !== undefined && (actual != null) !== filter.exists) return false;
  if (filter.gt !== undefined && !compare(actual, filter.gt, (a, b) => a > b)) return false;
  if (filter.gte !== undefined && !compare(actual, filter.gte, (a, b) => a >= b)) return false;
  if (filter.lt !== undefined && !compare(actual, filter.lt, (a, b) => a < b)) return false;
  if (filter.lte !== undefined && !compare(actual, filter.lte, (a, b) => a <= b)) return false;
  if (filter.in !== undefined && !filter.in.includes(actual as VectorScalar)) return false;
  if (filter.notIn !== undefined && filter.notIn.includes(actual as VectorScalar)) return false;
  if (filter.like !== undefined && typeof actual === 'string' && !likeToRegExp(filter.like).test(actual)) return false;
  if (filter.like !== undefined && typeof actual !== 'string') return false;

  return true;
}

function recordFieldValue(record: StoredVectorRecord, field: string): unknown {
  if (field === 'id') return record.id;
  if (field === 'text') return record.text;
  return record.metadata[field];
}

function compare(actual: unknown, expected: VectorScalar, predicate: (a: VectorScalar, b: VectorScalar) => boolean): boolean {
  if (!isVectorScalar(actual)) return false;
  if (typeof actual !== typeof expected) return false;
  return predicate(actual, expected);
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`);
}

function collectFields(filter: VectorFilter, fields: Set<string>): void {
  for (const item of filter.$and ?? []) collectFields(item, fields);
  for (const item of filter.$or ?? []) collectFields(item, fields);
  for (const field of Object.keys(filter)) {
    if (field !== '$and' && field !== '$or') fields.add(field);
  }
}
