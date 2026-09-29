/**
 * database-file.ts
 *
 * Converts opaque logical database identifiers into deterministic local file
 * names and owns the filesystem safety boundary for creating those files.
 * It deliberately knows nothing about SQLite connections or database runtime
 * lifecycle.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  openDatabaseFileIdentityGuard,
  type DatabaseFileIdentityProof,
} from './database-file-identity';

const DATABASE_ID_HASH_DOMAIN = 'zero.database-id.v1\0';
const DATABASE_REF_HASH_DOMAIN = 'zero.database-ref.v1\0';
const DATABASE_FILE_HINT_MAX_LENGTH = 24;
const DATABASE_REF_PATTERN = /^[0-9a-f]{64}$/u;
const MANAGED_DATABASE_FILE_PATTERN =
  /^db-[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,23}-[0-9a-f]{64}\.sqlite$/u;

/** Maximum size of a normalized logical database identifier in UTF-8 bytes. */
export const DATABASE_ID_MAX_BYTES = 256;

declare const databaseIdBrand: unique symbol;
declare const databaseRefBrand: unique symbol;

/** A validated, NFC-normalized logical identifier. It is never used as a path. */
export type DatabaseId = string & { readonly [databaseIdBrand]: true };

/**
 * Stable pseudonymous routing/correlation digest. It is not a secret or an
 * authentication capability; low-entropy logical IDs can be dictionary
 * correlated because derivation is deterministic and unkeyed.
 */
export type DatabaseRef = string & { readonly [databaseRefBrand]: true };

export type DatabasePathErrorCode =
  | 'DATABASE_ID_INVALID'
  | 'DATABASE_REF_INVALID'
  | 'DATABASE_ROOT_INVALID'
  | 'DATABASE_PATH_ESCAPE'
  | 'DATABASE_PATH_SYMLINK'
  | 'DATABASE_PATH_TYPE';

/** Stable error shape for invalid identifiers and unsafe filesystem layouts. */
export class DatabasePathError extends Error {
  constructor(
    readonly code: DatabasePathErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DatabasePathError';
  }
}

/** The deterministic location of one logical database under a configured root. */
export interface ResolvedDatabaseFile {
  readonly id: DatabaseId;
  readonly rootDirectory: string;
  readonly path: string;
  readonly fileName: string;
}

/** A location whose root and database file have passed filesystem checks. */
export interface PreparedDatabaseFile extends ResolvedDatabaseFile {
  /** True only when this call atomically reserved a new empty file. */
  readonly created: boolean;
  /** Exact regular-file inode admitted by the parent for actor handoff. */
  readonly identity: DatabaseFileIdentityProof;
}

/**
 * Create, harden, and return the canonical path of a managed database root.
 *
 * Existing ancestor aliases are resolved before missing descendants are
 * created. The configured root itself may not be a symbolic link.
 */
export function prepareDatabaseRoot(rootDirectory: string): string {
  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  const canonicalCandidate = canonicalizeDatabaseRoot(normalizedRoot);
  prepareRootDirectory(canonicalCandidate);
  return realpathSync.native(canonicalCandidate);
}

/**
 * Validate and canonically normalize a logical database identifier.
 *
 * Identifiers are case-sensitive. Canonically equivalent Unicode spellings
 * resolve to the same ID, while whitespace is never silently discarded.
 */
export function normalizeDatabaseId(input: string): DatabaseId {
  if (typeof input !== 'string') {
    throw new DatabasePathError('DATABASE_ID_INVALID', 'Database ID must be a string.');
  }
  if (!isWellFormedUnicode(input)) {
    throw new DatabasePathError(
      'DATABASE_ID_INVALID',
      'Database ID must contain well-formed Unicode.',
    );
  }

  const normalized = input.normalize('NFC');
  if (normalized.length === 0) {
    throw new DatabasePathError('DATABASE_ID_INVALID', 'Database ID must not be empty.');
  }
  if (normalized.trim() !== normalized) {
    throw new DatabasePathError(
      'DATABASE_ID_INVALID',
      'Database ID must not contain leading or trailing whitespace.',
    );
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new DatabasePathError(
      'DATABASE_ID_INVALID',
      'Database ID must not contain control characters.',
    );
  }

  const byteLength = new TextEncoder().encode(normalized).byteLength;
  if (byteLength > DATABASE_ID_MAX_BYTES) {
    throw new DatabasePathError(
      'DATABASE_ID_INVALID',
      `Database ID must not exceed ${DATABASE_ID_MAX_BYTES} UTF-8 bytes.`,
    );
  }

  return normalized as DatabaseId;
}

