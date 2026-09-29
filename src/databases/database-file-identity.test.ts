import { afterEach, describe, expect, test } from 'bun:test';
import {
  closeSync,
  copyFileSync,
  linkSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DatabaseError } from './database-error';
import { prepareDatabaseFile } from './database-file';
import {
  openDatabaseFileIdentityGuard,
  openDatabaseFileIdentityGuardForTesting,
  sameDatabaseFileIdentity,
  validateDatabaseFileIdentityProof,
} from './database-file-identity';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('database opened-file identity', () => {
  test('retains and validates the exact admitted inode', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    const guard = openDatabaseFileIdentityGuard(prepared.path, {
      access: 'readwrite',
      expected: prepared.identity,
    });
    try {
      expect(sameDatabaseFileIdentity(guard.proof, prepared.identity)).toBe(true);
      expect(validateDatabaseFileIdentityProof(guard.proof)).toEqual(guard.proof);
      guard.assertCurrent();
    } finally {
      guard.release();
    }
    expect(guard.released).toBe(true);
  });

  test('rejects a hardlinked database even through its original pathname', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    linkSync(prepared.path, `${prepared.path}.alias`);
    expectIdentityFailure(() => openDatabaseFileIdentityGuard(prepared.path, {
      access: 'readwrite',
      expected: prepared.identity,
    }));
  });

  test('detects rename/swap after admission while retaining the old descriptor', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    const guard = openDatabaseFileIdentityGuard(prepared.path, {
      access: 'readwrite',
      expected: prepared.identity,
    });
    const moved = `${prepared.path}.moved`;
    const replacement = `${prepared.path}.replacement`;
    copyFileSync(prepared.path, replacement);
    renameSync(prepared.path, moved);
    renameSync(replacement, prepared.path);
    try {
      expectIdentityFailure(() => guard.assertCurrent());
    } finally {
      guard.release();
    }
  });

  test('rejects a stale parent proof after a pathname is atomically replaced', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    const replacement = `${prepared.path}.replacement`;
    copyFileSync(prepared.path, replacement);
    renameSync(replacement, prepared.path);
    expectIdentityFailure(() => openDatabaseFileIdentityGuard(prepared.path, {
      access: 'readwrite',
      expected: prepared.identity,
    }));
  });

  test('reports unknown cleanup when a rejected proof cannot prove descriptor closure', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    linkSync(prepared.path, `${prepared.path}.alias`);

    let closeAttempted = false;
    try {
      openDatabaseFileIdentityGuardForTesting(prepared.path, {
        access: 'readwrite',
        expected: prepared.identity,
      }, {
        closeDescriptor(descriptor) {
          closeAttempted = true;
          closeSync(descriptor);
          throw new Error('injected descriptor-close report failure');
        },
      });
    } catch (error) {
      expect(closeAttempted).toBe(true);
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error).toMatchObject({
        code: 'DATABASE_EXECUTOR_FAILED',
        retryable: false,
        outcome: 'unknown',
      });
      expect((error as DatabaseError).cause).toBeInstanceOf(AggregateError);
      return;
    }
    throw new Error('Expected database identity cleanup failure.');
  });
});

function createRoot(): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-database-file-identity-')),
  );
  roots.push(root);
  return root;
}

function expectIdentityFailure(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({
      code: 'DATABASE_OPEN_FAILED',
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'identity' },
    });
    return;
  }
  throw new Error('Expected database identity failure.');
}
