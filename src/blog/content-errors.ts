/** Closed numeric actor error provenance. It survives Fabric sanitization without transporting article data or arbitrary messages. */
import { AuthError } from '../auth/types';
import { DatabaseError } from '../databases/database-error';
const CODES = ['BLOG_INVALID_INPUT', 'BLOG_FORBIDDEN', 'BLOG_POST_NOT_FOUND', 'BLOG_REVISION_CONFLICT', 'BLOG_CAPACITY', 'BLOG_TAXONOMY_INVALID', 'BLOG_MEDIA_UNAVAILABLE',
  'BLOG_SLUG_CONFLICT', 'BLOG_POST_TRASHED', 'BLOG_POST_INCOMPLETE', 'BLOG_WITHDRAW_REQUIRED', 'BLOG_REVISION_NOT_FOUND', 'BLOG_TAXONOMY_NOT_FOUND',
  'BLOG_TAXONOMY_KIND_CONFLICT', 'BLOG_TAXONOMY_CYCLE', 'BLOG_TAXONOMY_IN_USE', 'BLOG_CONTENT_OWNER_CONFLICT', 'BLOG_MEDIA_NOT_FOUND', 'BLOG_MEDIA_IN_USE', 'BLOG_METRIC_CONFLICT'] as const;
/** Throw through the actor transaction so even changes preceding rejection roll back. */
export function blogActorRejection(error: AuthError): never {
  const index = CODES.indexOf(error.code as typeof CODES[number]);
  if (index < 0) throw error;
  throw new DatabaseError('DATABASE_CONFLICT', 'The blog operation was rejected.', { outcome: 'not-committed', retryable: false, details: { domainCode: index + 1 } });
}
/** Only this fixed protocol maps to a public domain failure; unknown framework failures keep their own outcome. */
export function readBlogActorRejection(error: unknown): AuthError | null {
  if (!(error instanceof DatabaseError) || error.code !== 'DATABASE_CONFLICT' || error.outcome !== 'not-committed') return null;
  const domain = error.details.domainCode;
  if (typeof domain !== 'number' || !Number.isSafeInteger(domain) || domain < 1 || domain > CODES.length) return null;
  const code = CODES[domain - 1]!;
  const status = code === 'BLOG_FORBIDDEN' ? 403 : code.endsWith('_NOT_FOUND') ? 404 : code === 'BLOG_CAPACITY' ? 429
    : ['BLOG_INVALID_INPUT', 'BLOG_TAXONOMY_INVALID', 'BLOG_MEDIA_UNAVAILABLE', 'BLOG_POST_INCOMPLETE', 'BLOG_TAXONOMY_CYCLE'].includes(code) ? 422 : 409;
  return new AuthError('The blog operation was not accepted.', code, status);
}
