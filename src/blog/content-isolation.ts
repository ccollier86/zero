/** Read-only content path admission, repeated through filesystem aliases before startup creates anything. */
import { assertLoggingDirectoryIsolation, type LoggingDirectoryIsolationInput } from '../logging/logging-directory-isolation';
import { AuthError } from '../auth/types';

/** Blog storage cannot alias application, logging, generated assets or Storage ownership. */
export function assertBlogContentDirectoryIsolation(input: LoggingDirectoryIsolationInput & { loggingRoot?: string }, canonical = false): void {
  try {
    assertLoggingDirectoryIsolation(input, canonical);
    if (input.loggingRoot) assertLoggingDirectoryIsolation({ ...input, applicationFabricRoot: input.loggingRoot }, canonical);
  } catch {
    throw new AuthError('Blog content storage must be separate from application, logging, generated assets and Storage directories.', 'BLOG_CONFIG_INVALID', 500);
  }
}
