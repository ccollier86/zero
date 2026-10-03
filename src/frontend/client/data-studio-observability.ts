/**
 * data-studio-observability.ts
 *
 * Safe frontend observability boundary for Data Studio controller failures.
 * This module deliberately excludes resource identifiers, values, paths,
 * user/tenant context, error messages, and idempotency keys.
 */

import { OBS_CODES } from '../../observability/codes';
import { DataStudioMutationError } from './data-studio-client';
import { emitFrontendCode } from './observability';

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

/** Emit one bounded event for a controller-handled Data Studio failure. */
export function reportDataStudioFrontendFailure(
  operation: DataStudioFrontendOperation,
  category: 'load' | 'mutation',
  cause: unknown,
): void {
  const mutationError = cause instanceof DataStudioMutationError ? cause : null;
  emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, {
    metadata: {
      operation,
      category,
      code: mutationError?.code ?? null,
      retryable: mutationError?.retryable ?? false,
    },
  });
}
