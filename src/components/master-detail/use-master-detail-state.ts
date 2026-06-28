/**
 * use-master-detail-state.ts
 *
 * Owns live data resolution and selected-row state for master-detail views.
 * This hook consumes the frontend SDK client and pure selection helpers; it
 * does not render UI, build forms, or know table column presentation.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Row } from '../../sync/types';
import { useClientMaybe } from '../../frontend/client/client-context';
import { requireRowPrimaryKey } from '../data-table/row-identity';
import { resolveMasterDetailSelection } from './master-detail-selection';

const NOOP_UNSUBSCRIBE = () => {};
const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_ARRAY: never[] = [];

export interface MasterDetailLiveActions<T extends Row> {
  insert: (row: T) => void;
  update: (id: string, partial: Partial<T>) => void;
  remove: (id: string) => void;
  load: (rows: T[], options?: { replace?: boolean }) => void;
  clear: () => void;
}

export interface UseMasterDetailStateOptions<T extends Row> {
  data?: T[];
  collection?: string;
  primaryKey: string;
  selectedId?: string | null;
  defaultSelectedId?: string | null;
  autoSelectFirst?: boolean;
  onSelect?: (item: T) => void;
  onSelectedIdChange?: (id: string | null, item: T | null) => void;
}

export interface UseMasterDetailStateReturn<T extends Row> {
  data: T[];
  selectedId: string | null;
  selectedItem: T | null;
  selectedIndex: number;
  totalCount: number;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  selectRow: (row: T) => void;
  selectId: (id: string | null) => void;
  selectPrevious: () => void;
  selectNext: () => void;
  liveActions: MasterDetailLiveActions<T> | null;
}

/**
 * Return live collection data when `collection` is provided.
 *
 * This mirrors `useCollection` behavior without conditionally calling a hook,
 * allowing master-detail views to keep list and detail state in one place.
 */
function useOptionalLiveActions<T extends Row>(
  collection: string | undefined,
): { data: T[] | null; actions: MasterDetailLiveActions<T> | null } {
  const client = useClientMaybe();

  if (collection && !client && typeof window !== 'undefined') {
    throw new Error(
      'MasterDetailPage with collection must be used within <AppProvider> or <ClientProvider>.',
    );
  }

  const col = useMemo(
    () => collection && client ? client.collection<T>(collection) : null,
    [client, collection],
  );

  const subscribe = useCallback(
    (cb: () => void) => col ? col.subscribe(cb) : NOOP_UNSUBSCRIBE,
    [col],
  );

  const byId = useSyncExternalStore(
    subscribe,
    () => col ? col.getAll() : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const data = useMemo(
    () => col ? Object.values(byId) : null,
    [byId, col],
  );

  const insert = useCallback((row: T) => col?.insert(row), [col]);
  const update = useCallback(
    (id: string, partial: Partial<T>) => col?.update(id, partial),
    [col],
  );
  const remove = useCallback((id: string) => col?.remove(id), [col]);
  const load = useCallback(
    (rows: T[], options?: { replace?: boolean }) => col?.load(rows, options),
    [col],
  );
  const clear = useCallback(() => col?.clear(), [col]);

  const actions = useMemo<MasterDetailLiveActions<T> | null>(
    () => col ? { insert, update, remove, load, clear } : null,
    [clear, col, insert, load, remove, update],
  );

  return { data, actions };
}

/**
 * Resolve data and selection state for a master-detail component.
 *
 * Supports static rows, a live collection name, controlled selection, and
 * uncontrolled selection with optional first-row auto-selection.
 */
export function useMasterDetailState<T extends Row>({
  data: dataProp,
  collection,
  primaryKey,
  selectedId: selectedIdProp,
  defaultSelectedId,
  autoSelectFirst = true,
  onSelect,
  onSelectedIdChange,
}: UseMasterDetailStateOptions<T>): UseMasterDetailStateReturn<T> {
  const live = useOptionalLiveActions<T>(collection);
  const data = live.data ?? dataProp ?? (EMPTY_ARRAY as T[]);
  const isControlled = selectedIdProp !== undefined;
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    defaultSelectedId ?? null,
  );

  const selection = useMemo(
    () => resolveMasterDetailSelection(
      data,
      primaryKey,
      isControlled ? selectedIdProp : internalSelectedId,
      !isControlled && autoSelectFirst,
    ),
    [autoSelectFirst, data, internalSelectedId, isControlled, primaryKey, selectedIdProp],
  );

  useEffect(() => {
    if (isControlled || selection.selectedId === internalSelectedId) return;

    setInternalSelectedId(selection.selectedId);
    onSelectedIdChange?.(selection.selectedId, selection.selectedItem);
  }, [
    internalSelectedId,
    isControlled,
    onSelectedIdChange,
    selection.selectedId,
    selection.selectedItem,
  ]);

  const commitSelection = useCallback(
    (id: string | null, item: T | null) => {
      if (!isControlled) setInternalSelectedId(id);
      onSelectedIdChange?.(id, item);
      if (item) onSelect?.(item);
    },
    [isControlled, onSelect, onSelectedIdChange],
  );

  const selectRow = useCallback(
    (row: T) => {
      commitSelection(requireRowPrimaryKey(row, primaryKey), row);
    },
    [commitSelection, primaryKey],
  );

  const selectId = useCallback(
    (id: string | null) => {
      const next = resolveMasterDetailSelection(data, primaryKey, id, false);
      commitSelection(next.selectedId, next.selectedItem);
    },
    [commitSelection, data, primaryKey],
  );

  const selectPrevious = useCallback(() => {
    if (selection.selectedIndex > 0) {
      selectRow(data[selection.selectedIndex - 1]!);
    }
  }, [data, selectRow, selection.selectedIndex]);

  const selectNext = useCallback(() => {
    if (selection.selectedIndex >= 0 && selection.selectedIndex < data.length - 1) {
      selectRow(data[selection.selectedIndex + 1]!);
    }
  }, [data, selectRow, selection.selectedIndex]);

  return {
    data,
    selectedId: selection.selectedId,
    selectedItem: selection.selectedItem,
    selectedIndex: selection.selectedIndex,
    totalCount: data.length,
    canSelectPrevious: selection.selectedIndex > 0,
    canSelectNext: selection.selectedIndex >= 0 && selection.selectedIndex < data.length - 1,
    selectRow,
    selectId,
    selectPrevious,
    selectNext,
    liveActions: live.actions,
  };
}