/** Encode a logical ID as a flat, cross-platform-safe SQLite filename. */
export function encodeDatabaseFileName(input: DatabaseId | string): string {
  const id = normalizeDatabaseId(input);
  const hint = createSafeHint(id);
  const digest = createHash('sha256')
    .update(DATABASE_ID_HASH_DOMAIN, 'utf8')
    .update(id, 'utf8')
    .digest('hex');
  return `db-${hint}-${digest}.sqlite`;
}

/** Derive the deterministic, hint-free pseudonymous routing reference. */
export function createDatabaseRef(input: DatabaseId | string): DatabaseRef {
  const id = normalizeDatabaseId(input);
  return createHash('sha256')
    .update(DATABASE_REF_HASH_DOMAIN, 'utf8')
    .update(id, 'utf8')
    .digest('hex') as DatabaseRef;
}

/** Validate an opaque reference received at an internal protocol boundary. */
export function normalizeDatabaseRef(input: string): DatabaseRef {
  if (typeof input !== 'string' || !DATABASE_REF_PATTERN.test(input)) {
    throw new DatabasePathError(
      'DATABASE_REF_INVALID',
      'Database reference must be a lowercase SHA-256 digest.',
    );
  }
  return input as DatabaseRef;
}

/**
 * Resolve a database location without touching the filesystem.
 *
 * The logical ID is always encoded; it is never interpolated into a path.
 * Filesystem symlink and permission checks belong to prepareDatabaseFile().
 */
export function resolveDatabaseFile(
  rootDirectory: string,
  input: DatabaseId | string,
): ResolvedDatabaseFile {
  const id = normalizeDatabaseId(input);
  const root = normalizeRootDirectory(rootDirectory);
  const fileName = encodeDatabaseFileName(id);
  const filePath = resolve(root, fileName);

  assertContainedFile(root, filePath);
  if (basename(filePath) !== fileName || dirname(filePath) !== root) {
    throw new DatabasePathError(
      'DATABASE_PATH_ESCAPE',
      'Encoded database path did not remain a direct child of its root directory.',
    );
  }

  return Object.freeze({ id, rootDirectory: root, path: filePath, fileName });
}

/**
 * Create and harden a database root, then atomically reserve or verify its file.
 *
 * On POSIX systems the root is restricted to 0700 and the file to 0600. The
 * same calls are not meaningful ACL enforcement on Windows, so Windows still
 * receives path/symlink/type checks while ACL policy remains a deployment
 * responsibility.
 */
export function prepareDatabaseFile(
  rootDirectory: string,
  input: DatabaseId | string,
): PreparedDatabaseFile {
  return prepareDatabaseFileInternal(rootDirectory, input, null, null);
}

/**
 * Coordinator-only creation boundary.
 *
 * `admitCreation` runs synchronously only when the managed main file is
 * absent, immediately before its O_EXCL reservation. The coordinator invokes
 * this while it owns both the physical root and its catalog gate, keeping a
 * capacity decision and creation in one serialized critical section.
 * `recordCreation`, when provided, runs immediately after O_EXCL succeeds and
 * before later hardening checks, so a retained file is charged even if one of
 * those checks subsequently fails.
 * Existing managed files bypass admission and always remain openable.
 *
 * @internal
 */
export function prepareDatabaseFileWithCreationAdmission(
  rootDirectory: string,
  input: DatabaseId | string,
  admitCreation: () => void,
  recordCreation?: () => void,
): PreparedDatabaseFile {
  if (typeof admitCreation !== 'function') {
    throw new DatabasePathError(
      'DATABASE_ROOT_INVALID',
      'Database file creation admission must be a function.',
    );
  }
  if (recordCreation !== undefined && typeof recordCreation !== 'function') {
    throw new DatabasePathError(
      'DATABASE_ROOT_INVALID',
      'Database file creation recorder must be a function.',
    );
  }
  return prepareDatabaseFileInternal(
    rootDirectory,
    input,
    admitCreation,
    recordCreation ?? null,
  );
}

/** Count exact regular Zero-managed main database files, excluding sidecars. */
export function countZeroManagedDatabaseFiles(rootDirectory: string): number {
  const canonicalRoot = prepareDatabaseRoot(rootDirectory);
  let count = 0;
  for (const name of readdirSync(canonicalRoot)) {
    if (!MANAGED_DATABASE_FILE_PATTERN.test(name)) continue;
    if (tryLstat(join(canonicalRoot, name))?.isFile()) count += 1;
  }
  return count;
}

