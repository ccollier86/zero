/**
 * admin-user-error.ts
 *
 * Normalizes and reports admin-user failures through Zero observability. This
 * module owns error translation only; hooks decide where errors are rendered.
 */

import { emitFrontendCode } from '../../../frontend/client/observability';
import { AuthClientError } from '../../../frontend/client/auth-client';
import { OBS_CODES } from '../../../observability/codes';

/** Convert an unknown failure to Error and emit its stable frontend code. */
export function reportAdminUserError(
  action: string,
  value: unknown,
  metadata: { targetUserId?: string } = {},
): Error {
  const error = value instanceof Error ? value : new Error(String(value));
  const response = error instanceof AuthClientError
    ? { status: error.status, code: error.code }
    : {};
  emitFrontendCode(OBS_CODES.FRONTEND_ADMIN_USER_ACTION_FAILED, {
    error,
    metadata: { action, ...metadata, ...response },
  });
  return error;
}
