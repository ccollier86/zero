/**
 * platform-sqlite-runtime.ts
 *
 * Owns the current process-wide SQLite service reference. This is a lookup
 * boundary for app-owned backend code; it does not create databases, mount
 * plugins, or own shutdown order.
 */

import type { PlatformSQLiteService } from './storage-types';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';

const sqliteProviders = new CompatibilityProviderRegistry<PlatformSQLiteService>(
  'Platform SQLite service',
);
const registrations = new Map<PlatformSQLiteService, ReturnType<typeof sqliteProviders.register>>();

/** Return the active platform SQLite service, when one has been registered. */
export function getPlatformSQLiteService(): PlatformSQLiteService | null {
  return sqliteProviders.get();
}

/** Return the active platform SQLite service or throw a clear setup error. */
export function requirePlatformSQLiteService(): PlatformSQLiteService {
  const service = getPlatformSQLiteService();
  if (!service) {
    throw new Error('[persistence] Platform SQLite service is unavailable. Mount createApp() or createSyncPlugin() before using zero.sql.');
  }

  return service;
}

/**
 * Register the active platform SQLite service for backend service lookups.
 *
 * Lifecycle ownership stays with the caller that created the service.
 */
export function setPlatformSQLiteService(service: PlatformSQLiteService | null): void {
  if (!service || registrations.has(service)) return;
  registrations.set(service, sqliteProviders.register(service, () => service));
}

/** Clear the active service only if it still matches the expected instance. */
export function clearPlatformSQLiteService(service: PlatformSQLiteService | null): void {
  if (!service) return;
  registrations.get(service)?.unregister();
  registrations.delete(service);
}
