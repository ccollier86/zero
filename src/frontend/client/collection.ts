/**
 * collection.ts
 *
 * Client-side typed table collections. This file owns local collection reads,
 * optimistic collection writes, and natural-identity convenience methods.
 */

import {
  createIdentityId,
  ensureRowSyncPrimaryKey,
  getIdentityValues,
  hasIdentity,
  type IdentityKey,
  withIdentityPrimaryKey,
} from '../../sync/identity';
import type { SyncClient } from '../../sync/client/sync-client';
import type { ClientTableDef, Row } from '../../sync/types';

export interface Collection<T extends Row = Row> {
  /** Table name. */
  readonly name: string;

  /** Get all rows as a map of id to row. */
  getAll(): Record<string, T>;

  /** Get a single row by primary key. */
  getOne(id: string): T | null;

  /** Get rows matching a filter function. */
  getMany(filter: (row: T) => boolean): T[];

  /** Count of all rows. */
  count(): number;

  /** Optimistic insert; applied locally and synced to the server. */
  insert(row: T): void;

  /** Return the deterministic sync id for a natural identity key. */
  identityKey(key: IdentityKey): string;

  /** Get a single local row by natural identity. */
  getByIdentity(key: IdentityKey): T | null;

  /** Optimistic insert/update by natural identity. */
  upsertByIdentity(row: T): void;

  /** Optimistic update by natural identity. */
  updateByIdentity(key: IdentityKey, partial: Partial<T>): void;

  /** Optimistic delete by natural identity. */
  deleteByIdentity(key: IdentityKey): void;

  /** Optimistic update by sync primary key. */
  update(id: string, partial: Partial<T>): void;

  /** Optimistic delete by sync primary key. */
  remove(id: string): void;

  /** Subscribe to all changes in this table. Returns unsubscribe. */
  subscribe(callback: (rows: Record<string, T>) => void): () => void;

  /** Subscribe to a single row. Returns unsubscribe. */
  subscribeOne(id: string, callback: (row: T | null) => void): () => void;

  /**
   * Bulk-load rows into the reactive store.
   *
   * Lazy tables use this after REST fetches so hooks such as `useQuery` can
   * observe demand-loaded data without requiring full-table websocket snapshots.
   */
  load(rows: T[], options?: { replace?: boolean }): void;

  /** Clear all rows from this table in the local store without deleting server rows. */
  clear(): void;
}

/**
 * Create a table collection bound to one SyncClient and table definition.
 */
export function createCollection<T extends Row>(
  name: string,
  syncClient: SyncClient,
  tableDef: ClientTableDef,
): Collection<T> {
  const store = syncClient.store;
  const primaryKey = tableDef._pk;

  function getTableData(): Record<string, T> {
    const ctx = store.getSnapshot().context as Record<string, unknown>;
    return (ctx[name] as Record<string, T>) ?? {};
  }

  function getIdentityFields(): readonly string[] {
    if (!hasIdentity(tableDef._identity)) {
      throw new Error(`[client] Table "${name}" does not define a natural identity.`);
    }
    return tableDef._identity;
  }

  function identityKey(key: IdentityKey): string {
    return createIdentityId(name, getIdentityFields(), key);
  }

  function withCollectionPrimaryKey(row: T): T {
    return ensureRowSyncPrimaryKey(name, tableDef, row);
  }

  function withNaturalIdentityPrimaryKey(row: T): T {
    return withIdentityPrimaryKey(name, primaryKey, getIdentityFields(), row);
  }

  function assertIdentityPatchMatchesKey(key: IdentityKey, partial: Partial<T>): void {
    for (const field of getIdentityFields()) {
      if (!(field in partial)) continue;
      if ((partial as Row)[field] !== key[field]) {
        throw new Error(`[client] Cannot change identity field "${field}" through updateByIdentity().`);
      }
    }
  }

  function findIdentityEntry(key: IdentityKey): [string, T] | null {
    const fields = getIdentityFields();
    const expected = getIdentityValues(fields, key);
    const deterministicId = createIdentityId(name, fields, key);
    const rows = getTableData();
    const direct = rows[deterministicId];
    if (direct) return [deterministicId, direct];

    for (const [id, row] of Object.entries(rows)) {
      if (fields.every((field, index) => row[field] === expected[index])) {
        return [id, row];
      }
    }

    return null;
  }

  function toIdentityUpdate(row: T): Partial<T> {
    const partial = { ...row } as Record<string, unknown>;
    delete partial[primaryKey];
    return partial as Partial<T>;
  }

  return {
    get name() { return name; },

    getAll(): Record<string, T> {
      return getTableData();
    },

    getOne(id: string): T | null {
      return getTableData()[id] ?? null;
    },

    getMany(filter: (row: T) => boolean): T[] {
      return Object.values(getTableData()).filter(filter);
    },

    count(): number {
      return Object.keys(getTableData()).length;
    },

    insert(row: T): void {
      syncClient.insert(name, withCollectionPrimaryKey(row));
    },

    identityKey,

    getByIdentity(key: IdentityKey): T | null {
      return findIdentityEntry(key)?.[1] ?? null;
    },

    upsertByIdentity(row: T): void {
      const existing = findIdentityEntry(row);
      if (existing) {
        syncClient.update(name, existing[0], toIdentityUpdate(row));
        return;
      }

      syncClient.insert(name, withNaturalIdentityPrimaryKey(row));
    },

    updateByIdentity(key: IdentityKey, partial: Partial<T>): void {
      assertIdentityPatchMatchesKey(key, partial);
      syncClient.update(name, findIdentityEntry(key)?.[0] ?? identityKey(key), partial);
    },

    deleteByIdentity(key: IdentityKey): void {
      syncClient.delete(name, findIdentityEntry(key)?.[0] ?? identityKey(key));
    },

    update(id: string, partial: Partial<T>): void {
      syncClient.update(name, id, partial);
    },

    remove(id: string): void {
      syncClient.delete(name, id);
    },

    subscribe(callback: (rows: Record<string, T>) => void): () => void {
      let prev = getTableData();
      const sub = store.subscribe(() => {
        const next = getTableData();
        if (next !== prev) {
          prev = next;
          callback(next);
        }
      });
      return () => sub.unsubscribe();
    },

    subscribeOne(id: string, callback: (row: T | null) => void): () => void {
      let prev = getTableData()[id] ?? null;
      const sub = store.subscribe(() => {
        const next = getTableData()[id] ?? null;
        if (next !== prev) {
          prev = next;
          callback(next);
        }
      });
      return () => sub.unsubscribe();
    },

    load(rows: T[], options?: { replace?: boolean }): void {
      const keyed: Record<string, Row> = {};
      for (const row of rows) {
        const nextRow = withCollectionPrimaryKey(row);
        keyed[String(nextRow[primaryKey])] = nextRow;
      }
      store.send({
        type: 'sync.load' as const,
        table: name,
        rows: keyed,
        replace: options?.replace ?? false,
      });
    },

    clear(): void {
      store.send({
        type: 'sync.load' as const,
        table: name,
        rows: {} as Record<string, Row>,
        replace: true,
      });
    },
  };
}
