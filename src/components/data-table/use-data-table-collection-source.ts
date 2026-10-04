'use client';

/** Reactive collection binding shared by collection, lazy, and server tables. */

import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../frontend/client/authorization-scope-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { Row } from '../../sync/types';
import type { DataTableSourceActions } from './data-table-source';
import { invokeDataTableSourceWrite } from './data-table-source-action-guard';

const NOOP_UNSUBSCRIBE = () => {};
const EMPTY_RECORD: Record<string, never> = {};

export interface OptionalDataTableCollection<T extends Row> {
  data: T[] | null;
  actions: DataTableSourceActions<T> | null;
}

export function useOptionalDataTableCollection<T extends Row>(
  table: string | null,
): OptionalDataTableCollection<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const isCurrentScope = useCallback(
    () => isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    ),
    [callbackBoundaryKey],
  );

  if (table && !client && typeof window !== 'undefined') {
    throw new Error(
      'DataTable with a collection or lazy source must be used within <AppProvider> or <ClientProvider>.',
    );
  }

  const collection = useMemo(
    () => table && client ? client.collection<T>(table) : null,
    [client, table],
  );

  const subscribe = useCallback(
    (callback: () => void) => authorizationBoundary.ready && collection
      ? collection.subscribe(callback)
      : NOOP_UNSUBSCRIBE,
    [authorizationBoundary.key, authorizationBoundary.ready, collection],
  );

  const byId = useSyncExternalStore(
    subscribe,
    () => authorizationBoundary.ready && collection
      ? collection.getAll()
      : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const rows = useMemo(
    () => authorizationBoundary.ready && collection ? Object.values(byId) : null,
    [authorizationBoundary.ready, byId, collection],
  );

  const insert = useCallback((row: T, options?: { signal?: AbortSignal }) => {
    return invokeDataTableSourceWrite(
      'insert',
      isCurrentScope(),
      collection ? () => collection.insertAsync(row, options) : undefined,
    );
  }, [collection, isCurrentScope]);
  const update = useCallback(
    (id: string, partial: Partial<T>, options?: { signal?: AbortSignal }) => {
      return invokeDataTableSourceWrite(
        'update',
        isCurrentScope(),
        collection ? () => collection.updateAsync(id, partial, options) : undefined,
      );
    },
    [collection, isCurrentScope],
  );
  const remove = useCallback((id: string, options?: { signal?: AbortSignal }) => {
    return invokeDataTableSourceWrite(
      'remove',
      isCurrentScope(),
      collection ? () => collection.removeAsync(id, options) : undefined,
    );
  }, [collection, isCurrentScope]);
  const load = useCallback(
    (nextRows: T[], options?: { replace?: boolean }) => {
      if (isCurrentScope()) collection?.load(nextRows, options);
    },
    [collection, isCurrentScope],
  );
  const clear = useCallback(() => {
    if (isCurrentScope()) collection?.clear();
  }, [collection, isCurrentScope]);

  const actions = useMemo<DataTableSourceActions<T> | null>(
    () => collection ? { insert, update, remove, load, clear } : null,
    [clear, collection, insert, load, remove, update],
  );

  return { data: rows, actions };
}
