/** Validate the application-controlled prefix used for OS vault records. */

import { NativeAuthError } from './errors';

export function resolveNativeStorageNamespace(
  value: string | undefined,
  fallback: string,
): string {
  if (value === undefined) return fallback;
  const namespace = value.trim();
  if (!namespace || namespace.length > 200 || /[\u0000-\u001f\u007f]/.test(namespace)) {
    throw new NativeAuthError(
      'storageNamespace must be 1-200 characters without control characters.',
      'NATIVE_STORAGE_NAMESPACE_INVALID',
    );
  }
  return namespace;
}
