/**
 * storage-format.ts
 *
 * Formatting and path helpers for storage UI components. This file owns pure
 * presentation helpers only; it does not call hooks, mutate storage, or render
 * React components.
 */

/** Format byte counts for compact UI labels. */
export function formatStorageBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

/** Return true when a drive or file public value means public. */
export function isStoragePublic(value: number | string | boolean | undefined): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Build a child path under the current storage folder. */
export function joinStoragePath(parentPath: string | undefined, name: string): string {
  const cleanName = name.trim().replace(/^\/+|\/+$/g, '');
  if (!cleanName) return parentPath ?? '/';
  return parentPath ? `${parentPath.replace(/\/+$/g, '')}/${cleanName}` : `/${cleanName}`;
}

/** Build a renamed path next to the existing storage path. */
export function renameStoragePath(path: string, newName: string): string {
  const cleanName = newName.trim().replace(/^\/+|\/+$/g, '');
  const parent = path.split('/').slice(0, -1).join('/');
  return parent ? `${parent}/${cleanName}` : `/${cleanName}`;
}

/** Parse a comma-separated MIME list for the storage API. */
export function parseAllowedMimeTypes(value: unknown): string[] | undefined {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '*') return ['*'];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

/** Parse a non-negative storage byte limit, using zero for empty/unlimited. */
export function parseStorageLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : undefined;
}
