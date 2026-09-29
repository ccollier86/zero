'use client';

import { OBS_CODES } from '../../observability/codes';
import { AuthClientError } from './auth-errors';
import { emitFrontendCode } from './observability';

export interface ReportAuthClientActionFailureOptions {
  /**
   * Omit the raw error when a flow handles bearer proofs or user-entered
   * identity data that could be repeated in an upstream error message.
   * Stable action and error codes remain available for operational grouping.
   */
  codeOnly?: boolean;
}

/** Report one current-scope auth control-plane failure without request data. */
export function reportAuthClientActionFailure(
  action: string,
  error: unknown,
  options: ReportAuthClientActionFailureOptions = {},
): void {
  emitFrontendCode(OBS_CODES.FRONTEND_AUTH_ACTION_FAILED, {
    ...(options.codeOnly ? {} : { error }),
    metadata: {
      action,
      code: authClientErrorCode(error),
    },
  });
}

function authClientErrorCode(error: unknown): string | null {
  if (error instanceof AuthClientError) return error.code;
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
