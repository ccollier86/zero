/** Startup admission tests for Storage Studio adapter isolation contracts. */

import { describe, expect, test } from 'bun:test';
import {
  assertStorageAdapterIsolation,
  assertStorageAdapterSafety,
} from './storage-adapter-isolation';
import { resolveStorageStudioConfig } from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import { LOCAL_STORAGE_STUDIO_ISOLATION } from './local-adapter';
import { StorageService } from './storage-service';
import type { StorageAdapter } from './types';

const inertAdapter: StorageAdapter = {
  async writeBlob() {
    return { checksum: '0'.repeat(64), size: 0, headBytes: new Uint8Array() };
  },
  async readBlob() { return null; },
  async readBlobRange() { return null; },
  async removeBlob() {},
  async blobExists() { return false; },
  async blobSize() { return 0; },
};

describe('Storage adapter isolation admission', () => {
  test('rejects unsafe deletion and shutdown contracts even without Studio', () => {
    expect(() => assertStorageAdapterSafety(inertAdapter)).toThrow(
      'required durability and shutdown contract',
    );
    expect(() => assertStorageAdapterSafety({
      ...inertAdapter,
      writeShutdownSafety: 'cooperative',
      removeBlobSync() {},
    })).not.toThrow();
    expect(() => assertStorageAdapterSafety({
      ...inertAdapter,
      writeShutdownSafety: 'durable-publication',
      removeBlobSync() {},
    })).toThrow('required durability and shutdown contract');
    expect(() => new StorageService(null as never, inertAdapter)).toThrow(
      'required durability and shutdown contract',
    );
  });

  test('skips the additional Studio isolation declaration while Studio is disabled', () => {
    expect(() => assertStorageAdapterIsolation(
      inertAdapter,
      resolveStorageStudioConfig(undefined),
    )).not.toThrow();
  });

  test('rejects undeclared or unsupported isolation when Studio is enabled', () => {
    for (const adapter of [
      inertAdapter,
      { ...inertAdapter, supportedStudioIsolation: ['reserved-mode'] as never },
    ]) {
      try {
        assertStorageAdapterIsolation(adapter, resolveStorageStudioConfig({
          enabled: true,
          isolation: 'shared-cas',
        }));
        throw new Error('Expected adapter admission to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageDomainError);
        expect((error as StorageDomainError).code).toBe('STORAGE_PROVIDER_UNAVAILABLE');
      }
    }
    expect(() => resolveStorageStudioConfig({
      enabled: true,
      isolation: 'tenant-namespace',
    } as never)).toThrow('storage.studio.isolation must be one of: shared-cas');
  });

  test('declares only shared CAS for the local adapter', () => {
    expect(LOCAL_STORAGE_STUDIO_ISOLATION).toEqual(['shared-cas']);
    expect(() => assertStorageAdapterIsolation(
      {
        ...inertAdapter,
        writeShutdownSafety: 'cooperative',
        supportedStudioIsolation: LOCAL_STORAGE_STUDIO_ISOLATION,
        removeBlobSync() {},
      },
      resolveStorageStudioConfig({ enabled: true, isolation: 'shared-cas' }),
    )).not.toThrow();
  });
});
