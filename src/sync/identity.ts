/**
 * identity.ts
 *
 * Shared natural-identity helpers. These functions keep relational/business
 * identity deterministic while the sync protocol continues to use one string
 * primary key per row.
 */

import type { ClientTableDef, Row } from './types';

const ID_PREFIX = 'zi1';

/** Values accepted in natural identity fields. */
export type IdentityValue = string | number | boolean;

/** Object form used when looking up a row by its natural identity. */
export type IdentityKey = Record<string, unknown>;

/**
 * Return a deterministic sync row id from a table name, ordered identity
 * fields, and a row/key object.
 */
export function createIdentityId(
  table: string,
  identityFields: readonly string[],
  row: Row
): string {
  assertIdentityFields(identityFields);

  const values = getIdentityValues(identityFields, row);
  return `${ID_PREFIX}:${base64UrlEncodeJson({
    table,
    fields: identityFields,
    values,
  })}`;
}

/**
 * Ensure a row has the table's sync primary key.
 *
 * Natural-identity tables get deterministic ids; normal tables get UUIDs.
 * This keeps sync clients and UI helpers from duplicating identity policy.
 */
export function ensureRowSyncPrimaryKey<T extends Row>(
  table: string,
  tableDef: Pick<ClientTableDef, '_pk' | '_identity'>,
  row: T,
): T {
  const primaryKey = tableDef._pk;
  const existing = row[primaryKey];
  if (existing !== undefined && existing !== null && existing !== '') return row;

  return {
    ...row,
    [primaryKey]: hasIdentity(tableDef._identity)
      ? createIdentityId(table, tableDef._identity, row)
      : crypto.randomUUID(),
  } as T;
}

/**
 * Return a copy whose sync primary key is forced to the deterministic natural
 * identity id. Used by upsert-by-identity APIs.
 */
export function withIdentityPrimaryKey<T extends Row>(
  table: string,
  primaryKey: string,
  identityFields: readonly string[],
  row: T,
): T {
  return {
    ...row,
    [primaryKey]: createIdentityId(table, identityFields, row),
  } as T;
}

/**
 * Extract identity values in declared order and reject missing or unsupported
 * values early so invalid rows fail before sync mutation dispatch.
 */
export function getIdentityValues(
  identityFields: readonly string[],
  row: Row
): IdentityValue[] {
  assertIdentityFields(identityFields);

  return identityFields.map((field) => {
    const value = row[field];
    if (value === undefined || value === null || value === '') {
      throw new Error(`[identity] Missing identity field "${field}".`);
    }
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new Error(`[identity] Identity field "${field}" must be a string, number, or boolean.`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`[identity] Identity field "${field}" must be a finite number.`);
    }
    return value;
  });
}

/** Validate a natural identity declaration. */
export function assertIdentityFields(identityFields: readonly string[] | undefined): asserts identityFields is readonly string[] {
  if (!identityFields) return;
  if (!Array.isArray(identityFields) || identityFields.length === 0) {
    throw new Error('[identity] identity must contain at least one field.');
  }

  const seen = new Set<string>();
  for (const field of identityFields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
      throw new Error(`[identity] Invalid identity field "${field}".`);
    }
    if (seen.has(field)) {
      throw new Error(`[identity] Duplicate identity field "${field}".`);
    }
    seen.add(field);
  }
}

/** Return true when a table declares natural identity fields. */
export function hasIdentity(identityFields: readonly string[] | undefined): identityFields is readonly string[] {
  return Array.isArray(identityFields) && identityFields.length > 0;
}

/** Quote an identifier after validating the platform-supported identifier shape. */
export function quoteSqlIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`[identity] Invalid SQL identifier "${identifier}".`);
  }
  return `"${identifier}"`;
}

function base64UrlEncodeJson(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