function prepareDatabaseFileInternal(
  rootDirectory: string,
  input: DatabaseId | string,
  admitCreation: (() => void) | null,
  recordCreation: (() => void) | null,
): PreparedDatabaseFile {
  // Preserve resolveDatabaseFile()'s validation order: reject an invalid
  // logical ID before creating or hardening filesystem state.
  const id = normalizeDatabaseId(input);

  // Return canonical paths after the root exists. The configured root itself
  // may not be a symlink, while an already-existing ancestor alias (for
  // example macOS /var -> /private/var) is resolved before any directory or
  // file is created.
  const canonicalRoot = prepareDatabaseRoot(rootDirectory);
  const location = resolveDatabaseFile(canonicalRoot, id);
  assertNoSymlinkComponents(location.rootDirectory, false);
  assertExistingDatabaseFile(location);

  const created = reserveAndHardenDatabaseFile(
    location,
    admitCreation,
    recordCreation,
  );
  assertExistingDatabaseFile(location, true);

  const identityGuard = openDatabaseFileIdentityGuard(location.path, {
    access: 'readwrite',
  });
  const identity = identityGuard.proof;
  identityGuard.release();

  return Object.freeze({ ...location, created, identity });
}

/**
 * Resolve existing ancestor aliases without accepting a symlink as the
 * configured database root itself.
 *
 * Walking to the deepest existing ancestor lets a root such as
 * `/var/lib/app/databases` work on systems where `/var` is a platform-managed
 * alias. Missing descendants are appended only after `realpath()` establishes
 * the ancestor's canonical location, and the normal no-symlink checks then
 * protect every component which Zero creates or owns.
 */
function canonicalizeDatabaseRoot(rootDirectory: string): string {
  const missingParts: string[] = [];
  let cursor = rootDirectory;

  while (true) {
    const details = tryLstat(cursor);
    if (details) {
      if (cursor === rootDirectory && details.isSymbolicLink()) {
        throw new DatabasePathError(
          'DATABASE_PATH_SYMLINK',
          'Database root directory must not be a symbolic link.',
        );
      }

      let canonicalAncestor: string;
      try {
        canonicalAncestor = realpathSync.native(cursor);
      } catch (error) {
        if (details.isSymbolicLink() || isErrno(error, 'ELOOP')) {
          throw new DatabasePathError(
            'DATABASE_PATH_SYMLINK',
            'Database root contains an unresolved symbolic-link ancestor.',
            { cause: error },
          );
        }
        throw error;
      }

      if (!lstatSync(canonicalAncestor).isDirectory()) {
        throw new DatabasePathError(
          'DATABASE_PATH_TYPE',
          'Database root path must be a directory.',
        );
      }

      return resolve(canonicalAncestor, ...missingParts.reverse());
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new DatabasePathError(
        'DATABASE_ROOT_INVALID',
        'Database root has no resolvable filesystem ancestor.',
      );
    }
    missingParts.push(basename(cursor));
    cursor = parent;
  }
}

function normalizeRootDirectory(input: string): string {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new DatabasePathError(
      'DATABASE_ROOT_INVALID',
      'Database root directory must be a non-empty path without null bytes.',
    );
  }

  const root = resolve(input);
  if (root === parse(root).root) {
    throw new DatabasePathError(
      'DATABASE_ROOT_INVALID',
      'Database root directory must not be a filesystem root.',
    );
  }
  return root;
}

function prepareRootDirectory(rootDirectory: string): void {
  assertNoSymlinkComponents(rootDirectory, true);
  mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(rootDirectory, false);

  const details = lstatSync(rootDirectory);
  if (details.isSymbolicLink()) {
    throw new DatabasePathError(
      'DATABASE_PATH_SYMLINK',
      'Database root directory must not be a symbolic link.',
    );
  }
  if (!details.isDirectory()) {
    throw new DatabasePathError(
      'DATABASE_PATH_TYPE',
      'Database root path must be a directory.',
    );
  }

  hardenRootDirectory(rootDirectory);
  assertNoSymlinkComponents(rootDirectory, false);
}

function hardenRootDirectory(rootDirectory: string): void {
  if (process.platform === 'win32') return;

  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const directoryOnly = typeof fsConstants.O_DIRECTORY === 'number' ? fsConstants.O_DIRECTORY : 0;
  let descriptor: number;
  try {
    descriptor = openSync(rootDirectory, fsConstants.O_RDONLY | noFollow | directoryOnly);
  } catch (error) {
    if (isErrno(error, 'ELOOP')) {
      throw new DatabasePathError(
        'DATABASE_PATH_SYMLINK',
        'Database root directory must not be a symbolic link.',
        { cause: error },
      );
    }
    throw error;
  }

  try {
    if (!fstatSync(descriptor).isDirectory()) {
      throw new DatabasePathError(
        'DATABASE_PATH_TYPE',
        'Database root path must be a directory.',
      );
    }
    fchmodSync(descriptor, 0o700);
  } finally {
    closeSync(descriptor);
  }
}

