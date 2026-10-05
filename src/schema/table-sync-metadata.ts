/** Preserve declaration intent on server projections without inventing SQL columns. */

import type { DeclaredSyncMode, TableSchema } from '../sync/types';

const DECLARED_TABLE_SYNC_MODE = Symbol.for('@zero/framework/schema-declared-sync-mode');

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

/** Accept only declared loading modes, never a string-key SQL column named _sync. */
export function getDeclaredTableSyncMode(table: object): DeclaredSyncMode | undefined {
  const mode: unknown = Reflect.get(table, DECLARED_TABLE_SYNC_MODE);
  return mode === 'full' || mode === 'lazy' || mode === 'auto' ? mode : undefined;
}
