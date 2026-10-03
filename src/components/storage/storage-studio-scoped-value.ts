/** Synchronous render fence for values loaded inside one Guardian scope. */

export interface StorageStudioScopedValue<T> {
  readonly scopeKey: string;
  readonly value: T;
}

export function bindStorageStudioValue<T>(
  scopeKey: string,
  value: T,
): StorageStudioScopedValue<T> {
  return Object.freeze({ scopeKey, value });
}

export function readStorageStudioValue<T>(
  scoped: StorageStudioScopedValue<T> | null,
  scopeKey: string,
  ready: boolean,
): T | null {
  return ready && scoped?.scopeKey === scopeKey ? scoped.value : null;
}
