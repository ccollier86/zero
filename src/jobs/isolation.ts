/** Pure root ownership, repeated through existing filesystem aliases before managed initialization. */
import { assertLoggingDirectoryIsolation, type LoggingDirectoryIsolationInput } from '../logging/logging-directory-isolation';
import { JobsError } from './error';
export function assertJobsDirectoryIsolation(input: LoggingDirectoryIsolationInput & { readonly featureRoots?: readonly string[] }, canonical = false): void {
  try {
    assertLoggingDirectoryIsolation(input, canonical);
    for (const root of input.featureRoots ?? []) assertLoggingDirectoryIsolation({ ...input, applicationFabricRoot: root }, canonical);
  } catch { throw new JobsError('JOBS_CONFIG_INVALID'); }
}
