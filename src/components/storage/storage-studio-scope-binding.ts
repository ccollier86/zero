/** Single place for binding or clearing the browser Studio authorization scope. */

import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';

export function bindStorageStudioScope(
  surface: StorageStudioSdkSurface | null,
  scopeKey: string,
  available: boolean,
): void {
  if (!surface) return;
  if (available) surface.setScope(scopeKey);
  else surface.clear();
}

/** Fail closed before a deferred UI continuation reaches Studio transport. */
export function assertStorageStudioScopeCurrent(
  capturedKey: string,
  currentKey: string,
  ready: boolean,
): void {
  if (ready && capturedKey === currentKey) return;
  const stale = new Error(
    'Discarded a Storage Studio mutation from a previous authorization scope.',
  );
  stale.name = 'AbortError';
  throw stale;
}
