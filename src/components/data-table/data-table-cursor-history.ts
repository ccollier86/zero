'use client';

/** Opaque per-query cursor history; never derives cursors from row data. */

import { useEffect, useRef } from 'react';
import type { DataTableServerPage } from './data-table-server-types';

/** Scope replacement or query changes retire every cursor from the previous result set. */
export function useDataTableCursorHistory(queryKey: string) {
  const history = useRef({ key: queryKey, cursors: new Map<number, string | null>([[0, null]]) });
  if (history.current.key !== queryKey) {
    history.current = { key: queryKey, cursors: new Map([[0, null]]) };
  }
  return history;
}

/** Record navigation tokens only from the currently accepted page. */
export function useDataTableAcceptedCursors(
  history: ReturnType<typeof useDataTableCursorHistory>,
  pageIndex: number,
  page: DataTableServerPage | null,
) {
  useEffect(() => {
    if (page?.mode !== 'cursor') return;
    if (page.hasMore && page.nextCursor != null) {
      history.current.cursors.set(pageIndex + 1, page.nextCursor);
    } else {
      for (const index of history.current.cursors.keys()) {
        if (index > pageIndex) history.current.cursors.delete(index);
      }
    }
    if (pageIndex > 0 && page.previousCursor != null) {
      history.current.cursors.set(pageIndex - 1, page.previousCursor);
    }
  }, [history, page, pageIndex]);
}
