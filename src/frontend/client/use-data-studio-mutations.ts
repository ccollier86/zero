'use client';

/**
 * use-data-studio-mutations.ts
 *
 * Owns capability-gated Data Studio mutation workflows, idempotency tracking,
 * and authoritative post-write refreshes.
 */

import * as React from 'react';
import {
  dataStudioRowValuesByKey,
  type DataStudioMutationError,
  type DataStudioRow,
  type DataStudioRowPage,
  type DataStudioSchema,
  type DataStudioSdkSurface,
  type DataStudioTable,
  type DataStudioTableCreate,
  type DataStudioTableStatus,
  type DataStudioTableUpdate,
  type DataStudioValue,
} from './data-studio-client';
import type { DataStudioAccess } from './data-studio-controller-types';
import { toDataStudioError } from './data-studio-controller-types';
import { canonicalizeDataStudioMutationInput } from './data-studio-mutation-key';
import type { DataStudioOperationTracker } from './data-studio-operation-tracker';
import {
  reportDataStudioFrontendFailure,
  type DataStudioFrontendOperation,
} from './data-studio-observability';

const POST_MUTATION_REFRESH_TIMEOUT_MS = 10_000;

interface PostMutationReconciliation {
  readonly afterSuccess?: readonly (() => Promise<unknown>)[];
  readonly afterFailure?: readonly (() => Promise<unknown>)[];
}