function assertNoSymlinkComponents(absolutePath: string, allowMissing: boolean): void {
  const filesystemRoot = parse(absolutePath).root;
  const pathParts = relative(filesystemRoot, absolutePath).split(sep).filter(Boolean);
  let cursor = filesystemRoot;

  for (const part of pathParts) {
    cursor = join(cursor, part);
    const details = tryLstat(cursor);
    if (!details) {
      if (allowMissing) return;
      throw new DatabasePathError(
        'DATABASE_PATH_TYPE',
        'Database path contains a missing component after root preparation.',
      );
    }
    if (details.isSymbolicLink()) {
      throw new DatabasePathError(
        'DATABASE_PATH_SYMLINK',
        `Database path contains a symbolic link: ${cursor}`,
      );
    }
    if (!details.isDirectory()) {
      throw new DatabasePathError(
        'DATABASE_PATH_TYPE',
        `Database path component is not a directory: ${cursor}`,
      );
    }
  }
}

function assertExistingDatabaseFile(
  location: ResolvedDatabaseFile,
  requireExisting = false,
): void {
  assertContainedFile(location.rootDirectory, location.path);
  const details = tryLstat(location.path);
  if (!details) {
    if (requireExisting) {
      throw new DatabasePathError(
        'DATABASE_PATH_TYPE',
        'Prepared database file disappeared during validation.',
      );
    }
    return;
  }
  if (details.isSymbolicLink()) {
    throw new DatabasePathError(
      'DATABASE_PATH_SYMLINK',
      'Database file must not be a symbolic link.',
    );
  }
  if (!details.isFile()) {
    throw new DatabasePathError(
      'DATABASE_PATH_TYPE',
      'Database file path must be a regular file.',
    );
  }
  if (details.nlink !== 1) {
    throw new DatabasePathError(
      'DATABASE_PATH_TYPE',
      'Database file must not have hardlink aliases.',
    );
  }

  const realFilePath = realpathSync.native(location.path);
  assertContainedFile(location.rootDirectory, realFilePath);
}

function reserveAndHardenDatabaseFile(
  location: ResolvedDatabaseFile,
  admitCreation: (() => void) | null,
  recordCreation: (() => void) | null,
): boolean {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const createFlags = fsConstants.O_CREAT
    | fsConstants.O_EXCL
    | fsConstants.O_RDWR
    | noFollow;
  let descriptor: number;
  let created = false;

  if (!tryLstat(location.path)) admitCreation?.();

  try {
    descriptor = openSync(location.path, createFlags, 0o600);
    created = true;
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) {
      if (isErrno(error, 'ELOOP')) {
        throw new DatabasePathError(
          'DATABASE_PATH_SYMLINK',
          'Database file must not be a symbolic link.',
          { cause: error },
        );
      }
      throw error;
    }
    descriptor = openExistingDatabaseFile(location.path, noFollow);
  }

  try {
    // Charge the durable main-file identity immediately after O_EXCL creates
    // it. Any later hardening or validation failure leaves that file present,
    // so capacity accounting must retain the charge as well.
    if (created) recordCreation?.();
    const details = fstatSync(descriptor, { bigint: true });
    if (!details.isFile()) {
      throw new DatabasePathError(
        'DATABASE_PATH_TYPE',
        'Database file path must be a regular file.',
      );
    }
    if (details.nlink !== 1n) {
      throw new DatabasePathError(
        'DATABASE_PATH_TYPE',
        'Database file must not have hardlink aliases.',
      );
    }
    if (process.platform !== 'win32') fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }

  return created;
}

function openExistingDatabaseFile(filePath: string, noFollow: number): number {
  try {
    return openSync(filePath, fsConstants.O_RDWR | noFollow);
  } catch (error) {
    if (isErrno(error, 'ELOOP')) {
      throw new DatabasePathError(
        'DATABASE_PATH_SYMLINK',
        'Database file must not be a symbolic link.',
        { cause: error },
      );
    }
    throw error;
  }
}

function assertContainedFile(rootDirectory: string, filePath: string): void {
  const child = relative(rootDirectory, filePath);
  if (
    child.length === 0
    || child === '..'
    || child.startsWith(`..${sep}`)
    || isAbsolute(child)
  ) {
    throw new DatabasePathError(
      'DATABASE_PATH_ESCAPE',
      'Database file path must remain inside its configured root directory.',
    );
  }
}

function createSafeHint(id: DatabaseId): string {
  const hint = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, DATABASE_FILE_HINT_MAX_LENGTH)
    .replace(/-+$/g, '');
  return hint || 'opaque';
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function tryLstat(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
