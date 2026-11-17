/** Shared read-only logging path checks for build preparation and managed startup; starts no runtime services. */
import { assertLoggingDirectoryIsolation } from '../../logging/logging-directory-isolation';
import { resolveControlDatabasePaths } from '../../databases/database-directory-isolation';
import { resolveSystemDatabaseOwnedPaths } from './system-database-config';
import type { ResolvedConfig } from './types';
import { assertBlogContentDirectoryIsolation } from '../../blog/content-isolation';
import { assertMessagingDirectoryIsolation } from '../../messaging/isolation';
import { assertJobsDirectoryIsolation } from '../../jobs/isolation';
import { assertCalendarDirectoryIsolation, calendarOtherFeatureRoots } from '../../calendar/isolation';

/** Validate before asset cleanup, directory creation or SQLite opens, including existing filesystem aliases. */
export function assertManagedAppLoggingIsolation(config: ResolvedConfig, canonical = false): void {
  if (config.calendar) assertCalendarDirectoryIsolation({ rootDirectory: config.calendar.rootDirectory, outDir: config.outDir, storageDir: config.storageDir, generatedDir: config.generatedDir, appDir: config.appDir,
    controlDatabasePaths: [...resolveControlDatabasePaths(config.db), ...resolveSystemDatabaseOwnedPaths(config.systemDb)],
    featureRoots: calendarOtherFeatureRoots(config.projectRoot, [config.logging && config.logging.rootDirectory, config.blogContent && config.blogContent.rootDirectory, config.messaging && config.messaging.rootDirectory, config.jobs && config.jobs.rootDirectory]),
    ...(config.databaseTopology.mode === 'multiple' ? { applicationFabricRoot: config.databaseTopology.rootDirectory } : {}),
  }, canonical);
  if (config.jobs) assertJobsDirectoryIsolation({ rootDirectory: config.jobs.rootDirectory, outDir: config.outDir, storageDir: config.storageDir, generatedDir: config.generatedDir, appDir: config.appDir,
    controlDatabasePaths: [...resolveControlDatabasePaths(config.db), ...resolveSystemDatabaseOwnedPaths(config.systemDb)],
    featureRoots: [config.logging && config.logging.rootDirectory, config.blogContent && config.blogContent.rootDirectory, config.messaging && config.messaging.rootDirectory].filter((root): root is string => typeof root === 'string'),
    ...(config.databaseTopology.mode === 'multiple' ? { applicationFabricRoot: config.databaseTopology.rootDirectory } : {}),
  }, canonical);
  if (config.messaging) assertMessagingDirectoryIsolation({ rootDirectory: config.messaging.rootDirectory, outDir: config.outDir, storageDir: config.storageDir, generatedDir: config.generatedDir, appDir: config.appDir,
    controlDatabasePaths: [...resolveControlDatabasePaths(config.db), ...resolveSystemDatabaseOwnedPaths(config.systemDb)],
    ...(config.logging ? { loggingRoot: config.logging.rootDirectory } : {}), ...(config.blogContent ? { blogRoot: config.blogContent.rootDirectory } : {}),
    ...(config.databaseTopology.mode === 'multiple' ? { applicationFabricRoot: config.databaseTopology.rootDirectory } : {}),
  }, canonical);
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
