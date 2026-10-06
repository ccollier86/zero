/**
 * data-studio-observability.ts
 *
 * Safe frontend observability boundary for Data Studio controller failures.
 * This module deliberately excludes resource identifiers, values, paths,
 * user/tenant context, error messages, and idempotency keys.
 */

import { OBS_CODES } from '../../observability/codes';
import { DataStudioMutationError } from './data-studio-client';
import { isDataStudioErrorCode } from '../../data-studio/data-studio-error';
import { emitFrontendCode } from './observability';

const reportedFailures = new WeakMap<object, Set<string>>();

export type DataStudioFrontendOperation =
  | 'capabilities-and-catalog.load'
  | 'table-detail.load'
  | 'row-page.load'
  | 'table-summary.refresh'
  | 'table.create'
  | 'table.update'
  | 'table-status.update'
  | 'row.create'
  | 'row.replace'
  | 'row.delete';

/** Emit once per operation/category/error identity, including controller-to-component propagation. */
export function reportDataStudioFrontendFailure(
  operation: DataStudioFrontendOperation,
  category: 'load' | 'mutation',
  cause: unknown,
): void {
  if (cause !== null && (typeof cause === 'object' || typeof cause === 'function')) {
    const identity = `${operation}:${category}`;
    const reported = reportedFailures.get(cause);
    if (reported?.has(identity)) return;
    const next = reported ?? new Set<string>();
    next.add(identity);
    reportedFailures.set(cause, next);
  }
  const mutationError = cause instanceof DataStudioMutationError ? cause : null;
  emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, {
    metadata: {
      operation,
      category,
      code: isDataStudioErrorCode(mutationError?.code) ? mutationError.code : null,
      retryable: mutationError?.retryable === true,
    },
  });
}
