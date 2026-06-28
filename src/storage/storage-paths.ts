/**
 * storage-paths.ts
 *
 * Defines pure storage object path helpers shared by storage hooks and UI
 * components. This file owns path normalization only; it does not call storage
 * APIs, inspect permissions, or render UI.
 */

/** Remove leading and trailing separators from a storage path. */
export function trimStoragePath(path: string | null | undefined): string {
  return String(path ?? '').trim().replace(/^\/+|\/+$/g, '');
}

/** Build an absolute storage object path under an optional folder path. */
export function joinStorageObjectPath(folderPath: string | null | undefined, name: string): string {
  const cleanFolder = trimStoragePath(folderPath);
  const cleanName = trimStoragePath(name);
  if (!cleanName) return cleanFolder ? `/${cleanFolder}` : '/';
  return cleanFolder ? `/${cleanFolder}/${cleanName}` : `/${cleanName}`;
}

/** Encode path segments for wildcard storage routes while preserving folders. */
export function encodeStoragePath(path: string): string {
  const cleaned = trimStoragePath(path);
  return cleaned.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
