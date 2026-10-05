/** Primary-key and natural-identity record composition; paged queries own a separate hook. */
import { useCallback, useMemo, useRef } from "react";
import type { IdentityKey } from "../../sync/identity";
import type { InsertInput } from "../../schema/infer";
import type { Row } from "../../sync/types";
import { useClientMaybe } from "./client-context";
import { useAuthorizationScopeBoundary } from "./authorization-scope-hooks";
import { useCollection, useRow } from "./data-hooks";
export { useDataPage } from "./data-page-hooks";
export type { DataPageOptions, DataPageResult } from "./data-page-hooks";
export { buildDataPageQuery } from "./query-params";
export type { DataFilterExpression, DataFilterOperator, DataFilterPrimitive, DataFilterValue, DataPageFilters, DataPageInfo, DataPageSort } from "./query-params";

export interface RecordResult<T extends Row> {
  row: T | null;
  exists: boolean;
  update: (partial: Partial<T>) => void;
  remove: () => void;
}

/**
 * Compose `useRow()` and collection mutation helpers for one primary-key row.
 */
export function useRecord<T extends Row = Row>(table: string, id: string | null): RecordResult<T> {
  const row = useRow<T>(table, id ?? '');
  const collection = useCollection<T>(table);

  const update = useCallback(
    (partial: Partial<T>) => {
      if (id) collection.update(id, partial);
    },
    [collection.update, id],
  );

  const remove = useCallback(() => {
    if (id) collection.remove(id);
  }, [collection.remove, id]);

  return {
    row: id ? row : null,
    exists: !!id && row !== null,
    update,
    remove,
  };
}

export interface IdentityRecordResult<T extends Row> {
  row: T | null;
  id: string | null;
  exists: boolean;
  upsert: (row: InsertInput<T>) => void;
  update: (partial: Partial<T>) => void;
  remove: () => void;
}

/**
 * Compose natural-identity lookup and mutation helpers for relational tables.
 *
 * This uses Zero's deterministic natural identity support while preserving the
 * single-column sync primary key invariant.
 */
export function useRecordByIdentity<T extends Row = Row>(
  table: string,
  identity: IdentityKey | null,
): IdentityRecordResult<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const collection = useMemo(() => client?.collection<T>(table) ?? null, [client, table]);
  const data = useCollection<T>(table);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const canUseScope = useCallback(
    () => boundaryReadyRef.current && boundaryKeyRef.current === callbackBoundaryKey,
    [callbackBoundaryKey],
  );
  const identityKey = useMemo(
    () => authorizationBoundary.ready && identity && collection
      ? collection.identityKey(identity)
      : null,
    [authorizationBoundary.ready, collection, identity],
  );
  const row = useMemo(
    () => authorizationBoundary.ready && identity && collection
      ? collection.getByIdentity(identity)
      : null,
    [authorizationBoundary.ready, collection, data.byId, identity],
  );

  const upsert = useCallback((nextRow: InsertInput<T>) => {
    if (canUseScope()) collection?.upsertByIdentity(nextRow);
  }, [canUseScope, collection]);

  const update = useCallback((partial: Partial<T>) => {
    if (canUseScope() && identity) collection?.updateByIdentity(identity, partial);
  }, [canUseScope, collection, identity]);

  const remove = useCallback(() => {
    if (canUseScope() && identity) collection?.deleteByIdentity(identity);
  }, [canUseScope, collection, identity]);

  return {
    row,
    id: identityKey,
    exists: row !== null,
    upsert,
    update,
    remove,
  };
}
