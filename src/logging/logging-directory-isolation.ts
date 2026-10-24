/** Read-only logging path admission before builds or database ownership can change the filesystem. */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { assertCanonicalDatabaseDirectoryIsolation, assertDatabaseDirectoryIsolation } from '../databases/database-directory-isolation';
import { canonicalizeDatabasePathCandidate, databaseOwnershipPathKey } from '../databases/database-path-ownership';
import { LoggingError } from './logging-error';

export interface LoggingDirectoryIsolationInput {
  readonly rootDirectory: string;
  readonly outDir: string;
  readonly storageDir: string;
  readonly controlDatabasePaths: readonly string[];
  readonly generatedDir: string;
  readonly appDir: string;
  readonly applicationFabricRoot?: string;
}

/** Repeat lexically during resolution and canonically before any startup mutations. Never include paths in errors. */
export function assertLoggingDirectoryIsolation(input: LoggingDirectoryIsolationInput, canonical = false): void {
  try {
    (canonical ? assertCanonicalDatabaseDirectoryIsolation : assertDatabaseDirectoryIsolation)(input);
    const path = canonical ? canonicalizeDatabasePathCandidate : resolve;
    const root = databaseOwnershipPathKey(path(input.rootDirectory));
    for (const candidate of [input.generatedDir, input.appDir, input.applicationFabricRoot]) {
      if (candidate === undefined) continue;
      const other = databaseOwnershipPathKey(path(candidate));
      if (overlaps(root, other)) throw new Error();
    }
  } catch { throw new LoggingError('LOGGING_CONFIG_INVALID', 'Logging storage must be separate from application/control databases, Fabric, assets and storage-owned directories.'); }
}

function overlaps(left: string, right: string): boolean {
  const within = (child: string, parent: string) => {
    const r = relative(parent, child);
    return r === '' || r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r);
  };
  return within(left, right) || within(right, left);
}
