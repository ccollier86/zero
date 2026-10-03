/**
 * storage-adapter-isolation.ts
 *
 * Admits a Storage adapter against the physical isolation contract requested
 * by Storage Studio. It performs startup validation only and owns no adapter
 * I/O, drive policy, or HTTP behavior.
 */

import type {
  ResolvedStorageStudioConfig,
  StorageStudioIsolation,
} from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import type { StorageAdapter } from './types';

/**
 * Admit only adapters whose deletion and shutdown semantics preserve shared
 * CAS references across crashes, cancellation, and multiple runtimes.
 */
export function assertStorageAdapterSafety(adapter: StorageAdapter): void {
  const deletionSafe = typeof adapter.removeBlobSync === 'function';
  const shutdownSafety = adapter.writeShutdownSafety;
  const durablePublicationSafe = shutdownSafety === 'durable-publication'
    && typeof adapter.listPendingBlobPublications === 'function'
    && typeof adapter.settleBlobPublication === 'function';
  const shutdownSafe = shutdownSafety === 'cooperative' || durablePublicationSafe;
  if (deletionSafe && shutdownSafe) return;

  throw new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    'Storage adapter does not implement the required durability and shutdown contract.',
    {
      retryable: false,
      details: {
        synchronousDeleteFence: deletionSafe,
        writeShutdownSafety: shutdownSafety ?? 'undeclared',
        durablePublicationJournal: durablePublicationSafe,
      },
    },
  );
}

/** Fail closed before Storage Studio registers services or accepts traffic. */
export function assertStorageAdapterIsolation(
  adapter: StorageAdapter,
  config: ResolvedStorageStudioConfig,
): void {
  if (!config.enabled) return;
  const supported = normalizeIsolationModes(adapter.supportedStudioIsolation);
  if (supported.includes(config.isolation)
    && typeof adapter.removeBlobSync === 'function') return;

  throw new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    'Storage adapter does not implement the configured isolation contract.',
    {
      retryable: false,
      details: {
        requestedIsolation: config.isolation,
        declaredIsolationModes: supported.length,
        synchronousDeleteFence: typeof adapter.removeBlobSync === 'function',
      },
    },
  );
}

function normalizeIsolationModes(
  value: readonly StorageStudioIsolation[] | undefined,
): readonly StorageStudioIsolation[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const valid = value.filter((item): item is StorageStudioIsolation => (
    item === 'shared-cas'
  ));
  return Object.freeze([...new Set(valid)]);
}
