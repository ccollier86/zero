/** Classify definitive foreground read rejection, not generic query/transport failure or mutation outcomes. */
import { FetchError } from '../../frontend/client/sdk';

/** SDK status is the authority; never infer access loss from message text or a caller's arbitrary error code. */
export function isDataTableReadAccessDenied(error: unknown): boolean {
  if (!(error instanceof FetchError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  const body = error.body;
  return error.status === 428 && body !== null && typeof body === 'object' && !Array.isArray(body)
    && (body as { code?: unknown }).code === 'LOGGING_ADMISSION_REQUIRED';
}
