/** Read-only private-root admission, repeated canonically before any startup mutation. */
import { AuthError } from '../auth/types';
import { assertLoggingDirectoryIsolation, type LoggingDirectoryIsolationInput } from '../logging/logging-directory-isolation';
export function assertMessagingDirectoryIsolation(input: LoggingDirectoryIsolationInput & { loggingRoot?: string; blogRoot?: string }, canonical = false): void {
  try {
    assertLoggingDirectoryIsolation(input, canonical);
    for (const root of [input.loggingRoot, input.blogRoot]) if (root) assertLoggingDirectoryIsolation({ ...input, applicationFabricRoot: root }, canonical);
  } catch { throw new AuthError('Messaging storage must be separate from application, control, logging, blog, asset and Storage directories.', 'MESSAGING_CONFIG_INVALID', 500); }
}
