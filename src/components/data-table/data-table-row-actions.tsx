'use client';

import * as React from 'react';
import { LoaderCircle, MoreHorizontal } from 'lucide-react';
import { Button } from '#zero/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '#zero/components/animate-ui/components/radix/dropdown-menu';
import { modals } from '../../modals';
import {
  dataTableActionDisabled,
  dataTableActionDisabledReason,
  resolveDataTableActionValue,
  type DataTableActionDefinition,
} from './data-table-action-contracts';
import { mutationCancelledError } from './data-table-mutation-controller';
import {
  useDataTableMutationRunner,
  type DataTableMutationRunner,
} from './use-data-table-mutation';

export interface RowAction<T> extends DataTableActionDefinition<T> {}

export interface DataTableRowActionsProps<T> {
  row: T;
  actions: readonly RowAction<T>[];
  /** Stable row identity used only for local operation deduplication. */
  rowId?: string;
  /** Share one runner across the complete table when available. */
  mutationRunner?: DataTableMutationRunner;
  /** Awaited after accepted actions unless the action opts out. */
  onRefresh?: () => void | Promise<void>;
  /** Optional non-auth source identity for standalone use. */
  mutationBoundaryKey?: string | number | null;
}

export function DataTableRowActions<T>({
  row,
  actions,
  rowId,
  mutationRunner,
  onRefresh,
  mutationBoundaryKey,
}: DataTableRowActionsProps<T>) {
  if (mutationRunner) {
    return (
      <DataTableRowActionsContent
        row={row}
        actions={actions}
        rowId={rowId}
        runner={mutationRunner}
        onRefresh={onRefresh}
      />
    );
  }
  return (
    <DataTableRowActionsWithLocalRunner
      row={row}
      actions={actions}
      rowId={rowId}
      onRefresh={onRefresh}
      mutationBoundaryKey={mutationBoundaryKey}
    />
  );
}

function DataTableRowActionsWithLocalRunner<T>(
  props: Omit<DataTableRowActionsProps<T>, 'mutationRunner'>,
) {
  const localRunner = useDataTableMutationRunner({
    boundaryKey: props.mutationBoundaryKey,
    refresh: props.onRefresh,
  });
  return (
    <DataTableRowActionsContent
      row={props.row}
      actions={props.actions}
      rowId={props.rowId}
      runner={localRunner}
      onRefresh={props.onRefresh}
    />
  );
}

function DataTableRowActionsContent<T>({
  row,
  actions,
  rowId,
  runner,
  onRefresh,
}: {
  row: T;
  actions: readonly RowAction<T>[];
  rowId?: string;
  runner: DataTableMutationRunner;
  onRefresh?: () => void | Promise<void>;
}) {
  const instanceId = React.useId();
  const visibleActions = actions.filter((action) => !action.visible || action.visible(row));
  if (visibleActions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="data-[state=open]:bg-muted"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open row actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        {visibleActions.map((action, index) => {
          const operationKey = rowActionOperationKey(
            rowId ?? instanceId,
            action.id,
            index,
          );
          const pending = runner.isPending(operationKey);
          const disabled = pending || dataTableActionDisabled(action, row);
          const disabledReason = pending
            ? 'Action in progress'
            : dataTableActionDisabledReason(action, row);
          const Icon = action.icon;
          return (
            <React.Fragment key={`${action.id ?? action.label}-${index}`}>
              {index > 0 && action.variant === 'destructive' && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={disabled}
                variant={action.variant}
                title={disabledReason}
                aria-busy={pending || undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  void runRowAction(runner, operationKey, action, row, onRefresh);
                }}
              >
                {pending
                  ? <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  : Icon
                    ? <Icon className="mr-2 size-4" />
                    : null}
                {action.label}
                {disabledReason && <span className="sr-only">: {disabledReason}</span>}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function runRowAction<T>(
  runner: DataTableMutationRunner,
  key: string,
  action: RowAction<T>,
  row: T,
  refresh?: () => void | Promise<void>,
): Promise<void> {
  try {
    await runner.run({
      key,
      kind: 'row',
      refresh,
      refreshOnSuccess: action.refreshOnSuccess,
      execute: async (context) => {
        if (action.confirm) {
          const confirmed = await modals.confirm({
            title: resolveDataTableActionValue(action.confirm.title, row)!,
            description: resolveDataTableActionValue(action.confirm.description, row),
            confirmLabel: resolveDataTableActionValue(action.confirm.confirmLabel, row),
            cancelLabel: resolveDataTableActionValue(action.confirm.cancelLabel, row),
            variant: resolveDataTableActionValue(action.confirm.variant, row),
            holdToConfirm: resolveDataTableActionValue(action.confirm.holdToConfirm, row),
            holdDuration: resolveDataTableActionValue(action.confirm.holdDuration, row),
          });
          if (!confirmed || context.signal.aborted) throw mutationCancelledError();
        }
        await action.onClick(row, context);
      },
    });
  } catch {
    // The runner owns safe presentation, observability, cancellation, and retry state.
  }
}

function rowActionOperationKey(
  rowIdentity: string,
  actionId: string | undefined,
  index: number,
): string {
  // Tuple encoding prevents caller-controlled IDs containing delimiters from
  // aliasing another row/action's in-flight operation.
  return JSON.stringify(['row', rowIdentity, actionId ?? null, index]);
}
