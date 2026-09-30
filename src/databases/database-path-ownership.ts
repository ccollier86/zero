/** Shared lexical and filesystem-aware database path ownership primitives. */

import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/** Conservative case/Unicode key for an already-resolved ownership path. */
export function databaseOwnershipPathKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .normalize('NFKC');
}

/** Resolve a path lexically before applying the portable ownership key. */
export function resolvedDatabaseOwnershipPathKey(
  input: string,
  baseDirectory = process.cwd(),
): string {
  const absolute = isAbsolute(input) ? input : resolve(baseDirectory, input);
  return databaseOwnershipPathKey(resolve(absolute));
}

/**
 * Resolve the deepest existing ancestor through the filesystem, then append
 * missing descendants without creating them.
 */
export function canonicalizeDatabasePathCandidate(
  input: string,
  baseDirectory = process.cwd(),
): string {
  const missing: string[] = [];
  let cursor = isAbsolute(input) ? resolve(input) : resolve(baseDirectory, input);

  while (true) {
    try {
      lstatSync(cursor);
      const canonical = realpathSync.native(cursor);
      return resolve(canonical, ...missing.reverse());
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }

    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('No filesystem ancestor.');
    missing.push(basename(cursor));
    cursor = parent;
  }
}

/** Canonical filesystem ownership key for an existing or future path. */
export function canonicalDatabaseOwnershipPathKey(
  input: string,
  baseDirectory = process.cwd(),
): string {
  return databaseOwnershipPathKey(
    canonicalizeDatabasePathCandidate(input, baseDirectory),
  );
}

function isMissingPath(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT',
  );
}
