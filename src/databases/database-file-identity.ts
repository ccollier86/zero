/**
 * database-file-identity.ts
 *
 * Opened-file identity proof for Fabric database handoff. A proof is safe to
 * clone over IPC and binds a canonical pathname to the exact device/inode which
 * the parent admitted. Actors retain the O_NOFOLLOW descriptor for file-mode
 * lifetime checks; Bun SQLite still opens by pathname, so callers also perform
 * a best-effort proof immediately after SQLite opens.
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from 'node:fs';

import { DatabaseError } from './database-error';

const IDENTITY_COMPONENT_PATTERN = /^(?:0|[1-9][0-9]{0,39})$/u;
const IDENTITY_FIELDS = new Set(['device', 'inode']);

/** Structured-clone-safe identity of one currently linked regular file. */
export interface DatabaseFileIdentityProof {
  readonly device: string;
  readonly inode: string;
}

/** A retained no-follow descriptor used to detect replacement and aliasing. */
export interface DatabaseFileIdentityGuard extends Disposable {
  readonly proof: DatabaseFileIdentityProof;
  readonly released: boolean;
  /** Recheck the descriptor and canonical pathname against the admitted inode. */
  assertCurrent(): void;
  /** Close the retained descriptor exactly once. */
  release(): void;
}

/** @internal Deterministic descriptor-cleanup seam; not package-exported. */
export interface DatabaseFileIdentityGuardDependencies {
  closeDescriptor(descriptor: number): void;
}

const PRODUCTION_IDENTITY_GUARD_DEPENDENCIES = Object.freeze({
  closeDescriptor(descriptor: number) {
    closeSync(descriptor);
  },
}) satisfies DatabaseFileIdentityGuardDependencies;

/** Strictly validate and detach an IPC file-identity proof. */
export function validateDatabaseFileIdentityProof(
  value: unknown,
): DatabaseFileIdentityProof {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidIdentityProof();
  }
  let prototype: object | null;
  let keys: string[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    keys = Object.keys(value);
  } catch {
    throw invalidIdentityProof();
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== IDENTITY_FIELDS.size
    || keys.some((key) => !IDENTITY_FIELDS.has(key))) {
    throw invalidIdentityProof();
  }
  const record = value as Record<string, unknown>;
  if (typeof record.device !== 'string'
    || typeof record.inode !== 'string'
    || !IDENTITY_COMPONENT_PATTERN.test(record.device)
    || !IDENTITY_COMPONENT_PATTERN.test(record.inode)) {
    throw invalidIdentityProof();
  }
  return Object.freeze({
    device: record.device,
    inode: record.inode,
  });
}

