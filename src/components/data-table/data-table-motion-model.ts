/** Pure presentation identity reconciliation; never changes queries, selections, source rows or authority. */
import type { Row as TableRow } from '@tanstack/react-table';

export interface DataTableMotionRow<T> { readonly row: TableRow<T>; readonly leaving: boolean }
export interface DataTableMotionTarget { readonly queryKey: string; readonly pageIndex: number; readonly pageSize: number }

/** Criteria/size replacements take priority over any pending page navigation. */
export function dataTableMotionTargetChange(previous: DataTableMotionTarget, next: DataTableMotionTarget): 'query' | 'page' | null {
  if (previous.queryKey !== next.queryKey || previous.pageSize !== next.pageSize) return 'query';
  return previous.pageIndex !== next.pageIndex ? 'page' : null;
}

/** Keep one React descriptor per identity; re-entry makes an existing leaver live again. */
export function reconcileDataTableMotionRows<T>(next: readonly TableRow<T>[], previous: readonly DataTableMotionRow<T>[], retain = true): DataTableMotionRow<T>[] {
  const ids = new Set(next.map(row => row.id));
  return [...next.map(row => ({ row, leaving: false })), ...(retain ? previous.filter(item => !ids.has(item.row.id)).map(item => ({ row: item.row, leaving: true })) : [])];
}

/** TanStack may recreate wrappers while retaining the same immutable original records. */
export function dataTableMotionRowsMatch<T>(previous: readonly DataTableMotionRow<T>[], next: readonly TableRow<T>[]): boolean {
  const live = previous.filter(item => !item.leaving);
  return live.length === next.length && live.every((item, index) => item.row.id === next[index]!.id && item.row.original === next[index]!.original);
}
