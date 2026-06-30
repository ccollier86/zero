/**
 * platform-sqlite-runtime.ts
 *
 * Owns the current process-wide SQLite service reference. This is a lookup
 * boundary for app-owned backend code; it does not create databases, mount
 * plugins, or own shutdown order.
 */

import type { PlatformSQLiteService } from './storage-types';

let currentSQLiteService: PlatformSQLiteService | null = null;

/** Return the active platform SQLite service, when one has been registered. */
export function getPlatformSQLiteService(): PlatformSQLiteService | null {
  return currentSQLiteService;
}

/** Return the active platform SQLite service or throw a clear setup error. */
export function requirePlatformSQLiteService(): PlatformSQLiteService {
  if (!currentSQLiteService) {
    throw new Error('[persistence] Platform SQLite service is unavailable. Mount createApp() or createSyncPlugin() before using zero.sql.');
  }

  return currentSQLiteService;
}

/**
 * Register the active platform SQLite service for backend service lookups.
 *
 * Lifecycle ownership stays with the caller that created the service.
 */
export function setPlatformSQLiteService(service: PlatformSQLiteService | null): void {
  currentSQLiteService = service;
}

/** Clear the active service only if it still matches the expected instance. */
export function clearPlatformSQLiteService(service: PlatformSQLiteService | null): void {
  if (!service || currentSQLiteService === service) currentSQLiteService = null;
}
