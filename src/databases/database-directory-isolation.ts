/**
 * database-directory-isolation.ts
 *
 * Path-ownership checks for Fabric-managed database roots. Configuration uses
 * the pure lexical check; createApp repeats it through existing filesystem
 * aliases before build or storage initialization can mutate either domain.
 */

import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { resolveSQLiteStorageConfig } from '../persistence/storage-config';
import type { SQLiteStorageConfig } from '../persistence/storage-types';

/** Directory ownership conflicts which make a Fabric root unsafe. */
export type DatabaseDirectoryConflict =
  | 'build-output'
  | 'control-database'
  | 'storage-root'
  | 'storage-temp'
  | 'storage-blobs';

export interface DatabaseDirectoryIsolationInput {
  readonly rootDirectory: string;
  readonly outDir: string;
  readonly storageDir: string;
  readonly controlDatabasePaths?: readonly string[];
}

interface DatabasePathConfig extends SQLiteStorageConfig {
  readonly sqlite?: {
    readonly path: string | null;
    readonly snapshotPath: string | null;
  };
  readonly database?: unknown;
}

/** Resolve only the effective, inspectable default/control database paths. */
export function resolveControlDatabasePaths(
  db: DatabasePathConfig,
): readonly string[] {
  if (db.sqlite) {
    return expandSQLiteOwnedPaths([db.sqlite.path, db.sqlite.snapshotPath]);
  }
  if (db.database) return Object.freeze([]);

  const resolved = resolveSQLiteStorageConfig(db);
  return expandSQLiteOwnedPaths([resolved.path, resolved.snapshotPath]);
}

/**
 * Find the first deterministic directory-ownership conflict.
 *
 * A dedicated, unowned child such as `{storageDir}/databases` is allowed for
 * compatibility. The storage root itself, a root which contains storage, and
 * the adapter-owned `tmp`/`blobs` namespaces are not Fabric-owned locations.
 */
export function findDatabaseDirectoryConflict({
  rootDirectory,
  outDir,
  storageDir,
  controlDatabasePaths = [],
}: DatabaseDirectoryIsolationInput): DatabaseDirectoryConflict | null {
  const root = resolve(rootDirectory);
  const output = resolve(outDir);
  const storage = resolve(storageDir);

  return findResolvedDatabaseDirectoryConflict({
    root,
    output,
    storage,
    storageTemp: resolve(storage, 'tmp'),
    storageBlobs: resolve(storage, 'blobs'),
    controlDatabasePaths: controlDatabasePaths.map((path) => resolve(path)),
  });
}

/**
 * Repeat the isolation check through existing filesystem aliases.
 *
 * This read-only startup fence catches symlinked ancestors and platform aliases
 * which a lexical config check cannot see. It must run before build or storage
 * initialization can modify either ownership domain.
 */
export function assertCanonicalDatabaseDirectoryIsolation(
  input: DatabaseDirectoryIsolationInput,
): void {
  let conflict: DatabaseDirectoryConflict | null;
  try {
    const storage = canonicalizePathCandidate(input.storageDir);
    conflict = findResolvedDatabaseDirectoryConflict({
      root: canonicalizePathCandidate(input.rootDirectory),
      output: canonicalizePathCandidate(input.outDir),
      storage,
      storageTemp: canonicalizePathCandidate(join(input.storageDir, 'tmp')),
      storageBlobs: canonicalizePathCandidate(join(input.storageDir, 'blobs')),
      controlDatabasePaths: (input.controlDatabasePaths ?? []).map(
        canonicalizePathCandidate,
      ),
    });
  } catch {
    throw new Error(
      '[app] database directory isolation could not be validated.',
    );
  }

  throwDatabaseDirectoryConflict(conflict);
}

interface ResolvedDatabaseDirectoryPaths {
  readonly root: string;
  readonly output: string;
  readonly storage: string;
  readonly storageTemp: string;
  readonly storageBlobs: string;
  readonly controlDatabasePaths: readonly string[];
}

function findResolvedDatabaseDirectoryConflict({
  root,
  output,
  storage,
  storageTemp,
  storageBlobs,
  controlDatabasePaths,
}: ResolvedDatabaseDirectoryPaths): DatabaseDirectoryConflict | null {
  if (pathsOverlap(root, output)) return 'build-output';

  if (controlDatabasePaths.some((path) => pathsOverlap(root, path))) {
    return 'control-database';
  }

  if (pathsEqual(root, storage) || isWithin(storage, root)) return 'storage-root';
  if (pathsOverlap(root, storageTemp)) return 'storage-temp';
  if (pathsOverlap(root, storageBlobs)) return 'storage-blobs';
  return null;
}

/** Fail configuration resolution before any build or storage cleanup begins. */
export function assertDatabaseDirectoryIsolation(
  input: DatabaseDirectoryIsolationInput,
): void {
  const conflict = findDatabaseDirectoryConflict(input);
  throwDatabaseDirectoryConflict(conflict);
}

function throwDatabaseDirectoryConflict(
  conflict: DatabaseDirectoryConflict | null,
): void {
  switch (conflict) {
    case 'build-output':
      throw new Error(
        '[app] databaseTopology.rootDirectory must not overlap outDir.',
      );
    case 'control-database':
      throw new Error(
        '[app] databaseTopology.rootDirectory must not overlap a default/control database path.',
      );
    case 'storage-root':
      throw new Error(
        '[app] databaseTopology.rootDirectory must not reuse or contain storageDir.',
      );
    case 'storage-temp':
      throw new Error(
        '[app] databaseTopology.rootDirectory must not overlap the object-storage temporary directory.',
      );
    case 'storage-blobs':
      throw new Error(
        '[app] databaseTopology.rootDirectory must not overlap the object-storage blob directory.',
      );
    case null:
      return;
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return pathsEqual(left, right)
    || isWithin(left, right)
    || isWithin(right, left);
}

function isWithin(candidate: string, parent: string): boolean {
  return ownershipPathKey(candidate).startsWith(
    `${ownershipPathKey(parent)}${sep}`,
  );
}

function pathsEqual(left: string, right: string): boolean {
  return ownershipPathKey(left) === ownershipPathKey(right);
}

/**
 * Conservatively reject case/Unicode-only ownership distinctions on every OS.
 * This keeps configs portable and closes initially-missing aliases on default
 * case-insensitive macOS and Windows volumes without probing or creating them.
 */
function ownershipPathKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .normalize('NFKC');
}

function expandSQLiteOwnedPaths(
  paths: readonly (string | null)[],
): readonly string[] {
  const owned = new Set<string>();
  for (const path of paths) {
    if (path === null) continue;
    owned.add(path);
    owned.add(`${path}-wal`);
    owned.add(`${path}-shm`);
    owned.add(`${path}-journal`);
  }
  return Object.freeze([...owned]);
}

/** Resolve the deepest existing ancestor without creating filesystem state. */
function canonicalizePathCandidate(input: string): string {
  const missing: string[] = [];
  let cursor = resolve(input);

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

function isMissingPath(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT',
  );
}
