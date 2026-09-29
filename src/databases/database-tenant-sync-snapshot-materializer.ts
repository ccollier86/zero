/** Immutable source-snapshot materialization for one tenant Sync session. */

import { quoteSqlIdentifier } from '../sync/identity';
import { DatabaseError } from './database-error';
import type { DatabaseOperationCatalog } from './database-operations';
import type { DatabaseRuntime } from './database-runtime';
import { encodeDatabaseTenantSyncSourceRow } from './database-tenant-sync-snapshot-codec';
import {
  databaseTenantSyncSnapshotCapacity,
  databaseTenantSyncSnapshotExpired,
  databaseTenantSyncSnapshotLimit,
  databaseTenantSyncSnapshotSchemaMismatch,
} from './database-tenant-sync-snapshot-errors';
import type { DatabaseTenantSyncSnapshotSessionLimits } from './database-tenant-sync-snapshot-limits';
import type { DatabaseActorTenantSyncSnapshotBeginPayload } from './database-tenant-sync-snapshot-protocol';
import type { DatabaseTenantSyncSnapshotStorage } from './database-tenant-sync-snapshot-storage';

export interface DatabaseTenantSyncSnapshotMaterialization {
  readonly seq: number;
  readonly totalRows: number;
  readonly totalSourceBytes: number;
}

interface MaterializeDatabaseTenantSyncSnapshotOptions {
  readonly runtime: DatabaseRuntime;
  readonly catalog: DatabaseOperationCatalog;
  readonly storage: DatabaseTenantSyncSnapshotStorage;
  readonly payload: DatabaseActorTenantSyncSnapshotBeginPayload;
  readonly sessionId: string;
  readonly tableSelectionJson: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly activeSourceBytes: number;
  readonly limits: DatabaseTenantSyncSnapshotSessionLimits;
  readonly now: () => number;
}

export function materializeDatabaseTenantSyncSnapshot(
  options: MaterializeDatabaseTenantSyncSnapshotOptions,
): Readonly<DatabaseTenantSyncSnapshotMaterialization> {
  try {
    const materialized = options.runtime.db.readAtCurrentSequence(() => {
      let totalRows = 0;
      let totalSourceBytes = 0;
      for (
        let tableIndex = 0;
        tableIndex < options.payload.tables.length;
        tableIndex += 1
      ) {
        const table = options.payload.tables[tableIndex]!;
        const columns = options.catalog.columns?.[table];
        const primaryKey = options.catalog.primaryKeys?.[table];
        if (!columns?.length || !primaryKey) {
          throw databaseTenantSyncSnapshotSchemaMismatch();
        }
        const statement = options.runtime.db.prepare(
          `SELECT ${columns.map(quoteSqlIdentifier).join(', ')} `
          + `FROM main.${quoteSqlIdentifier(table)} `
          + `ORDER BY ${quoteSqlIdentifier(primaryKey)} COLLATE BINARY ASC`,
        );
        try {
          for (const candidate of statement.iterate() as Iterable<unknown>) {
            if (options.now() >= options.expiresAt) {
              throw databaseTenantSyncSnapshotExpired('deadline');
            }
            const encoded = encodeDatabaseTenantSyncSourceRow(
              candidate,
              columns,
              primaryKey,
              options.limits,
            );
            totalRows += 1;
            totalSourceBytes += encoded.sourceBytes;
            if (!Number.isSafeInteger(totalRows)
              || totalRows > options.limits.maxRows) {
              throw databaseTenantSyncSnapshotLimit('rows');
            }
            if (!Number.isSafeInteger(totalSourceBytes)
              || totalSourceBytes > options.limits.maxSourceBytes) {
              throw databaseTenantSyncSnapshotLimit('bytes');
            }
            if (options.activeSourceBytes + totalSourceBytes
              > options.limits.maxSourceBytes) {
              throw databaseTenantSyncSnapshotCapacity('bytes');
            }
            options.storage.insertRow({
              sessionId: options.sessionId,
              ordinal: totalRows - 1,
              tableIndex,
              ...encoded,
            });
          }
        } finally {
          statement.finalize();
        }
      }
      if (options.now() >= options.expiresAt) {
        throw databaseTenantSyncSnapshotExpired('deadline');
      }
      options.storage.insertSession({
        sessionId: options.sessionId,
        ownerToken: options.payload.ownerToken,
        generation: options.payload.generation,
        tableSelectionJson: options.tableSelectionJson,
        syncEpoch: options.runtime.db.syncEpoch,
        headSeq: options.runtime.db.currentSeq,
        createdAt: options.createdAt,
        expiresAt: options.expiresAt,
        totalRows,
        totalSourceBytes,
      });
      return { totalRows, totalSourceBytes };
    });
    return Object.freeze({
      seq: materialized.seq,
      totalRows: materialized.value.totalRows,
      totalSourceBytes: materialized.value.totalSourceBytes,
    });
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause;
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database tenant snapshot materialization failed.',
      { retryable: false, outcome: null, cause },
    );
  }
}
