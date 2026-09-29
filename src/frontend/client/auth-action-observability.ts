'use client';

import { OBS_CODES } from '../../observability/codes';
import { AuthClientError } from './auth-errors';
import { emitFrontendCode } from './observability';

/** Report one current-scope auth control-plane failure without request data. */
export function reportAuthClientActionFailure(action: string, error: unknown): void {
  emitFrontendCode(OBS_CODES.FRONTEND_AUTH_ACTION_FAILED, {
    error,
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
