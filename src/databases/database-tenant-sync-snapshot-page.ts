/** Bounded reconstruction of one immutable snapshot-session page. */

import type { DatabaseOperationCatalog } from './database-operations';
import {
  decodeDatabaseTenantSyncStoredPageRow,
  validateDatabaseTenantSyncStoredPageRow,
  type DatabaseTenantSyncStoredPageRow,
} from './database-tenant-sync-snapshot-codec';
import type { DatabaseTenantSyncSnapshotSessionLimits } from './database-tenant-sync-snapshot-limits';
import type { DatabaseActorTenantSyncSnapshotPageRow } from './database-tenant-sync-snapshot-protocol';

interface BuildDatabaseTenantSyncSnapshotPageOptions {
  readonly candidates: readonly DatabaseTenantSyncStoredPageRow[];
  readonly cursor: number;
  readonly tables: readonly string[];
  readonly catalog: DatabaseOperationCatalog;
  readonly limits: DatabaseTenantSyncSnapshotSessionLimits;
}

export function buildDatabaseTenantSyncSnapshotPageRows(
  options: BuildDatabaseTenantSyncSnapshotPageOptions,
): readonly DatabaseActorTenantSyncSnapshotPageRow[] {
  const rows: DatabaseActorTenantSyncSnapshotPageRow[] = [];
  let pageBytes = 0;
  let pageNodes = 4;
  for (const candidate of options.candidates) {
    const stored = validateDatabaseTenantSyncStoredPageRow(
      candidate,
      options.cursor + rows.length,
    );
    if (rows.length >= options.limits.pageMaxRows
      || pageBytes + stored.sourceBytes > options.limits.pageMaxSourceBytes
      || pageNodes + stored.nodeCount + 5 > options.limits.pageMaxNodes) break;
    const decoded = decodeDatabaseTenantSyncStoredPageRow(
      stored,
      options.tables,
      options.catalog,
    );
    rows.push(decoded.row);
    pageBytes += decoded.sourceBytes;
    pageNodes += decoded.nodeCount + 5;
  }
  return Object.freeze(rows);
}
