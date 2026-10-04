'use client';

import * as React from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
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

/** Default selection: only rows and IDs selected on the currently loaded page. */
export interface DataTablePageBulkSelection<T> {
  readonly scope: 'page';
  readonly rows: readonly T[];
  readonly rowIds: readonly string[];
}

/**
 * All-matching work is possible only when a source explicitly provides an
 * executable target and stable key. DataTable never infers this from a page.
 */
export interface DataTableAllMatchingBulkSelection<Target> {
  readonly scope: 'all-matching';
  readonly target: Target;
  readonly selectionKey: string;
  readonly total: number;
}

export type DataTableBulkSelection<T, AllMatchingTarget = never> =
  | DataTablePageBulkSelection<T>
  | DataTableAllMatchingBulkSelection<AllMatchingTarget>;

export interface DataTableBulkAction<T, AllMatchingTarget = never>
  extends DataTableActionDefinition<DataTableBulkSelection<T, AllMatchingTarget>> {}

export interface DataTableBulkActionsProps<T, AllMatchingTarget = never> {
  selection: DataTableBulkSelection<T, AllMatchingTarget>;
  actions: readonly DataTableBulkAction<T, AllMatchingTarget>[];
  mutationRunner?: DataTableMutationRunner;
  onRefresh?: () => void | Promise<void>;
  mutationBoundaryKey?: string | number | null;
  ariaLabel?: string;
  className?: string;
}

/** Compact, selection-aware actions suitable for a DataTable toolbar slot. */
export function DataTableBulkActions<T, AllMatchingTarget = never>({
  selection,
  actions,
  mutationRunner,
  onRefresh,
  mutationBoundaryKey,
  ariaLabel = 'Selected row actions',
  className,
}: DataTableBulkActionsProps<T, AllMatchingTarget>) {
  if (mutationRunner) {
    return (
      <DataTableBulkActionsContent
        selection={selection}
        actions={actions}
        runner={mutationRunner}
        onRefresh={onRefresh}
        ariaLabel={ariaLabel}
        className={className}
      />
    );
  }
  return (
    <DataTableBulkActionsWithLocalRunner
      selection={selection}
      actions={actions}
      onRefresh={onRefresh}
      mutationBoundaryKey={mutationBoundaryKey}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}

function DataTableBulkActionsWithLocalRunner<T, AllMatchingTarget = never>(
  props: Omit<DataTableBulkActionsProps<T, AllMatchingTarget>, 'mutationRunner'>,
) {
  const localRunner = useDataTableMutationRunner({
    boundaryKey: props.mutationBoundaryKey,
    refresh: props.onRefresh,
  });
  return (
    <DataTableBulkActionsContent
      selection={props.selection}
      actions={props.actions}
      runner={localRunner}
      onRefresh={props.onRefresh}
      ariaLabel={props.ariaLabel ?? 'Selected row actions'}
      className={props.className}
    />
  );
}

function DataTableBulkActionsContent<T, AllMatchingTarget = never>({
  selection,
  actions,
  runner,
  onRefresh,
  ariaLabel,
  className,
}: {
  selection: DataTableBulkSelection<T, AllMatchingTarget>;
  actions: readonly DataTableBulkAction<T, AllMatchingTarget>[];
  runner: DataTableMutationRunner;
  onRefresh?: () => void | Promise<void>;
  ariaLabel: string;
  className?: string;
}) {
  const instanceId = React.useId();
  const count = selection.scope === 'page' ? selection.rowIds.length : selection.total;
  const visible = actions.filter((action) => !action.visible || action.visible(selection));
  if (count === 0 || visible.length === 0) return null;

  const selectionIdentity = selection.scope === 'page'
    ? pageSelectionIdentity(selection.rowIds)
    : selection.selectionKey;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="data-table-bulk-actions"
      className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}
    >
      <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
        {count} selected
      </span>
      {visible.map((action, index) => {
        const key = JSON.stringify([
          'bulk',
          instanceId,
          selectionIdentity,
          action.id ?? null,
          index,
        ]);
        const pending = runner.isPending(key);
        const disabled = pending || dataTableActionDisabled(action, selection);
        const disabledReason = pending
          ? 'Action in progress'
          : dataTableActionDisabledReason(action, selection);
        const Icon = action.icon;
        return (
          <Button
            key={`${action.id ?? action.label}-${index}`}
            type="button"
            size="sm"
            variant={action.variant === 'destructive' ? 'destructive' : 'outline'}
            disabled={disabled}
            title={disabledReason}
            aria-busy={pending || undefined}
            onClick={() => {
              void runBulkAction(runner, key, action, selection, onRefresh);
            }}
          >
            {pending
              ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              : Icon
                ? <Icon className="size-4" />
                : null}
            {action.label}
            {disabledReason && <span className="sr-only">: {disabledReason}</span>}
          </Button>
        );
      })}
    </div>
  );
}

async function runBulkAction<T, AllMatchingTarget>(
  runner: DataTableMutationRunner,
  key: string,
  action: DataTableBulkAction<T, AllMatchingTarget>,
  selection: DataTableBulkSelection<T, AllMatchingTarget>,
  refresh?: () => void | Promise<void>,
): Promise<void> {
  try {
    await runner.run({
      key,
      kind: 'bulk',
      refresh,
      refreshOnSuccess: action.refreshOnSuccess,
      execute: async (context) => {
        if (action.confirm) {
          const confirmed = await modals.confirm({
            title: resolveDataTableActionValue(action.confirm.title, selection)!,
            description: resolveDataTableActionValue(action.confirm.description, selection),
            confirmLabel: resolveDataTableActionValue(action.confirm.confirmLabel, selection),
            cancelLabel: resolveDataTableActionValue(action.confirm.cancelLabel, selection),
            variant: resolveDataTableActionValue(action.confirm.variant, selection),
            holdToConfirm: resolveDataTableActionValue(
              action.confirm.holdToConfirm,
              selection,
            ),
            holdDuration: resolveDataTableActionValue(action.confirm.holdDuration, selection),
          });
          if (!confirmed || context.signal.aborted) throw mutationCancelledError();
        }
        await action.onClick(selection, context);
      },
    });
  } catch {
    // The runner owns safe presentation, observability, cancellation, and retry state.
  }
}

function pageSelectionIdentity(rowIds: readonly string[]): string {
  // Keep the identity collision-free: a hash could deduplicate actions for
  // two different page selections under adversarial row IDs.
  return JSON.stringify(rowIds);
}
