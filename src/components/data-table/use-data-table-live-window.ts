'use client';

/** Binds complete-source live buffering to the same row data used by controls, selection and actions. */
import * as React from 'react';
import { createTable, getCoreRowModel, getFilteredRowModel, getSortedRowModel } from '@tanstack/react-table';
import type { Row } from '../../sync/types';
import { createDataTableColumns } from './data-table-columns';
import { dataTableStableIds, reconcileDataTableLiveWindow, type DataTableLiveWindowState } from './data-table-live-window';
import type { DataTableProps } from './data-table-types';
import type { DataTableState } from './data-table-state';
import { DATA_TABLE_MOTION } from './data-table-motion-tokens';
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Complete datasets can identify real additions; server/lazy windows require explicit insert evidence. */
export function useDataTableLiveWindow<T extends Row>(options: {
  props: DataTableProps<T>; data: T[]; sourceType: string; boundary: string;
  criteria: string; state: DataTableState; primaryKey: string; loading: boolean;
  insertedRowIds?: readonly string[];
  confirmedInsertedRowIds?: readonly string[];
  clearConfirmedInsertions?: () => void;
}) {
  const { props, data, boundary, criteria, state: interaction, primaryKey, loading } = options;
  const complete = options.sourceType === 'data' || options.sourceType === 'collection';
  const server = options.sourceType === 'server';
  const enabled = (complete || server) && props.liveUpdates !== false;
  const [busy, setBusy] = React.useState(false);
  const [scrolledAway, setScrolledAway] = React.useState(false);
  const getId = React.useCallback((row: T) => {
    const id = props.source?.type === 'server' && props.source.getRowId ? props.source.getRowId(row, 0) : row[primaryKey];
    return typeof id === 'string' && id.length > 0 || typeof id === 'number' && Number.isFinite(id) ? String(id) : null;
  }, [primaryKey, props.source?.type === 'server' ? props.source.getRowId : undefined]);
  const stable = React.useMemo(() => dataTableStableIds(data, getId) !== null, [data, getId]);
  const allMatching = React.useMemo(() => {
    if (!enabled || !stable) return null;
    if (server) return data.map(row => ({ id: getId(row)! }));
    const columns = createDataTableColumns<T>({ schema: props.schema, columns: props.columns,
      columnOverrides: props.columnOverrides, sortable: props.sortable,
      searchableFields: typeof props.searchable === 'object' ? props.searchable.fields : undefined });
    const table = createTable<T>({ data, columns, state: interaction, onStateChange: () => {}, renderFallbackValue: null,
      getRowId: (row, index) => getId(row) ?? String(index),
      getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel() });
    return table.getSortedRowModel().rows;
  }, [enabled, stable, server, data, props.schema, props.columns, props.columnOverrides, props.sortable,
    props.searchable, interaction.globalFilter, interaction.columnFilters, interaction.sorting, getId]);
  const [window, setWindow] = React.useState<DataTableLiveWindowState<T> | null>(null);
  const inputChanged = window?.boundary !== boundary || window.criteria !== criteria || window.input !== data
    || window.evidence !== (options.sourceType === 'data' ? undefined : options.insertedRowIds)
    || window.confirmedEvidence !== options.confirmedInsertedRowIds
    || window.baselineReady !== !loading && !window.baselineReady
    || window.held.size > 0 && interaction.pagination.pageIndex === 0 && !scrolledAway && !busy;
  let current = window;
  if (inputChanged || !enabled && window?.held.size) {
    current = reconcileDataTableLiveWindow(window, { boundary, criteria, data,
      orderedMatchingIds: allMatching?.map(row => row.id) ?? [], getId, enabled: enabled && stable, loading,
      insertedRowIds: options.sourceType === 'data' ? undefined : options.insertedRowIds,
      confirmedInsertedRowIds: server ? options.confirmedInsertedRowIds : undefined,
      pageIndex: interaction.pagination.pageIndex, pageSize: interaction.pagination.pageSize, scrolledAway, busy });
    setWindow(current);
  }
  const held = current?.held ?? new Set<string>();
  const freshRowIds = enabled ? current?.fresh ?? EMPTY_IDS : EMPTY_IDS;
  React.useEffect(() => {
    if (![...freshRowIds].some(id => !held.has(id))) return;
    const timer = setTimeout(() => setWindow(value => value?.boundary === boundary
      ? { ...value, fresh: new Set([...value.fresh].filter(id => value.held.has(id))) } : value), DATA_TABLE_MOTION.highlight);
    return () => clearTimeout(timer);
  }, [freshRowIds, held, boundary]);
  const visibleData = React.useMemo(() => held.size ? data.filter(row => !held.has(getId(row)!)) : data, [data, held, getId]);
  const reveal = React.useCallback(() => setWindow(value => value?.boundary === boundary
    ? { ...value, held: new Set(), releasedInserts: new Set([...value.releasedInserts, ...value.held].slice(-1_000)) } : value), [boundary]);
  const matchingIds = new Set([...(allMatching?.map(row => row.id) ?? []), ...(server ? options.confirmedInsertedRowIds ?? [] : [])]);
  const newCount = [...held].reduce((count, id) => count + Number(matchingIds.has(id)), 0);
  React.useEffect(() => {
    if (server && (props.liveUpdates === false || interaction.pagination.pageIndex === 0 && !scrolledAway && !busy && !loading)
      && options.confirmedInsertedRowIds?.length) options.clearConfirmedInsertions?.();
  }, [server, props.liveUpdates, interaction.pagination.pageIndex, scrolledAway, busy, loading,
    options.confirmedInsertedRowIds, options.clearConfirmedInsertions]);
  return { data: visibleData, freshRowIds, newCount, reveal, setBusy, setScrolledAway,
    stableIdentity: stable, totalCount: complete && held.size ? allMatching?.length : undefined,
    unfilteredTotal: complete ? data.length : undefined };
}
