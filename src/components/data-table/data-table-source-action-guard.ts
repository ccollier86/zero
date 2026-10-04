/** Stable guards shared by caller-owned and ReactiveDB DataTable actions. */

import {
  dataTableMutationActionUnavailableError,
  dataTableMutationScopeUnavailableError,
} from './data-table-mutation-types';

export type DataTableWritableSourceAction = 'insert' | 'update' | 'remove';

/**
 * Invoke an optional write only while its captured authorization scope is
 * current. Missing writes and stale scopes reject instead of reporting a
 * successful no-op to the table mutation lifecycle.
 */
export function invokeDataTableSourceWrite(
  action: DataTableWritableSourceAction,
  currentScope: boolean,
  operation?: () => void | Promise<void>,
): void | Promise<void> {
  if (!currentScope) {
    return Promise.reject(dataTableMutationScopeUnavailableError());
  }
  if (!operation) {
    return Promise.reject(dataTableMutationActionUnavailableError(action));
  }
  return operation();
}
