'use client';

/**
 * use-data-studio-reconciliation.ts
 *
 * Bridges read-only Zero Sync invalidations into bounded HTTP reconciliation.
 * Subscriptions are authorization-scoped and never issue mutation writes.
 */

import * as React from 'react';
import type { AuthorizationScopeBoundary } from './authorization-scope-hooks';
import type {
  DataStudioRowPage,
  DataStudioRowQuery,
  DataStudioSdkSurface,
  DataStudioTableStatus,
} from './data-studio-client';

export function useDataStudioReconciliation(input: {
  readonly surface: DataStudioSdkSurface | null;
  readonly boundary: AuthorizationScopeBoundary;
  readonly scopeAvailable: boolean;
  readonly canRead: boolean;
  readonly boundaryKeyRef: React.MutableRefObject<string>;
  readonly boundaryReadyRef: React.MutableRefObject<boolean>;
  readonly selectedTableIdRef: React.MutableRefObject<string | null>;
  readonly activeRowQueryRef: React.MutableRefObject<DataStudioRowQuery>;
  readonly tableStatusRef: React.MutableRefObject<DataStudioTableStatus | 'all'>;
  readonly loadCatalogRef: React.MutableRefObject<() => Promise<void>>;
  readonly loadTableRef: React.MutableRefObject<() => Promise<void>>;
  readonly loadRowsRef: React.MutableRefObject<() => Promise<DataStudioRowPage | void>>;
  readonly refreshTableAfterMutation: (
    tableId: string,
    expectedScopeKey: string,
  ) => Promise<void>;
}): void {
  React.useEffect(() => {
    if (!input.surface || !input.scopeAvailable || !input.boundary.ready || !input.canRead) return;
    const syncSurface = input.surface;
    const expectedScopeKey = input.boundary.key;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let catalogDirty = false;
    let rowsDirty = false;
    const catalogTableIds = new Set<string>();
    const rowTableIds = new Set<string>();

    const unsubscribe = syncSurface.subscribeReconciliation((event) => {
      if (!isCurrent()) return;
      if (event.kind === 'catalog') {
        catalogDirty = true;
        for (const tableId of event.tableIds) catalogTableIds.add(tableId);
      } else {
        rowsDirty = true;
        for (const tableId of event.tableIds) rowTableIds.add(tableId);
      }
      schedule();
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      unsubscribe();
    };

    function schedule(): void {
      if (timer || disposed) return;
      // One transaction can emit catalog row-count and logical-row changes.
      timer = setTimeout(() => {
        timer = null;
        void reconcile();
      }, 25);
    }

    async function reconcile(): Promise<void> {
      if (!isCurrent()) return;
      const refreshCatalog = catalogDirty;
      const refreshRows = rowsDirty;
      const changedCatalogTables = new Set(catalogTableIds);
      const changedRowTables = new Set(rowTableIds);
      catalogDirty = false;
      rowsDirty = false;
      catalogTableIds.clear();
      rowTableIds.clear();

      const selectedTableId = input.selectedTableIdRef.current;
      let selectedStillVisible = true;
      let catalogRowsTableId: string | null = null;
      if (refreshCatalog) {
        await input.loadCatalogRef.current();
        if (!isCurrent()) return;
        const summary = selectedTableId
          ? syncSurface.cache.getSnapshot().tables.find((table) =>
              table.tableId === selectedTableId)
          : undefined;
        selectedStillVisible = summary !== undefined
          && (input.tableStatusRef.current === 'all'
            || summary.status === input.tableStatusRef.current);
        const selectedCatalogChanged = selectedStillVisible
          && (changedCatalogTables.size === 0 || changedCatalogTables.has(selectedTableId!));
        if (selectedCatalogChanged) {
          catalogRowsTableId = selectedTableId;
          await input.loadTableRef.current();
        }
      }

      if (!isCurrent()) return;
      const activeTableId = input.selectedTableIdRef.current;
      const activeRowsChanged = refreshRows && (changedRowTables.size === 0
        || (activeTableId !== null && changedRowTables.has(activeTableId)));
      if (activeTableId && selectedStillVisible
        && (activeRowsChanged || catalogRowsTableId === activeTableId)) {
        syncSurface.invalidateRows(activeTableId, input.activeRowQueryRef.current);
        await Promise.all([
          input.loadRowsRef.current(),
          input.refreshTableAfterMutation(activeTableId, expectedScopeKey),
        ]);
      }
    }

    function isCurrent(): boolean {
      return !disposed
        && input.boundaryReadyRef.current
        && input.boundaryKeyRef.current === expectedScopeKey
        && syncSurface.cache.getSnapshot().scopeKey === expectedScopeKey;
    }
  }, [
    input.boundary.key,
    input.boundary.ready,
    input.canRead,
    input.refreshTableAfterMutation,
    input.scopeAvailable,
    input.surface,
  ]);
}