/** True only when two detached file proofs identify the same opened inode. */
export function sameDatabaseFileIdentity(
  left: DatabaseFileIdentityProof,
  right: DatabaseFileIdentityProof,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

/**
 * Open a canonical regular file without following its final path component.
 *
 * `nlink === 1` is mandatory. SQLite derives WAL/SHM companions from the path;
 * allowing two hardlink aliases would permit independent writer lanes and
 * companion files to target one main-file inode.
 */
export function openDatabaseFileIdentityGuard(
  filePath: string,
  options: Readonly<{
    access: 'read' | 'readwrite';
    expected?: DatabaseFileIdentityProof;
  }>,
): DatabaseFileIdentityGuard {
  return openDatabaseFileIdentityGuardWithDependencies(
    filePath,
    options,
    PRODUCTION_IDENTITY_GUARD_DEPENDENCIES,
  );
}

/** @internal Deterministic cleanup-failure seam; not exported by the package. */
export function openDatabaseFileIdentityGuardForTesting(
  filePath: string,
  options: Readonly<{
    access: 'read' | 'readwrite';
    expected?: DatabaseFileIdentityProof;
  }>,
  dependencies: DatabaseFileIdentityGuardDependencies,
): DatabaseFileIdentityGuard {
  return openDatabaseFileIdentityGuardWithDependencies(
    filePath,
    options,
    dependencies,
  );
}

function openDatabaseFileIdentityGuardWithDependencies(
  filePath: string,
  options: Readonly<{
    access: 'read' | 'readwrite';
    expected?: DatabaseFileIdentityProof;
  }>,
  dependencies: DatabaseFileIdentityGuardDependencies,
): DatabaseFileIdentityGuard {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number'
    ? fsConstants.O_NOFOLLOW
    : 0;
  const access = options.access === 'read'
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDWR;
  let descriptor: number;
  try {
    descriptor = openSync(filePath, access | noFollow);
  } catch (cause) {
    throw identityOpenFailed(cause);
  }

  let proof: DatabaseFileIdentityProof;
  try {
    proof = readDescriptorProof(descriptor);
    if (options.expected
      && !sameDatabaseFileIdentity(proof, options.expected)) {
      throw identityChanged();
    }
    assertPathNamesDescriptor(filePath, descriptor, proof);
  } catch (error) {
    try {
      dependencies.closeDescriptor(descriptor);
    } catch (cleanupError) {
      throw identityCleanupFailed(error, cleanupError);
    }
    throw error;
  }

  let released = false;
  const guard: DatabaseFileIdentityGuard = {
    proof,
    get released() {
      return released;
    },
    assertCurrent() {
      if (released) {
        throw new DatabaseError(
          'DATABASE_CLOSED',
          'Database file identity guard is closed.',
          { retryable: false, outcome: 'not-started' },
        );
      }
      const current = readDescriptorProof(descriptor);
      if (!sameDatabaseFileIdentity(current, proof)) throw identityChanged();
      assertPathNamesDescriptor(filePath, descriptor, proof);
    },
    release() {
      if (released) return;
      try {
        dependencies.closeDescriptor(descriptor);
        released = true;
      } catch (cause) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database file identity guard could not close.',
          { cause, retryable: false, outcome: 'unknown' },
        );
      }
    },
    [Symbol.dispose]() {
      guard.release();
    },
  };
  return Object.freeze(guard);
}

function identityCleanupFailed(
  primaryFailure: unknown,
  cleanupFailure: unknown,
): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database file identity cleanup failed.',
    {
      cause: new AggregateError(
        [primaryFailure, cleanupFailure],
        'Database file identity proof and cleanup failed.',
      ),
      retryable: false,
      outcome: 'unknown',
    },
  );
}

function readDescriptorProof(descriptor: number): DatabaseFileIdentityProof {
  try {
    const details = fstatSync(descriptor, { bigint: true });
    if (!details.isFile() || details.nlink !== 1n) throw identityChanged();
    return Object.freeze({
      device: details.dev.toString(10),
      inode: details.ino.toString(10),
    });
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw identityOpenFailed(error);
  }
}

function assertPathNamesDescriptor(
  filePath: string,
  descriptor: number,
  proof: DatabaseFileIdentityProof,
): void {
  try {
    const details = lstatSync(filePath, { bigint: true });
    if (details.isSymbolicLink()
      || !details.isFile()
      || details.nlink !== 1n
      || details.dev.toString(10) !== proof.device
      || details.ino.toString(10) !== proof.inode
      || realpathSync.native(filePath) !== filePath) {
      throw identityChanged();
    }
    // Re-read the descriptor after pathname resolution so a replacement racing
    // the two checks cannot pass without also preserving the admitted inode.
    const after = readDescriptorProof(descriptor);
    if (!sameDatabaseFileIdentity(after, proof)) throw identityChanged();
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw identityOpenFailed(error);
  }
}

function invalidIdentityProof(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_INVALID',
    'Database file identity proof is invalid.',
    { retryable: false, outcome: 'not-started' },
  );
}

function identityChanged(): DatabaseError {
  return new DatabaseError(
    'DATABASE_OPEN_FAILED',
    'Database file identity changed during handoff.',
    {
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'identity' },
    },
  );
}

function identityOpenFailed(cause: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_OPEN_FAILED',
    'Database file identity could not be verified.',
    {
      cause,
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'identity' },
    },
  );
}
