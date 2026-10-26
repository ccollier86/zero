/** Privacy-safe HTTP projection of domain, Guardian, audit-admission and Fabric outcomes. Never return SQL, record payloads or exception stacks. */
import { AuthError } from '../auth/types';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import { DatabaseError } from '../databases/database-error';
import { LoggingError } from '../logging/logging-error';
import { projectLoggingHttpFailure } from '../logging/logging-http-error';

/** Unknown mutation outcomes must not be presented as permission to blindly retry a different request. */
export function projectBlogHttpError(error: unknown, code: string | number) {
  if (error instanceof LoggingError) return projectLoggingHttpFailure(error);
  if (error instanceof AuthError) return { status: error.status, body: { code: error.code, error: error.code.startsWith('BLOG_') ? error.message : getPublicAuthErrorMessage(error) } };
  if (error instanceof DatabaseError) {
    if (error.outcome === 'unknown') return { status: 409, body: { code: 'BLOG_OUTCOME_UNKNOWN', outcome: 'unknown', error: 'The blog change may have committed. Reconcile using the original request identity.' } };
    if (error.code === 'DATABASE_AUTHORITY_CHANGED') return { status: 409, body: { code: 'BLOG_AUTHORITY_CHANGED', error: 'Blog authority changed. Refresh your current permissions.' } };
    if (['DATABASE_CAPACITY_EXHAUSTED', 'DATABASE_BACKPRESSURE', 'DATABASE_QUEUE_TIMEOUT'].includes(error.code)) return { status: 429, body: { code: 'BLOG_CAPACITY', error: 'Blog capacity is temporarily exhausted.' } };
    return { status: 503, body: { code: 'BLOG_NOT_READY', error: 'Blog storage is temporarily unavailable.' } };
  }
  const status = code === 'PARSE' || code === 'VALIDATION' ? 422 : 500;
  return { status, body: { code: status === 422 ? 'BLOG_INVALID_INPUT' : 'BLOG_INTERNAL_ERROR', error: 'The blog request could not be completed.' } };
}
