'use client';

import * as React from 'react';
import type { DataTableMutationContext } from './data-table-mutation-controller';
import type { DataTableMutationRunner } from './use-data-table-mutation';

export type EditableCellSave = (
  rowId: string,
  columnId: string,
  value: unknown,
  context?: DataTableMutationContext,
) => void | Promise<void>;

interface UseEditableCellSaveOptions {
  rowId: string;
  columnId: string;
  onSave: EditableCellSave;
  onAccepted?: () => void;
  onTabNext?: () => void;
  onRefresh?: () => void | Promise<void>;
  refreshOnSuccess?: boolean;
  runner: DataTableMutationRunner;
}

export interface EditableCellSaveLifecycle {
  pending: boolean;
  error: string | null;
  save(value: unknown, advanceAfterSave?: boolean): Promise<boolean>;
  retry(): Promise<boolean>;
  clearError(): void;
}

/** Await one cell write, retaining its exact failed request for an explicit retry. */
export function useEditableCellSave({
  rowId,
  columnId,
  onSave,
  onAccepted,
  onTabNext,
  onRefresh,
  refreshOnSuccess,
  runner,
}: UseEditableCellSaveOptions): EditableCellSaveLifecycle {
  const operationKey = React.useMemo(
    () => JSON.stringify(['cell', rowId, columnId]),
    [columnId, rowId],
  );
  const activeAttempt = React.useRef<Promise<boolean> | null>(null);
  const advanceOnSuccess = React.useRef(false);
  const pending = runner.isPending(operationKey);
  const error = runner.getError(operationKey)?.message ?? null;

  const complete = React.useCallback(async (
    operation: () => Promise<unknown>,
  ): Promise<boolean> => {
    if (activeAttempt.current) return activeAttempt.current;
    const attempt = (async () => {
      try {
        await operation();
        onAccepted?.();
        if (advanceOnSuccess.current) onTabNext?.();
        return true;
      } catch {
        return false;
      } finally {
        activeAttempt.current = null;
      }
    })();
    activeAttempt.current = attempt;
    return attempt;
  }, [onAccepted, onTabNext]);

  const save = React.useCallback((
    value: unknown,
    advanceAfterSave = false,
  ): Promise<boolean> => {
    if (activeAttempt.current) return activeAttempt.current;
    advanceOnSuccess.current = advanceAfterSave;
    return complete(() => runner.run({
      key: operationKey,
      kind: 'cell',
      refresh: onRefresh,
      refreshOnSuccess,
      execute: (context) => onSave(rowId, columnId, value, context),
    }));
  }, [
    columnId,
    complete,
    onRefresh,
    onSave,
    operationKey,
    refreshOnSuccess,
    rowId,
    runner,
  ]);

  const retry = React.useCallback((): Promise<boolean> => {
    if (activeAttempt.current) return activeAttempt.current;
    return complete(() => runner.retry(operationKey));
  }, [complete, operationKey, runner]);

  const clearError = React.useCallback(() => {
    runner.clearError(operationKey);
  }, [operationKey, runner]);

  return { pending, error, save, retry, clearError };
}
