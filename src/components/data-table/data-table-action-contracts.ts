import type * as React from 'react';
import type { DataTableMutationContext } from './data-table-mutation-controller';

export type DataTableActionVariant = 'default' | 'destructive';
export type DataTableActionValue<Target, Value> = Value | ((target: Target) => Value);

export interface DataTableActionConfirmation<Target> {
  title: DataTableActionValue<Target, string>;
  description?: DataTableActionValue<Target, string | undefined>;
  confirmLabel?: DataTableActionValue<Target, string | undefined>;
  cancelLabel?: DataTableActionValue<Target, string | undefined>;
  variant?: DataTableActionValue<Target, DataTableActionVariant | undefined>;
  holdToConfirm?: DataTableActionValue<Target, boolean | undefined>;
  holdDuration?: DataTableActionValue<Target, number | undefined>;
}

export interface DataTableActionDefinition<Target> {
  /** Stable caller-owned identity; array position is the backward-compatible fallback. */
  id?: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: DataTableActionVariant;
  visible?: (target: Target) => boolean;
  disabled?: boolean | ((target: Target) => boolean);
  disabledReason?: string | ((target: Target) => string | undefined);
  confirm?: DataTableActionConfirmation<Target>;
  /** Refresh the source after an accepted action. Defaults to true. */
  refreshOnSuccess?: boolean;
  onClick: (
    target: Target,
    context?: DataTableMutationContext,
  ) => void | Promise<void>;
}

export function resolveDataTableActionValue<Target, Value>(
  value: DataTableActionValue<Target, Value> | undefined,
  target: Target,
): Value | undefined {
  return typeof value === 'function'
    ? (value as (candidate: Target) => Value)(target)
    : value;
}

export function dataTableActionDisabled<Target>(
  action: Pick<DataTableActionDefinition<Target>, 'disabled'>,
  target: Target,
): boolean {
  return typeof action.disabled === 'function'
    ? action.disabled(target)
    : action.disabled === true;
}

export function dataTableActionDisabledReason<Target>(
  action: Pick<DataTableActionDefinition<Target>, 'disabledReason'>,
  target: Target,
): string | undefined {
  return typeof action.disabledReason === 'function'
    ? action.disabledReason(target)
    : action.disabledReason;
}
