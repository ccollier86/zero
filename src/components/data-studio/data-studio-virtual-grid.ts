'use client';

/** TanStack row virtualization with focus/selection retention; does not query or paginate data. */
import * as React from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';

export const DATA_STUDIO_GRID_ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;

export function useDataStudioVirtualGrid(
  rootRef: React.RefObject<HTMLDivElement | null>, count: number,
  selectedIndex: number, identity: string | undefined,
) {
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null);
  const [pendingFocus, setPendingFocus] = React.useState<{ row: number; column: number } | null>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count, getScrollElement: () => rootRef.current,
    estimateSize: () => DATA_STUDIO_GRID_ROW_HEIGHT,
    overscan: 6, scrollMargin: HEADER_HEIGHT, scrollPaddingStart: HEADER_HEIGHT,
    initialRect: { width: 800, height: 440 }, useFlushSync: false,
    rangeExtractor(range) {
      const indices = new Set(defaultRangeExtractor(range));
      if (focusedIndex !== null && focusedIndex < count) indices.add(focusedIndex);
      if (selectedIndex >= 0 && selectedIndex < count) indices.add(selectedIndex);
      return [...indices].sort((a, b) => a - b);
    },
  });
  React.useEffect(() => {
    const root = rootRef.current;
    if (root) root.scrollTop = 0;
    setFocusedIndex(null); setPendingFocus(null);
  }, [identity, rootRef]);
  React.useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer]);
  React.useLayoutEffect(() => {
    if (!pendingFocus) return;
    const cell = rootRef.current?.querySelector<HTMLButtonElement>(
      `[data-row-index="${pendingFocus.row}"][data-column-index="${pendingFocus.column}"] [data-data-studio-cell="true"]`);
    if (cell && !cell.disabled) { cell.focus(); setPendingFocus(null); }
  }, [pendingFocus, rootRef]);
  return {
    indices: virtualizer.getVirtualItems().map((item) => item.index),
    onFocusRow: setFocusedIndex,
    navigate(row: number, column: number) {
      virtualizer.scrollToIndex(row, { align: 'auto' });
      setPendingFocus({ row, column }); setFocusedIndex(row);
    },
  };
}
