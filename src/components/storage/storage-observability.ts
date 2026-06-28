/**
 * storage-observability.ts
 *
 * Normalizes storage UI action failures and routes them through Zero's
 * frontend observability boundary. This file does not render UI or execute
 * storage mutations.
 */

import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

/** Convert an unknown storage action failure into an Error. */
export function toStorageActionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Emit a failed storage UI action through the frontend observability sink. */
export function reportStorageActionError(
  action: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): Error {
  const normalized = toStorageActionError(error);
  emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
    error: normalized,
    metadata: { action, ...metadata },
  });
  return normalized;
}
