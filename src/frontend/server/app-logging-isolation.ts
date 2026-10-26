/** Shared read-only logging path checks for build preparation and managed startup; starts no runtime services. */
import { assertLoggingDirectoryIsolation } from '../../logging/logging-directory-isolation';
import { resolveControlDatabasePaths } from '../../databases/database-directory-isolation';
import { resolveSystemDatabaseOwnedPaths } from './system-database-config';
import type { ResolvedConfig } from './types';
import { assertBlogContentDirectoryIsolation } from '../../blog/content-isolation';

/** Validate before asset cleanup, directory creation or SQLite opens, including existing filesystem aliases. */
export function assertManagedAppLoggingIsolation(config: ResolvedConfig, canonical = false): void {
  if (config.blogContent) assertBlogContentDirectoryIsolation({
    rootDirectory: config.blogContent.rootDirectory, outDir: config.outDir, storageDir: config.storageDir, generatedDir: config.generatedDir, appDir: config.appDir,
    controlDatabasePaths: [...resolveControlDatabasePaths(config.db), ...resolveSystemDatabaseOwnedPaths(config.systemDb)],
    ...(config.logging ? { loggingRoot: config.logging.rootDirectory } : {}),
    ...(config.databaseTopology.mode === 'multiple' ? { applicationFabricRoot: config.databaseTopology.rootDirectory } : {}),
  }, canonical);
  if (!config.logging) return;
  assertLoggingDirectoryIsolation({ rootDirectory: config.logging.rootDirectory,
    outDir: config.outDir, storageDir: config.storageDir, generatedDir: config.generatedDir, appDir: config.appDir,
    controlDatabasePaths: [...resolveControlDatabasePaths(config.db), ...resolveSystemDatabaseOwnedPaths(config.systemDb)],
    ...(config.databaseTopology.mode === 'multiple' ? { applicationFabricRoot: config.databaseTopology.rootDirectory } : {}),
  }, canonical);
}
