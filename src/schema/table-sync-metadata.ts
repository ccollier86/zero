/**
 * table-sync-metadata.ts
 *
 * Owns descriptor-safe loading intent on server schema projections. Consumers
 * may admit this framework-owned metadata without treating it as a SQL column;
 * this module does not select databases or resolve runtime loading policy.
 */

import type { DeclaredSyncMode, TableSchema } from '../sync/types';

/** Internal shared identity admitted by Fabric; intentionally not a public schema field. */
export const DECLARED_TABLE_SYNC_MODE: unique symbol = Symbol.for(
  '@zero/framework/schema-declared-sync-mode',
) as typeof DECLARED_TABLE_SYNC_MODE;

/** Admit exactly the supported declaration modes without coercing untrusted values. */
export function isDeclaredTableSyncMode(value: unknown): value is DeclaredSyncMode {
  return value === 'full' || value === 'lazy' || value === 'auto';
}

/** Internal metadata survives object spreads, but is excluded from columns and JSON. */
export function attachDeclaredTableSyncMode(table: TableSchema, mode: DeclaredSyncMode | undefined): void {
  if (mode === undefined) return;
  Object.defineProperty(table, DECLARED_TABLE_SYNC_MODE, {
    value: mode,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

/**
 * Read an own metadata data property without invoking an accessor. Missing
 * metadata inherits app policy; present but malformed metadata fails admission
 * instead of silently changing the table's intended loading behavior.
 */
export function getDeclaredTableSyncMode(table: object): DeclaredSyncMode | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(table, DECLARED_TABLE_SYNC_MODE);
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor)
    || !isDeclaredTableSyncMode(descriptor.value)) {
    throw new TypeError('Declared table sync metadata must be an enumerable supported-mode data property.');
  }
  return descriptor.value;
}