export function useDataStudioMutations(input: {
  readonly surface: DataStudioSdkSurface | null;
  readonly access: DataStudioAccess;
  readonly selectedTable: DataStudioTable | null;
  readonly selectedRow: DataStudioRow | null;
  readonly tableStatus: DataStudioTableStatus | 'all';
  readonly boundaryKey: string;
  readonly boundaryKeyRef: React.MutableRefObject<string>;
  readonly boundaryReadyRef: React.MutableRefObject<boolean>;
  readonly selectedTableIdRef: React.MutableRefObject<string | null>;
  readonly operationTracker: React.MutableRefObject<DataStudioOperationTracker>;
  readonly setPendingMutations: React.Dispatch<React.SetStateAction<number>>;
  readonly setMutationError: React.Dispatch<
    React.SetStateAction<DataStudioMutationError | Error | null>
  >;
  readonly setCatalogError: React.Dispatch<React.SetStateAction<Error | null>>;
  readonly setTableStatusState: React.Dispatch<
    React.SetStateAction<DataStudioTableStatus | 'all'>
  >;
  readonly setSelectedTableId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setSelectedRowId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly refreshRowsAfterMutation: (
    tableId: string,
    expectedScopeKey: string,
  ) => Promise<DataStudioRowPage | void>;
  readonly refreshTableAfterMutation: (
    tableId: string,
    expectedScopeKey: string,
  ) => Promise<void>;
}) {
  const runMutation = React.useCallback(async <T,>(
    operation: DataStudioFrontendOperation,
    key: string,
    action: (operationId: string) => Promise<T>,
    reconciliation: PostMutationReconciliation = {},
  ): Promise<T> => {
    if (!input.boundaryReadyRef.current || input.boundaryKeyRef.current !== input.boundaryKey) {
      throw new Error('Data Studio is unavailable while the organization scope changes.');
    }
    const tracker = input.operationTracker.current;
    const operationId = tracker.begin(key);
    input.setPendingMutations((count) => count + 1);
    input.setMutationError(null);
    try {
      let result: T;
      try {
        result = await action(operationId);
        if (!input.boundaryReadyRef.current || input.boundaryKeyRef.current !== input.boundaryKey) {
          throw new Error('Discarded a Data Studio response from a previous organization scope.');
        }
      } catch (cause) {
        tracker.fail(key, cause, operationId);
        const error = toDataStudioError(cause);
        if (input.boundaryKeyRef.current === input.boundaryKey) {
          input.setMutationError(error);
          reportDataStudioFrontendFailure(operation, 'mutation', cause);
        }
        await settlePostMutationRefreshes(operation, reconciliation.afterFailure ?? []);
        throw error;
      }

      tracker.succeed(key, operationId);
      await settlePostMutationRefreshes(operation, reconciliation.afterSuccess ?? []);
      return result;
    } finally {
      if (input.boundaryKeyRef.current === input.boundaryKey) {
        input.setPendingMutations((count) => Math.max(0, count - 1));
      }
    }
  }, [
    input.boundaryKey,
    input.boundaryKeyRef,
    input.boundaryReadyRef,
    input.operationTracker,
    input.setMutationError,
    input.setPendingMutations,
  ]);

  const createTable = React.useCallback(async (tableInput: DataStudioTableCreate) => {
    requireCapability(input.access.canManage, 'Schema management');
    if (!input.surface) throw unavailable();
    const table = await runMutation('table.create', mutationKey('table:create', tableInput), (operationId) =>
      input.surface!.createTable(tableInput, { operationId }));
    try {
      await input.surface.listTables(input.tableStatus);
    } catch (cause) {
      input.setCatalogError(toDataStudioError(cause));
      reportDataStudioFrontendFailure('table-summary.refresh', 'load', cause);
    }
    input.setTableStatusState('active');
    input.setSelectedTableId(table.tableId);
    return table;
  }, [input.access.canManage, input.surface, input.tableStatus, runMutation]);

  const updateTable = React.useCallback(async (
    tableInput: Omit<DataStudioTableUpdate, 'expectedRevision'>,
  ) => {
    requireCapability(input.access.canManage, 'Schema management');
    if (!input.surface || !input.selectedTable) throw unavailable();
    const update = { ...tableInput, expectedRevision: input.selectedTable.revision };
    return runMutation(
      'table.update',
      mutationKey(`table:update:${input.selectedTable.tableId}`, update),
      (operationId) => input.surface!.updateTable(
        input.selectedTable!.tableId,
        update,
        { operationId },
      ),
    );
  }, [input.access.canManage, input.selectedTable, input.surface, runMutation]);

  const updateSchema = React.useCallback(
    (schema: DataStudioSchema) => updateTable({ schema }),
    [updateTable],
  );

  const changeTableStatus = React.useCallback(async (status: DataStudioTableStatus) => {
    requireCapability(input.access.canManage, 'Schema management');
    if (!input.surface || !input.selectedTable) throw unavailable();
    const statusInput = { expectedRevision: input.selectedTable.revision, status };
    const table = await runMutation(
      'table-status.update',
      mutationKey(`table:status:${input.selectedTable.tableId}`, statusInput),
      (operationId) => input.surface!.setTableStatus(
        input.selectedTable!.tableId,
        input.selectedTable!.revision,
        status,
        { operationId },
      ),
    );
    try {
      await input.surface.listTables(input.tableStatus);
    } catch (cause) {
      input.setCatalogError(toDataStudioError(cause));
      reportDataStudioFrontendFailure('table-summary.refresh', 'load', cause);
    }
    return table;
  }, [input.access.canManage, input.selectedTable, input.surface, input.tableStatus, runMutation]);

  const createRow = React.useCallback(async (values: Readonly<Record<string, unknown>>) => {
    requireCapability(input.access.canWrite, 'Row editing');
    if (!input.surface || !input.selectedTable) throw unavailable();
    const tableId = input.selectedTable.tableId;
    const refreshes = [
      () => input.refreshRowsAfterMutation(tableId, input.boundaryKey),
      () => input.refreshTableAfterMutation(tableId, input.boundaryKey),
    ] as const;
    const row = await runMutation(
      'row.create',
      mutationKey(`row:create:${tableId}`, values),
      (operationId) => input.surface!.createRow(tableId, values, { operationId }),
      { afterSuccess: refreshes, afterFailure: refreshes },
    );
    if (input.selectedTableIdRef.current === tableId) input.setSelectedRowId(row.rowId);
    return row;
  }, [
    input.access.canWrite,
    input.boundaryKey,
    input.refreshRowsAfterMutation,
    input.refreshTableAfterMutation,
    input.selectedTable,
    input.surface,
    runMutation,
  ]);

  const replaceRow = React.useCallback(async (
    row: DataStudioRow,
    values: Readonly<Record<string, unknown>>,
  ) => {
    requireCapability(input.access.canWrite, 'Row editing');
    if (!input.surface || !input.selectedTable || row.tableId !== input.selectedTable.tableId) {
      throw unavailable();
    }
    const tableId = input.selectedTable.tableId;
    const refreshRows = () => input.refreshRowsAfterMutation(tableId, input.boundaryKey);
    return runMutation(
      'row.replace',
      mutationKey(`row:replace:${row.rowId}:${row.revision}`, values),
      (operationId) => input.surface!.replaceRow(
        tableId,
        row.rowId,
        row.revision,
        values,
        { operationId },
      ),
      { afterSuccess: [refreshRows], afterFailure: [refreshRows] },
    );
  }, [
    input.access.canWrite,
    input.boundaryKey,
    input.refreshRowsAfterMutation,
    input.selectedTable,
    input.surface,
    runMutation,
  ]);

  const updateCell = React.useCallback(async (
    row: DataStudioRow,
    columnId: string,
    value: DataStudioValue,
  ) => {
    if (!input.selectedTable) throw unavailable();
    const column = input.selectedTable.schema.columns.find((item) => item.columnId === columnId);
    if (!column) throw new Error('The selected Data Studio column no longer exists.');
    return replaceRow(row, {
      ...dataStudioRowValuesByKey(row, input.selectedTable.schema.columns),
      [column.key]: value,
    });
  }, [input.selectedTable, replaceRow]);

  const deleteRow = React.useCallback(async (row = input.selectedRow ?? undefined) => {
    requireCapability(input.access.canWrite, 'Row editing');
    if (!input.surface || !input.selectedTable || !row) throw unavailable();
    const tableId = input.selectedTable.tableId;
    const refreshes = [
      () => input.refreshRowsAfterMutation(tableId, input.boundaryKey),
      () => input.refreshTableAfterMutation(tableId, input.boundaryKey),
    ] as const;
    await runMutation(
      'row.delete',
      mutationKey(`row:delete:${row.rowId}`, { expectedRevision: row.revision }),
      (operationId) => input.surface!.deleteRow(
        tableId,
        row.rowId,
        row.revision,
        { operationId },
      ),
      { afterSuccess: refreshes, afterFailure: refreshes },
    );
  }, [
    input.access.canWrite,
    input.boundaryKey,
    input.refreshRowsAfterMutation,
    input.refreshTableAfterMutation,
    input.selectedRow,
    input.selectedTable,
    input.surface,
    runMutation,
  ]);

  return {
    createTable,
    updateTable,
    updateSchema,
    changeTableStatus,
    createRow,
    replaceRow,
    updateCell,
    deleteRow,
  };
}

function requireCapability(allowed: boolean, label: string): void {
  if (!allowed) throw new Error(`${label} is unavailable in this organization.`);
}

function unavailable(): Error {
  return new Error('Select an available Data Studio table first.');
}

function mutationKey(prefix: string, value: unknown): string {
  return `${prefix}:${canonicalizeDataStudioMutationInput(value)}`;
}

/** A verified commit must never be reported as failed because reconciliation failed. */
export async function settlePostMutationRefreshes(
  operation: DataStudioFrontendOperation,
  refreshes: readonly (() => Promise<unknown>)[],
  timeoutMs = POST_MUTATION_REFRESH_TIMEOUT_MS,
): Promise<void> {
  const results = await Promise.allSettled(refreshes.map((refresh) =>
    runBoundedRefresh(refresh, timeoutMs)));
  for (const result of results) {
    if (result.status === 'rejected') {
      try {
        reportDataStudioFrontendFailure(operation, 'load', result.reason);
      } catch {
        // Observability must not turn an already verified write into a failed
        // mutation result.
      }
    }
  }
}

function runBoundedRefresh(
  refresh: () => Promise<unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Data Studio post-mutation reconciliation timed out.'));
    }, timeoutMs);
    void Promise.resolve().then(refresh).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}
