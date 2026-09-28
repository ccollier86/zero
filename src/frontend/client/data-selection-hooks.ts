/**
 * data-selection-hooks.ts
 *
 * Provides reusable row/item selection state for Zero data views. This file
 * owns selection bookkeeping only; it does not fetch data, mutate records, or
 * render table/detail UI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';

export type DataSelectionMode = 'single' | 'multiple';

export interface UseDataSelectionOptions<T> {
  mode?: DataSelectionMode;
  initialIds?: Iterable<string>;
  getId?: (item: T) => string;
  onChange?: (ids: string[]) => void;
}

export interface UseDataSelectionReturn<T> {
  selectedIds: string[];
  selectedId: string | null;
  selectedItems: T[];
  count: number;
  hasSelection: boolean;
  isSelected: (idOrItem: string | T) => boolean;
  select: (idOrItem: string | T) => void;
  selectOnly: (idOrItem: string | T | null) => void;
  deselect: (idOrItem: string | T) => void;
  toggle: (idOrItem: string | T) => void;
  clear: () => void;
  setSelectedIds: (ids: Iterable<string>) => void;
}

function defaultGetId<T>(item: T): string {
  const value = item as Record<string, unknown>;
  const id = value.id ?? value._id;
  if (typeof id !== 'string') {
    throw new Error('useDataSelection requires getId when items do not expose a string id field.');
  }
  return id;
}

/**
 * Manage selected row/item ids for data tables and detail views.
 *
 * The hook accepts the current rows so `selectedItems` stays aligned when
 * filters, pages, or live data updates change the visible dataset.
 */
export function useDataSelection<T>(
  items: readonly T[],
  options: UseDataSelectionOptions<T> = {},
): UseDataSelectionReturn<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const mode = options.mode ?? 'multiple';
  const getId = options.getId ?? defaultGetId<T>;
  const [selectedSet, setSelectedSet] = useState<Set<string>>(
    () => new Set(options.initialIds ?? []),
  );
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  useEffect(() => {
    setLoadedBoundaryKey(authorizationBoundary.key);
    setSelectedSet(authorizationBoundary.ready
      ? new Set(options.initialIds ?? [])
      : new Set());
  }, [authorizationBoundary.key, authorizationBoundary.ready]);

  const commit = useCallback(
    (next: Set<string>) => {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== callbackBoundaryKey) return;
      const nextIds = [...next];
      setSelectedSet(next);
      options.onChange?.(nextIds);
    },
    [callbackBoundaryKey, options.onChange],
  );

  const toId = useCallback(
    (idOrItem: string | T) => typeof idOrItem === 'string' ? idOrItem : getId(idOrItem),
    [getId],
  );

  const setSelectedIds = useCallback(
    (ids: Iterable<string>) => {
      const next = [...ids];
      commit(new Set(mode === 'single' ? next.slice(0, 1) : next));
    },
    [commit, mode],
  );

  const selectOnly = useCallback(
    (idOrItem: string | T | null) => {
      commit(idOrItem === null ? new Set() : new Set([toId(idOrItem)]));
    },
    [commit, toId],
  );

  const select = useCallback(
    (idOrItem: string | T) => {
      const id = toId(idOrItem);
      if (mode === 'single') {
        commit(new Set([id]));
        return;
      }
      const next = new Set(selectedSet);
      next.add(id);
      commit(next);
    },
    [commit, mode, selectedSet, toId],
  );

  const deselect = useCallback(
    (idOrItem: string | T) => {
      const next = new Set(selectedSet);
      next.delete(toId(idOrItem));
      commit(next);
    },
    [commit, selectedSet, toId],
  );

  const toggle = useCallback(
    (idOrItem: string | T) => {
      const id = toId(idOrItem);
      if (selectedSet.has(id)) {
        deselect(id);
      } else {
        select(id);
      }
    },
    [deselect, select, selectedSet, toId],
  );

  const clear = useCallback(() => {
    commit(new Set());
  }, [commit]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  const isSelected = useCallback(
    (idOrItem: string | T) => visible && selectedSet.has(toId(idOrItem)),
    [selectedSet, toId, visible],
  );
  const selectedIds = useMemo(
    () => visible ? [...selectedSet] : [],
    [selectedSet, visible],
  );
  const selectedItems = useMemo(
    () => visible ? items.filter((item) => selectedSet.has(getId(item))) : [],
    [getId, items, selectedSet, visible],
  );

  return {
    selectedIds,
    selectedId: selectedIds[0] ?? null,
    selectedItems,
    count: selectedIds.length,
    hasSelection: selectedIds.length > 0,
    isSelected,
    select,
    selectOnly,
    deselect,
    toggle,
    clear,
    setSelectedIds,
  };
}
