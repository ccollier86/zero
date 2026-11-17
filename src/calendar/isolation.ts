/** Read-only private-root admission, repeated through existing aliases before managed startup can mutate storage. */
import { assertLoggingDirectoryIsolation, type LoggingDirectoryIsolationInput } from '../logging/logging-directory-isolation';
import { resolve } from 'node:path';
import { CalendarError } from './error';

export interface CalendarDirectoryIsolationInput extends LoggingDirectoryIsolationInput {
  /** Every known separately owned managed feature root. */
  readonly featureRoots?: readonly string[];
}

/** Disabling another feature retains its fixed private namespace; explicit active custom placements are reserved too. */
export function calendarOtherFeatureRoots(projectRoot: string, configured: readonly (string | false)[]): readonly string[] {
  return Object.freeze([...new Set([
    ...['data/zero.logs', 'data/zero.blog', 'data/zero.messaging', 'data/zero.jobs'].map(path => resolve(projectRoot, path)),
    ...configured.filter((path): path is string => typeof path === 'string'),
  ])]);
}

/** Calendar never shares a Storage namespace, public/build path, control file or another feature's conflict domain. */
export function assertCalendarDirectoryIsolation(input: CalendarDirectoryIsolationInput, canonical = false): void {
  try {
    assertLoggingDirectoryIsolation(input, canonical);
    for (const root of [input.storageDir, ...(input.featureRoots ?? [])]) {
      assertLoggingDirectoryIsolation({ ...input, applicationFabricRoot: root }, canonical);
    }
  } catch {
    // Never expose a private placement or filesystem/provider error to a caller.
    throw new CalendarError('CALENDAR_CONFIG_INVALID');
  }
}
