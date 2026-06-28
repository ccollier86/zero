/**
 * row-identity.ts
 *
 * Schema-aware row identity helpers for CRUD and table components. This file
 * owns primary-key lookup/generation only; it does not render UI or mutate the
 * sync store.
 */

import type { SchemaDescriptor } from '../../schema/define-schema';
import type { Row } from '../../sync/types';
import { createIdentityId, hasIdentity } from '../../sync/identity';

export interface EnsureRowPrimaryKeyOptions {
  table?: string;
  identity?: readonly string[];
}

export function getSchemaPrimaryKey(schema: SchemaDescriptor, override?: string): string {
  return override ?? schema.primaryKey ?? 'id';
}

export function getRowPrimaryKey(row: Row, primaryKey: string): string | null {
  const value = row[primaryKey];
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

export function requireRowPrimaryKey(row: Row, primaryKey: string): string {
  const id = getRowPrimaryKey(row, primaryKey);
  if (!id) throw new Error(`[data-table] Row is missing primary key "${primaryKey}".`);
  return id;
}

export function ensureRowPrimaryKey<T extends Row>(
  row: T,
  primaryKey: string,
  options: EnsureRowPrimaryKeyOptions = {},
): T {
  if (getRowPrimaryKey(row, primaryKey)) return row;
  if (options.table && hasIdentity(options.identity)) {
    return {
      ...row,
      [primaryKey]: createIdentityId(options.table, options.identity, row),
    } as T;
  }
  return { ...row, [primaryKey]: crypto.randomUUID() } as T;
}

export function stripRowPrimaryKey<T extends Row>(row: Partial<T>, primaryKey: string): Partial<T> {
  const next = { ...row } as Record<string, unknown>;
  delete next[primaryKey];
  return next as Partial<T>;
}
